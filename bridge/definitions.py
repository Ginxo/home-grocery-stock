import os
from collections import deque
from datetime import datetime, timezone

import requests

# Configuration
MQTT_BROKER = os.getenv("MQTT_BROKER", "mosquitto_local")
GROCY_URL = os.getenv("GROCY_URL", "http://grocy:80").rstrip("/")
if not GROCY_URL.endswith("api"):
    GROCY_URL += "/api"
GROCY_API_KEY = os.getenv("GROCY_API_KEY", "YOUR_API_KEY_HERE")

# --- MULTI-CAMERA SESSION MEMORY ---
# Structure: {'camera_name': {'active': False, 'active_objects': {}, 'session_changes': {}}}
cameras_state = {}

# Bounded ring buffer of structured events for the central dashboard
event_log = deque(maxlen=200)


def log_event(level, message, camera=None):
    """Record a structured event. level: 'success' | 'error' | 'info' | 'debug'."""
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
            "session_changes": {},
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
