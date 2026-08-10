import os
import json
import threading
import requests
import paho.mqtt.client as mqtt
from flask import Flask, jsonify

# --- Configuración de Entorno ---
MQTT_BROKER = os.getenv("MQTT_BROKER", "localhost")
MQTT_PORT = 1883
GROCY_URL = os.getenv("GROCY_URL", "http://localhost:9283")
GROCY_API_KEY = os.getenv("GROCY_API_KEY", "TU_API_KEY")

# Diccionario para mapear lo que ve Frigate (ej: 'bottle') al ID interno de Grocy
# Ejemplo: En Grocy, la leche es el producto ID 4.
LABEL_TO_GROCY_ID = {
    "bottle": 4, 
    "cup": 5
}

app = Flask(__name__)
mqtt_client = mqtt.Client()

# --- Rutas HTTP (Home Assistant llama aquí para encender/apagar IA) ---
@app.route('/api/detect/<camera_name>/<state>', methods=['POST'])
def control_frigate(camera_name, state):
    state_upper = state.upper()
    if state_upper not in ["ON", "OFF"]:
        return jsonify({"error": "Estado inválido. Usa ON o OFF"}), 400
    
    topic = f"frigate/{camera_name}/detect/set"
    mqtt_client.publish(topic, state_upper)
    return jsonify({"message": f"Comando {state_upper} enviado a {camera_name}"}), 200

# --- Lógica MQTT (Escuchar a Frigate y avisar a Grocy) ---
def on_connect(client, userdata, flags, rc):
    print("Conectado a Mosquitto Local. Escuchando eventos de Frigate...")
    client.subscribe("frigate/events")

def on_message(client, userdata, msg):
    try:
        evento = json.loads(msg.payload.decode())
        
        # Filtramos: Solo nos interesan los objetos que finalizan su tracking
        # Aquí puedes añadir lógica de 'entered_zones' para Line Crossing avanzado
        if evento.get("type") == "end":
            label = evento["after"]["label"]
            
            # Si el objeto detectado está en nuestro diccionario, llamamos a Grocy
            if label in LABEL_TO_GROCY_ID:
                producto_id = LABEL_TO_GROCY_ID[label]
                descontar_de_grocy(producto_id, label)
                
    except Exception as e:
        print(f"Error procesando mensaje MQTT: {e}")

def descontar_de_grocy(producto_id, label):
    url = f"{GROCY_URL}/api/stock/products/{producto_id}/consume"
    headers = {
        "GROCY-API-KEY": GROCY_API_KEY,
        "accept": "application/json",
        "Content-Type": "application/json"
    }
    data = {
        "amount": 1,
        "transaction_type": "consume"
    }
    
    try:
        response = requests.post(url, headers=headers, json=data)
        if response.status_code == 200:
            print(f"✅ Éxito: 1 unidad de '{label}' descontada de Grocy (ID: {producto_id})")
        else:
            print(f"❌ Error API Grocy: {response.text}")
    except Exception as e:
        print(f"❌ Error de conexión con Grocy: {e}")

# --- Arranque Dual ---
if __name__ == '__main__':
    # Arrancar MQTT en un hilo en segundo plano
    mqtt_client.on_connect = on_connect
    mqtt_client.on_message = on_message
    mqtt_client.connect(MQTT_BROKER, MQTT_PORT, 60)
    mqtt_thread = threading.Thread(target=mqtt_client.loop_forever)
    mqtt_thread.daemon = True
    mqtt_thread.start()
    
    # Arrancar Servidor Flask en el hilo principal
    app.run(host='0.0.0.0', port=9000)