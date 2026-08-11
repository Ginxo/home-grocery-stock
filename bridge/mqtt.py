import json

import paho.mqtt.client as mqtt

from definitions import MQTT_BROKER, get_camera_state, log_event

mqtt_publisher = mqtt.Client()
mqtt_publisher.connect(MQTT_BROKER, 1883, 60)
mqtt_publisher.loop_start()


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
                    "debug",
                    f"[{camera}] Ignoring ghost flicker of '{label}'.",
                    camera=camera,
                )

            del active_objects[obj_id]
