# 📦 home-grocery-stock

> **Computer Vision-powered Smart Home Inventory Tracking System**  
> Automatically track items entering and leaving your fridge, pantry, or kitchen cupboards using AI, Frigate, Grocy, and Home Assistant.

---

## 🌟 Overview

`home-grocery-stock` is an event-driven microservice system designed to bridge real-time object tracking with automated inventory management. 

Instead of running continuous object detection and draining CPU/GPU resources, this system works on an **on-demand triggering mechanism**:
1. Opening a door (detected by a door sensor in Home Assistant) triggers a REST call to activate local vision processing.
2. Frigate uses GPU-accelerated **YOLO** (detection) and **NorFair** (tracking) to monitor items crossing zones.
3. An internal event-driven Python Bridge processes the tracking data and updates **Grocy** via its REST API.
4. When stock falls below configured minimums, Grocy triggers an alert back to Home Assistant (e.g., adding items to a shopping list or Google Keep).

The system runs entirely in local Docker containers, keeping heavy video feeds and object detection data isolated from your primary Home Assistant network.

---

## 🏗 Architecture & Flow

```text
[ Door Sensor (Aqara) ] ──(Zigbee)──> [ Home Assistant ]
                                            │
                                      (HTTP REST POST)
                                            │
                                            ▼
┌────────────────────────────────────────────────────────────────────────┐
│ ThinkPad / Local Server (home-grocery-stock)                           │
│                                                                        │
│   [ HTTP Endpoint :9000 ]                                              │
│            │                                                           │
│            ▼                                                           │
│   [ Python Bridge ] ──(MQTT ON/OFF)──> [ Mosquitto ]                   │
│            ▲                                   │                       │
│            │                             (MQTT Control)                │
│            │                                   │                       │
│     (Consume Stock API)                        ▼                       │
│            │                            [ Frigate AI ] <── (RTSP Stream│
│            ▼                                                           │
│      [ Grocy API ]                                                     │
└────────────┬───────────────────────────────────────────────────────────┘
             │
      (Webhook Alert)
             │
             ▼
    [ Home Assistant ] ──> [ Google Keep / To-Do List ]
```

## 🌐 Available Routes & Interfaces
1. Web User Interfaces (GUIs)
* Frigate Video & Debug UI: `http://<SERVER_IP>:5000`

    View live feeds, set up line crossing/zones, and debug bounding boxes.

* Grocy ERP / Inventory Web UI: `http://<SERVER_IP>:9283`

    Manage products, set minimum stock thresholds, and track consumption logs.

2. Service Endpoints & Ports
* Python Bridge Control REST API: `http://<SERVER_IP>:9000`
  * `POST /api/detect/<camera_name>/<state>`
    * Params: `<camera_name>` (e.g., `zona_frigorifico`), `<state>` (`on` or `off`).
    * Description: Enables or disables Frigate's object detection on demand.

* Local MQTT Broker: `<SERVER_IP>:1883`
  * Handles internal events between Frigate and the Python Bridge.

* Frigate RTSP / WebRTC Streams:
  * RTSP Re-stream: `rtsp://<SERVER_IP>:8554/<camera_name>`
  * WebRTC Signaling: `:8555` (TCP/UDP)

## 🚀 Deployment Instructions
### Prerequisites
* Docker & Docker Compose installed.

* An Nvidia GPU with `nvidia-container-toolkit` enabled (if using Nvidia acceleration). Modify `frigate/config/config.yml` if using CPU/Coral TPU.

* An RTSP camera feed URL.

#### Step 1: Clone and Create Data Directories
```bash
git clone [https://github.com/your-username/home-grocery-stock.git](https://github.com/your-username/home-grocery-stock.git)
cd home-grocery-stock
```
##### Create persistent storage directories for Docker volumes
```
mkdir -p .data/mosquitto/data .data/mosquitto/log .data/frigate/config .data/frigate/storage .data/grocy
chmod -R 777 .data/
```

#### Step 2: Configure Environment Variables
Copy or create the .env file in the root directory:
```
cp .env.example .env
```
Edit .env and set your credentials

#### Step 3: Build and Launch Containers
```bash
docker compose up -d --build
```

## 🧪 Testing & Verification Commands
1. Verify Running Services

Check that all 4 containers (`hgs_frigate`, `hgs_grocy`, `hgs_mosquitto`, `hgs_bridge`) are healthy:

```bash
docker compose ps
```

2. Test the Python Bridge & Detection Trigger

Simulate Home Assistant sending an "ON" signal to turn on camera detection:


```bash
curl -X POST http://localhost:9000/api/detect/zona_frigorifico/on
```

Expected Output: `{"message":"Command ON sent to zona_frigorifico"}`

Simulate sending an "OFF" signal when the door closes:

```bash
curl -X POST http://localhost:9000/api/detect/zona_frigorifico/off
```
Expected Output: `{"message":"Command OFF sent to zona_frigorifico"}`

3. Monitor Logs in Real Time

Watch the bridge process events from Frigate and make API calls to Grocy:

```bash
docker logs -f hgs_bridge
```
Watch Frigate GPU detection logs:

```bash
docker logs -f hgs_frigate
```
4. Test Grocy API Stock Consumption

Test the Grocy REST API directly from your terminal to verify stock reduction (replace ```YOUR_API_KEY_HERE``` and product ID 4 accordingly):

```bash
curl -X POST "http://localhost:9283/api/stock/products/4/consume" \
  -H "GROCY-API-KEY: YOUR_API_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{"amount": 1, "transaction_type": "consume"}'
```

## 🏠 Home Assistant Integration

To connect your existing Home Assistant instance to this local system, use the snippets provided in the `home_assistant_snippets/` folder:

1. REST Commands: Copy the contents of `rest_commands.yaml` to your HA `configuration.yaml` (make sure to update the IP address to match your server).

2. Reload HA: Go to `Developer Tools` -> `YAML` and click on `REST Entities and Services`.

3. Automations: Import the logic from `automations.yaml` into your HA Automations dashboard to trigger the REST commands automatically when your contact sensor (e.g., Aqara door sensor) opens or closes.