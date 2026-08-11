import threading

import paho.mqtt.client as mqtt

from api import serve
from definitions import MQTT_BROKER
from mqtt import on_connect, on_message

if __name__ == "__main__":
    print("🚀 Starting HGS Bridge (multi-camera with sessions)...")
    threading.Thread(target=serve, daemon=True).start()

    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(MQTT_BROKER, 1883, 60)
    client.loop_forever()
