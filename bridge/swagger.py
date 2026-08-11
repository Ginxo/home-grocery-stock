"""Flasgger / OpenAPI config and per-route specs for the bridge API."""

config = {
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

template = {
    "info": {
        "title": "HGS Bridge API",
        "description": "Control and observability endpoints for the home-grocery-stock bridge.",
        "version": "1.0.0",
    },
}

health = {
    "tags": ["Health"],
    "summary": "Health check",
    "responses": {
        "200": {
            "description": "Service is healthy",
            "schema": {
                "type": "object",
                "properties": {
                    "service": {"type": "string"},
                    "status": {"type": "string"},
                    "cameras": {"type": "object"},
                },
            },
        }
    },
}

get_state = {
    "tags": ["State"],
    "summary": "Full per-camera session state",
    "responses": {
        "200": {
            "description": "Detailed session state for every known camera",
            "schema": {
                "type": "object",
                "properties": {
                    "cameras": {
                        "type": "object",
                        "additionalProperties": {
                            "type": "object",
                            "properties": {
                                "active": {"type": "boolean"},
                                "active_objects_count": {"type": "integer"},
                                "session_changes": {"type": "object"},
                            },
                        },
                    }
                },
            },
        }
    },
}

get_logs = {
    "tags": ["Logs"],
    "summary": "Recent bridge event log (successes, errors, info, debug)",
    "responses": {
        "200": {
            "description": "Ring buffer of recent structured log events, newest first",
            "schema": {
                "type": "object",
                "properties": {
                    "logs": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "timestamp": {"type": "string"},
                                "level": {
                                    "type": "string",
                                    "enum": ["success", "error", "info", "debug"],
                                },
                                "camera": {"type": "string", "nullable": True},
                                "message": {"type": "string"},
                            },
                        },
                    }
                },
            },
        }
    },
}

toggle_detection = {
    "tags": ["Detection"],
    "summary": "Enable or disable detection for a camera",
    "parameters": [
        {
            "name": "camera",
            "in": "path",
            "type": "string",
            "required": True,
            "description": "Camera name (e.g. fridge_zone)",
        },
        {
            "name": "state_action",
            "in": "path",
            "type": "string",
            "required": True,
            "enum": ["on", "off"],
            "description": "Turn detection on or off",
        },
    ],
    "responses": {
        "200": {
            "description": "Detection toggled successfully",
            "schema": {
                "type": "object",
                "properties": {
                    "status": {"type": "string"},
                    "message": {"type": "string"},
                },
            },
        },
        "400": {
            "description": "Invalid state_action",
        },
    },
}
