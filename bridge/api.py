from flasgger import Swagger, swag_from
from flask import Flask, jsonify
from waitress import serve as waitress_serve

import swagger
from definitions import (
    cameras_state,
    event_log,
    get_camera_state,
    log_event,
    process_changes_in_grocy,
)
from mqtt import mqtt_publisher

app = Flask(__name__)
Swagger(app, config=swagger.config, template=swagger.template)


@app.route("/", methods=["GET"])
@swag_from(swagger.health)
def health():
    return jsonify(
        {
            "service": "hgs-bridge",
            "status": "ok",
            "cameras": {name: {"active": state["active"]} for name, state in cameras_state.items()},
        }
    ), 200


@app.route("/api/state", methods=["GET"])
@swag_from(swagger.get_state)
def get_state():
    return jsonify(
        {
            "cameras": {
                name: {
                    "active": state["active"],
                    "active_objects_count": len(state["active_objects"]),
                    "session_changes": dict(state["session_changes"]),
                }
                for name, state in cameras_state.items()
            }
        }
    ), 200


@app.route("/api/logs", methods=["GET"])
@swag_from(swagger.get_logs)
def get_logs():
    return jsonify({"logs": list(reversed(event_log))}), 200


@app.route("/api/detect/<camera>/<state_action>", methods=["POST"])
@swag_from(swagger.toggle_detection)
def toggle_detection(camera, state_action):
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


def serve():
    waitress_serve(app, host="0.0.0.0", port=9000)
