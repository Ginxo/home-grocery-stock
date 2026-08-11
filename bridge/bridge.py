import paho.mqtt.client as mqtt
import requests
import json
import os
import threading
from flask import Flask, jsonify

# Configuraciones
MQTT_BROKER = os.getenv("MQTT_BROKER", "mosquitto_local")
GROCY_URL = os.getenv("GROCY_URL", "http://grocy:80").rstrip('/')
if not GROCY_URL.endswith('api'):
    GROCY_URL += '/api'
GROCY_API_KEY = os.getenv("GROCY_API_KEY", "TU_API_KEY_AQUI")

# --- MEMORIA DE SESIÓN MULTI-CÁMARA ---
# Estructura: {'nombre_camara': {'active': False, 'active_objects': {}, 'session_changes': {}}}
cameras_state = {}

def get_camera_state(camera):
    """Devuelve el estado de una cámara o lo crea si no existe."""
    if camera not in cameras_state:
        cameras_state[camera] = {
            "active": False,
            "active_objects": {},
            "session_changes": {}
        }
    return cameras_state[camera]

def procesar_cambios_en_grocy(camera):
    """Se ejecuta al cerrar la puerta de una cámara específica. Envía los cambios a Grocy."""
    state = get_camera_state(camera)
    session_changes = state["session_changes"]
    
    print(f"\n🚪 Puerta cerrada en '{camera}'. Procesando inventario neto...")
    
    if not session_changes:
        print("🤷 Sin movimientos registrados en esta sesión.\n")
        return

    for label, count in session_changes.items():
        if count == 0:
            print(f"➖ {label}: Sin cambios netos (0). Se ignora.")
            continue
            
        endpoint_base = f"{GROCY_URL}/stock/products/by-barcode/{label}"
        headers = {"GROCY-API-KEY": GROCY_API_KEY, "Content-Type": "application/json", "Accept": "application/json"}
        
        if count < 0:
            cantidad = abs(count)
            res = requests.post(f"{endpoint_base}/consume", headers=headers, json={"amount": cantidad, "transaction_type": "consume", "spoiled": False})
            if res.status_code == 200:
                print(f"🔴 Éxito: {cantidad}x '{label}' consumido de Grocy.")
            else:
                print(f"❌ Error al consumir '{label}': {res.text}")
                
        elif count > 0:
            res = requests.post(f"{endpoint_base}/add", headers=headers, json={"amount": count})
            if res.status_code == 200:
                print(f"🟢 Éxito: {count}x '{label}' añadido a Grocy.")
            else:
                print(f"❌ Error al añadir '{label}': {res.text}")
                
    # Limpiamos el carrito de esta cámara específica
    state["session_changes"].clear()
    print(f"✅ Inventario actualizado para '{camera}'.\n")

# --- LÓGICA MQTT Y TRACKING ---
def on_connect(client, userdata, flags, rc):
    print("✅ Conectado al broker MQTT. Esperando eventos...")
    client.subscribe("frigate/events")

def on_message(client, userdata, msg):
    payload = json.loads(msg.payload.decode())
    
    # Frigate siempre incluye el nombre de la cámara en el payload
    camera = payload.get("after", {}).get("camera")
    if not camera:
        return

    state = get_camera_state(camera)
    
    # Si esta cámara no tiene la sesión abierta, ignoramos sus eventos
    if not state["active"]:
        return 
        
    obj_id = payload["after"]["id"]
    label = payload["after"]["label"]
    event_type = payload["type"]
    current_zones = payload["after"]["current_zones"]

    active_objects = state["active_objects"]
    session_changes = state["session_changes"]

    # 1. El objeto aparece por primera vez
    if event_type == "new":
        active_objects[obj_id] = {"start_zones": current_zones}
        
    # 2. El rastro del objeto termina
    elif event_type == "end":
        if obj_id in active_objects:
            start_zones = active_objects[obj_id]["start_zones"]
            end_zones = current_zones
            
            is_start_outside = "zona_exterior" in start_zones
            is_end_outside = "zona_exterior" in end_zones
            
            if not is_start_outside and is_end_outside:
                # SALIDA
                session_changes[label] = session_changes.get(label, 0) - 1
                print(f"🛒 [{camera}] {label} sacado. (Neto: {session_changes[label]})")
                
            elif is_start_outside and not is_end_outside:
                # ENTRADA
                session_changes[label] = session_changes.get(label, 0) + 1
                print(f"🛒 [{camera}] {label} metido. (Neto: {session_changes[label]})")
                
            else:
                # FALSO POSITIVO
                print(f"👻 [{camera}] Ignorando parpadeo fantasma de '{label}'.")
                
            del active_objects[obj_id]

# --- SERVIDOR WEB (Puerto 9000) ---
app = Flask(__name__)
mqtt_publisher = mqtt.Client()
mqtt_publisher.connect(MQTT_BROKER, 1883, 60)

@app.route('/api/detect/<camera>/<state>', methods=['POST'])
def toggle_detection(camera, state_action):
    if state_action not in ["on", "off"]:
        return jsonify({"error": "Usa 'on' u 'off'"}), 400
        
    state = get_camera_state(camera)
    payload = "ON" if state_action == "on" else "OFF"
    
    if state_action == "on":
        state["active"] = True
        state["session_changes"].clear()
        state["active_objects"].clear()
        print(f"\n🗄️ Puerta ABIERTA en '{camera}'. Iniciando sesión...")
    elif state_action == "off" and state["active"]:
        state["active"] = False
        procesar_cambios_en_grocy(camera)
        
    # Encender/Apagar cámara en Frigate
    mqtt_publisher.publish(f"frigate/{camera}/detect/set", payload)
    
    return jsonify({"status": "success", "message": f"Detección {payload} en {camera}"}), 200

def run_flask():
    app.run(host='0.0.0.0', port=9000, use_reloader=False)

if __name__ == "__main__":
    print("🚀 Iniciando HGS Bridge (Multicámara y con sesiones)...")
    threading.Thread(target=run_flask, daemon=True).start()
    
    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(MQTT_BROKER, 1883, 60)
    client.loop_forever()