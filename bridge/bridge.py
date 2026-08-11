import paho.mqtt.client as mqtt
import requests
import json
import os
import threading
from collections import deque
from datetime import datetime, timezone
from flask import Flask, jsonify
from flasgger import Swagger
from waitress import serve

# Configuration
MQTT_BROKER = os.getenv("MQTT_BROKER", "mosquitto_local")
GROCY_URL = os.getenv("GROCY_URL", "http://grocy:80").rstrip('/')
if not GROCY_URL.endswith('api'):
    GROCY_URL += '/api'
GROCY_API_KEY = os.getenv("GROCY_API_KEY", "YOUR_API_KEY_HERE")

# --- MULTI-CAMERA SESSION MEMORY ---
# Structure: {'camera_name': {'active': False, 'active_objects': {}, 'session_changes': {}}}
cameras_state = {}

# Bounded ring buffer of structured events for the central dashboard
event_log = deque(maxlen=200)


def log_event(level, message, camera=None):
    """Record a structured event. level: 'success' | 'error' | 'info'."""
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "level": level,
        "camera": camera,
        "message": message,
    }
    event_log.append(entry)
    print(message)


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

    log_event("info", f"Door closed on '{camera}'. Processing net inventory...", camera=camera)

    if not session_changes:
        log_event("info", "No movements recorded in this session.", camera=camera)
        return

    for label, count in session_changes.items():
        if count == 0:
            log_event("info", f"{label}: No net change (0). Skipping.", camera=camera)
            continue

        endpoint_base = f"{GROCY_URL}/stock/products/by-barcode/{label}"
        headers = {
            "GROCY-API-KEY": GROCY_API_KEY,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        if count < 0:
            amount = abs(count)
            res = requests.post(
                f"{endpoint_base}/consume",
                headers=headers,
                json={"amount": amount, "transaction_type": "consume", "spoiled": False},
            )
            if res.status_code == 200:
                log_event(
                    "success",
                    f"Success: {amount}x '{label}' consumed from Grocy.",
                    camera=camera,
                )
            else:
                log_event(
                    "error",
                    f"Error consuming '{label}': {res.text}",
                    camera=camera,
                )

        elif count > 0:
            res = requests.post(
                f"{endpoint_base}/add",
                headers=headers,
                json={"amount": count},
            )
            if res.status_code == 200:
                log_event(
                    "success",
                    f"Success: {count}x '{label}' added to Grocy.",
                    camera=camera,
                )
            else:
                log_event(
                    "error",
                    f"Error adding '{label}': {res.text}",
                    camera=camera,
                )

    # Clear this camera's session cart
    state["session_changes"].clear()
    log_event("success", f"Inventory updated for '{camera}'.", camera=camera)


# --- MQTT AND TRACKING LOGIC ---
def on_connect(client, userdata, flags, rc):
    log_event("info", "Connected to MQTT broker. Waiting for events...")
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
                log_event(
                    "info",
                    f"[{camera}] {label} removed. (Net: {session_changes[label]})",
                    camera=camera,
                )

            elif is_start_outside and not is_end_outside:
                # ENTRY (item added)
                session_changes[label] = session_changes.get(label, 0) + 1
                log_event(
                    "info",
                    f"[{camera}] {label} added. (Net: {session_changes[label]})",
                    camera=camera,
                )

            else:
                # FALSE POSITIVE
                log_event(
                    "info",
                    f"[{camera}] Ignoring ghost flicker of '{label}'.",
                    camera=camera,
                )

            del active_objects[obj_id]


# --- WEB SERVER (Port 9000) ---
app = Flask(__name__)
swagger_config = {
    "headers": [],
    "specs": [
        {
            "endpoint": "apispec",
            "route": "/apispec.json",
            "rule_filter": lambda rule: True,
            "model_filter": lambda tag: True,
        }
    ],
    "static_url_path": "/flasgger_static",
    "swagger_ui": True,
    "specs_route": "/apidocs/",
}
swagger_template = {
    "info": {
        "title": "HGS Bridge API",
        "description": "Control and observability endpoints for the home-grocery-stock bridge.",
        "version": "1.0.0",
    },
}
Swagger(app, config=swagger_config, template=swagger_template)

mqtt_publisher = mqtt.Client()
mqtt_publisher.connect(MQTT_BROKER, 1883, 60)
mqtt_publisher.loop_start()


@app.route('/', methods=['GET'])
def health():
    """Health check
    ---
    tags:
      - Health
    responses:
      200:
        description: Service is healthy
        schema:
          type: object
          properties:
            service:
              type: string
            status:
              type: string
            cameras:
              type: object
    """
    return jsonify({
        "service": "hgs-bridge",
        "status": "ok",
        "cameras": {
            name: {"active": state["active"]}
            for name, state in cameras_state.items()
        },
    }), 200


@app.route('/api/state', methods=['GET'])
def get_state():
    """Full per-camera session state
    ---
    tags:
      - State
    responses:
      200:
        description: Detailed session state for every known camera
        schema:
          type: object
          properties:
            cameras:
              type: object
              additionalProperties:
                type: object
                properties:
                  active:
                    type: boolean
                  active_objects_count:
                    type: integer
                  session_changes:
                    type: object
    """
    return jsonify({
        "cameras": {
            name: {
                "active": state["active"],
                "active_objects_count": len(state["active_objects"]),
                "session_changes": dict(state["session_changes"]),
            }
            for name, state in cameras_state.items()
        }
    }), 200


@app.route('/api/logs', methods=['GET'])
def get_logs():
    """Recent bridge event log (successes, errors, info)
    ---
    tags:
      - Logs
    responses:
      200:
        description: Ring buffer of recent structured log events, newest first
        schema:
          type: object
          properties:
            logs:
              type: array
              items:
                type: object
                properties:
                  timestamp:
                    type: string
                  level:
                    type: string
                    enum: [success, error, info]
                  camera:
                    type: string
                    nullable: true
                  message:
                    type: string
    """
    return jsonify({"logs": list(reversed(event_log))}), 200


@app.route('/api/detect/<camera>/<state_action>', methods=['POST'])
def toggle_detection(camera, state_action):
    """Enable or disable detection for a camera
    ---
    tags:
      - Detection
    parameters:
      - name: camera
        in: path
        type: string
        required: true
        description: Camera name (e.g. fridge_zone)
      - name: state_action
        in: path
        type: string
        required: true
        enum: [on, off]
        description: Turn detection on or off
    responses:
      200:
        description: Detection toggled successfully
        schema:
          type: object
          properties:
            status:
              type: string
            message:
              type: string
      400:
        description: Invalid state_action
    """
    if state_action not in ["on", "off"]:
        return jsonify({"error": "Use 'on' or 'off'"}), 400

    state = get_camera_state(camera)
    payload = "ON" if state_action == "on" else "OFF"

    if state_action == "on":
        state["active"] = True
        state["session_changes"].clear()
        state["active_objects"].clear()
        log_event("info", f"Door OPEN on '{camera}'. Starting session...", camera=camera)
    elif state_action == "off" and state["active"]:
        state["active"] = False
        process_changes_in_grocy(camera)

    # Enable/disable camera detection in Frigate
    mqtt_publisher.publish(f"frigate/{camera}/detect/set", payload)

    return jsonify({"status": "success", "message": f"Detection {payload} on {camera}"}), 200


def run_flask():
    serve(app, host='0.0.0.0', port=9000)


if __name__ == "__main__":
    print("🚀 Starting HGS Bridge (multi-camera with sessions)...")
    threading.Thread(target=run_flask, daemon=True).start()

    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(MQTT_BROKER, 1883, 60)
    client.loop_forever()
