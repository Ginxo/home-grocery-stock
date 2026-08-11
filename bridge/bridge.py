import paho.mqtt.client as mqtt
import requests
import json
import os
import threading
from flask import Flask, jsonify

# Configuration
MQTT_BROKER = os.getenv("MQTT_BROKER", "mosquitto_local")
GROCY_URL = os.getenv("GROCY_URL", "http://grocy:80").rstrip('/')
if not GROCY_URL.endswith('api'):
    GROCY_URL += '/api'
GROCY_API_KEY = os.getenv("GROCY_API_KEY", "YOUR_API_KEY_HERE")

# --- MULTI-CAMERA SESSION MEMORY ---
# Structure: {'camera_name': {'active': False, 'active_objects': {}, 'session_changes': {}}}
cameras_state = {}

def get_camera_state(camera):
    """Return the state for a camera, creating it if it does not exist."""
    if camera not in cameras_state:
        cameras_state[camera] = {
            "active": False,
            "active_objects": {},
            "session_changes": {}
        }
    return cameras_state[camera]

def process_changes_in_grocy(camera):
    """Runs when a camera's door closes. Sends net changes to Grocy."""
    state = get_camera_state(camera)
    session_changes = state["session_changes"]
    
    print(f"\n🚪 Door closed on '{camera}'. Processing net inventory...")
    
    if not session_changes:
        print("🤷 No movements recorded in this session.\n")
        return

    for label, count in session_changes.items():
        if count == 0:
            print(f"➖ {label}: No net change (0). Skipping.")
            continue
            
        endpoint_base = f"{GROCY_URL}/stock/products/by-barcode/{label}"
        headers = {"GROCY-API-KEY": GROCY_API_KEY, "Content-Type": "application/json", "Accept": "application/json"}
        
        if count < 0:
            amount = abs(count)
            res = requests.post(f"{endpoint_base}/consume", headers=headers, json={"amount": amount, "transaction_type": "consume", "spoiled": False})
            if res.status_code == 200:
                print(f"🔴 Success: {amount}x '{label}' consumed from Grocy.")
            else:
                print(f"❌ Error consuming '{label}': {res.text}")
                
        elif count > 0:
            res = requests.post(f"{endpoint_base}/add", headers=headers, json={"amount": count})
            if res.status_code == 200:
                print(f"🟢 Success: {count}x '{label}' added to Grocy.")
            else:
                print(f"❌ Error adding '{label}': {res.text}")
                
    # Clear this camera's session cart
    state["session_changes"].clear()
    print(f"✅ Inventory updated for '{camera}'.\n")

# --- MQTT AND TRACKING LOGIC ---
def on_connect(client, userdata, flags, rc):
    print("✅ Connected to MQTT broker. Waiting for events...")
    client.subscribe("frigate/events")

def on_message(client, userdata, msg):
    payload = json.loads(msg.payload.decode())
    
    # Frigate always includes the camera name in the payload
    camera = payload.get("after", {}).get("camera")
    if not camera:
        return

    state = get_camera_state(camera)
    
    # If this camera has no open session, ignore its events
    if not state["active"]:
        return 
        
    obj_id = payload["after"]["id"]
    label = payload["after"]["label"]
    event_type = payload["type"]
    current_zones = payload["after"]["current_zones"]

    active_objects = state["active_objects"]
    session_changes = state["session_changes"]

    # 1. Object appears for the first time
    if event_type == "new":
        active_objects[obj_id] = {"start_zones": current_zones}
        
    # 2. Object track ends
    elif event_type == "end":
        if obj_id in active_objects:
            start_zones = active_objects[obj_id]["start_zones"]
            end_zones = current_zones
            
            is_start_outside = "outside_zone" in start_zones
            is_end_outside = "outside_zone" in end_zones
            
            if not is_start_outside and is_end_outside:
                # EXIT (item removed)
                session_changes[label] = session_changes.get(label, 0) - 1
                print(f"🛒 [{camera}] {label} removed. (Net: {session_changes[label]})")
                
            elif is_start_outside and not is_end_outside:
                # ENTRY (item added)
                session_changes[label] = session_changes.get(label, 0) + 1
                print(f"🛒 [{camera}] {label} added. (Net: {session_changes[label]})")
                
            else:
                # FALSE POSITIVE
                print(f"👻 [{camera}] Ignoring ghost flicker of '{label}'.")
                
            del active_objects[obj_id]

# --- WEB SERVER (Port 9000) ---
app = Flask(__name__)
mqtt_publisher = mqtt.Client()
mqtt_publisher.connect(MQTT_BROKER, 1883, 60)

@app.route('/api/detect/<camera>/<state>', methods=['POST'])
def toggle_detection(camera, state_action):
    if state_action not in ["on", "off"]:
        return jsonify({"error": "Use 'on' or 'off'"}), 400
        
    state = get_camera_state(camera)
    payload = "ON" if state_action == "on" else "OFF"
    
    if state_action == "on":
        state["active"] = True
        state["session_changes"].clear()
        state["active_objects"].clear()
        print(f"\n🗄️ Door OPEN on '{camera}'. Starting session...")
    elif state_action == "off" and state["active"]:
        state["active"] = False
        process_changes_in_grocy(camera)
        
    # Enable/disable camera detection in Frigate
    mqtt_publisher.publish(f"frigate/{camera}/detect/set", payload)
    
    return jsonify({"status": "success", "message": f"Detection {payload} on {camera}"}), 200

def run_flask():
    app.run(host='0.0.0.0', port=9000, use_reloader=False)

if __name__ == "__main__":
    print("🚀 Starting HGS Bridge (multi-camera with sessions)...")
    threading.Thread(target=run_flask, daemon=True).start()
    
    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(MQTT_BROKER, 1883, 60)
    client.loop_forever()
