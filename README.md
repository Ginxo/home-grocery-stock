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
* Central Dev Dashboard: `http://<SERVER_IP>:80`

    Developer console for the stack: service links, Bridge OpenAPI/Swagger, Frigate camera config, Bridge session state, Bridge event logs, and live MQTT traffic.

* Frigate Video & Debug UI: `http://<SERVER_IP>:5000`

    View live feeds, set up line crossing/zones, and debug bounding boxes.

* Grocy ERP / Inventory Web UI: `http://<SERVER_IP>:9283`

    Manage products, set minimum stock thresholds, and track consumption logs.

2. Service Endpoints & Ports
* Python Bridge Control REST API: `http://<SERVER_IP>:9000`
  * `GET /` — health check with per-camera active flags.
  * `GET /api/state` — full session state (`active`, active object counts, session changes).
  * `GET /api/logs` — recent structured success/error/info events (in-memory ring buffer).
  * `GET /apispec.json` — OpenAPI contract (consumed by Central Swagger UI).
  * `POST /api/detect/<camera_name>/<state>`
    * Params: `<camera_name>` (e.g., `fridge_zone`), `<state>` (`on` or `off`).
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

## CI (Pull Requests)

Every pull request runs [`.github/workflows/pr.yml`](.github/workflows/pr.yml):

1. **Central lint** (parallel) — ESLint + Prettier on `central/frontend` and `central/backend`
2. **Bridge lint** (parallel) — Ruff check + format on `bridge/`
3. **Compose smoke** (after both pass) — builds and starts mosquitto, grocy, bridge, and central via `docker-compose.yml` + [`docker-compose.ci.yml`](docker-compose.ci.yml), then runs [`scripts/ci-smoke.sh`](scripts/ci-smoke.sh)

Frigate is **not** started in CI (large image, privileged, camera-dependent). The overlay puts the `frigate` service behind a Compose profile so it stays off unless you explicitly enable it.

### Run the same checks locally

Central:

```bash
cd central/frontend && npm ci && npm run lint && npm run format:check
cd ../backend && npm ci && npm run lint && npm run format:check
```

To auto-fix formatting: `npm run format` in each package.

Bridge:

```bash
cd bridge
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/ruff check .
.venv/bin/ruff format --check .
```

To auto-fix: `.venv/bin/ruff format .` and `.venv/bin/ruff check --fix .`.

Compose smoke (no Frigate):

```bash
mkdir -p .data/mosquitto/data .data/mosquitto/log .data/grocy
cp .env.example .env   # or set GROCY_API_KEY / FRIGATE_RTSP_PATH
docker compose -f docker-compose.yml -f docker-compose.ci.yml up -d --build
./scripts/ci-smoke.sh
docker compose -f docker-compose.yml -f docker-compose.ci.yml down -v
```

The smoke script checks bridge/central health, central→bridge proxy routes, detect on/off state changes, Grocy HTTP reachability, and MQTT broker connectivity.

## 🧪 Testing & Verification Commands
1. Verify Running Services

Check that all containers (`hgs_frigate`, `hgs_grocy`, `hgs_mosquitto`, `hgs_bridge`, `home-grocery-stock-central`) are healthy:

```bash
docker compose ps
```

2. Test the Python Bridge & Detection Trigger

Simulate Home Assistant sending an "ON" signal to turn on camera detection:


```bash
curl -X POST http://localhost:9000/api/detect/fridge_zone/on
```

Expected Output: `{"status":"success","message":"Detection ON on fridge_zone"}`

Simulate sending an "OFF" signal when the door closes:

```bash
curl -X POST http://localhost:9000/api/detect/fridge_zone/off
```
Expected Output: `{"status":"success","message":"Detection OFF on fridge_zone"}`

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

## 🛒 Adding a Product (Grocy ↔ Frigate)

The bridge does **not** use Grocy product IDs. When a door session ends, it looks up stock by barcode using the Frigate object **label** as the barcode:

```text
Frigate label  →  Grocy product barcode  →  /stock/products/by-barcode/{label}
```

Example: if Frigate tracks `bottle`, Grocy must have a product whose barcode is exactly `bottle`.

### Step 1: Teach Frigate to track the object

Edit `frigate/config.yml` and add the COCO label under the camera’s `objects.track` list. The label must exist in the model’s label map (default OpenVINO model uses `coco_91cl_bkgr.txt`).

```yaml
cameras:
  fridge_zone:
    objects:
      track:
        - bottle
        - cup
        - # ...existing labels...
        - apple   # new item
```

Restart Frigate after changing the config:

```bash
docker compose restart frigate
```

You can confirm the camera’s tracked objects in the Central dashboard (`/frigate`) or Frigate UI (`:5000`).

### Step 2: Create the product in Grocy with a matching barcode

1. Open Grocy: `http://<SERVER_IP>:9283`
2. Go to **Master data → Products** → create a new product (name can be anything human-readable, e.g. “Apple”).
3. Set the product **Barcode** to the **exact** Frigate label (`apple`, not `Apple` or `apples`).
4. Optionally set minimum stock so Grocy can alert Home Assistant when levels are low.
5. Add initial stock if needed (**Stock → Purchase / Inventory**).

The barcode string must match the Frigate label character-for-character (lowercase COCO names).

### Step 3: Verify the link

1. Trigger a detection session (door open / close, or the curl commands above).
2. Watch the bridge logs:

```bash
docker logs -f hgs_bridge
```

Successful updates look like:

```text
Success: 1x 'apple' added to Grocy.
Success: 1x 'apple' consumed from Grocy.
```

If the barcode is missing or mistyped, Grocy returns an error and the bridge logs something like `Error consuming 'apple': ...`.

### How entry / exit is decided

During an active session the bridge watches Frigate MQTT events (`frigate/events`). For each tracked object it compares start vs end zones:

| Start zone | End zone | Effect on session cart |
|---|---|---|
| not `outside_zone` | `outside_zone` | −1 (item removed / consume) |
| `outside_zone` | not `outside_zone` | +1 (item added / purchase) |
| same side | same side | ignored (ghost flicker) |

When detection turns **off**, net counts are flushed to Grocy via `by-barcode/{label}` (`consume` or `add`).

Zones (`outside_zone`, inside zones, etc.) are configured in Frigate (UI or `frigate/config.yml`). Without those zones, movements will not produce stock changes.

---

## 🏠 Home Assistant Integration

To connect your existing Home Assistant instance to this local system, use the snippets provided in the `home_assistant_snippets/` folder:

1. REST Commands: Copy the contents of `rest_commands.yaml` to your HA `configuration.yaml` (make sure to update the IP address to match your server).

2. Reload HA: Go to `Developer Tools` -> `YAML` and click on `REST Entities and Services`.

3. Automations: Import the logic from `automations.yaml` into your HA Automations dashboard to trigger the REST commands automatically when your contact sensor (e.g., Aqara door sensor) opens or closes.