const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const yaml = require("js-yaml");
const mqtt = require("mqtt");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT || 80);
const BRIDGE_URL = (process.env.BRIDGE_URL || "http://bridge:9000").replace(/\/$/, "");
const MQTT_BROKER = process.env.MQTT_BROKER || "mosquitto_local";
const FRIGATE_CONFIG_PATH =
  process.env.FRIGATE_CONFIG_PATH || "/app/frigate-config.yml";
const MQTT_BUFFER_SIZE = 200;
const BRIDGE_PROXY_BASE = "/api/bridge/proxy";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false },
});

app.use(express.json({ limit: "1mb" }));
app.use(express.raw({ type: ["application/octet-stream"], limit: "1mb" }));

const mqttMessageBuffer = [];

async function proxyBridge(res, bridgePath, options = {}) {
  const { method = "GET", body, headers = {} } = options;
  try {
    const fetchHeaders = { ...headers };
    const init = { method, headers: fetchHeaders };
    if (body !== undefined && method !== "GET" && method !== "HEAD") {
      if (Buffer.isBuffer(body)) {
        init.body = body;
      } else if (typeof body === "string") {
        init.body = body;
      } else {
        fetchHeaders["Content-Type"] =
          fetchHeaders["Content-Type"] || "application/json";
        init.body = JSON.stringify(body);
      }
    }

    const response = await fetch(`${BRIDGE_URL}${bridgePath}`, init);
    const contentType = response.headers.get("content-type") || "application/json";
    const text = await response.text();
    res.status(response.status).type(contentType).send(text);
  } catch (err) {
    console.error(`Bridge proxy error (${bridgePath}):`, err.message);
    res.status(502).json({
      error: "Failed to reach bridge",
      detail: err.message,
      path: bridgePath,
    });
  }
}

app.get("/api/bridge/openapi", async (req, res) => {
  try {
    const response = await fetch(`${BRIDGE_URL}/apispec.json`);
    if (!response.ok) {
      return res.status(response.status).json({
        error: "Failed to load bridge OpenAPI contract",
        status: response.status,
      });
    }
    const spec = await response.json();

    // Flasgger emits Swagger 2.0 (host/basePath), not OpenAPI 3 servers.
    // Rewrite so Try-it-out calls central's proxy instead of missing local paths.
    if (spec.swagger === "2.0" || !spec.openapi) {
      delete spec.host;
      spec.basePath = BRIDGE_PROXY_BASE;
      const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http")
        .toString()
        .split(",")[0]
        .trim();
      spec.schemes = [proto === "https" ? "https" : "http"];
    } else {
      spec.servers = [
        {
          url: BRIDGE_PROXY_BASE,
          description: "Proxied through home-grocery-stock-central to bridge",
        },
      ];
    }

    res.json(spec);
  } catch (err) {
    console.error("OpenAPI proxy error:", err.message);
    res.status(502).json({
      error: "Failed to reach bridge OpenAPI",
      detail: err.message,
    });
  }
});

app.get("/api/bridge/state", (req, res) => {
  proxyBridge(res, "/api/state");
});

app.get("/api/bridge/logs", (req, res) => {
  proxyBridge(res, "/api/logs");
});

app.post("/api/bridge/detect/:camera/:state", (req, res) => {
  const { camera, state } = req.params;
  if (!["on", "off"].includes(state)) {
    return res.status(400).json({ error: "Use 'on' or 'off'" });
  }
  proxyBridge(res, `/api/detect/${encodeURIComponent(camera)}/${state}`, {
    method: "POST",
  });
});

// Generic reverse proxy for Swagger Try-it-out (and any future bridge paths).
app.use(BRIDGE_PROXY_BASE, async (req, res) => {
  const bridgePath = req.url && req.url !== "/" ? req.url : "/";
  const headers = {};
  if (req.headers["content-type"]) {
    headers["Content-Type"] = req.headers["content-type"];
  }
  if (req.headers.accept) {
    headers.Accept = req.headers.accept;
  }

  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    if (Buffer.isBuffer(req.body)) {
      body = req.body;
    } else if (req.body && typeof req.body === "object" && Object.keys(req.body).length > 0) {
      body = req.body;
    }
  }

  await proxyBridge(res, bridgePath, {
    method: req.method,
    body,
    headers,
  });
});

app.get("/api/frigate/cameras", (req, res) => {
  try {
    if (!fs.existsSync(FRIGATE_CONFIG_PATH)) {
      return res.status(404).json({
        error: "Frigate config not found",
        path: FRIGATE_CONFIG_PATH,
      });
    }

    const raw = fs.readFileSync(FRIGATE_CONFIG_PATH, "utf8");
    const config = yaml.load(raw) || {};
    const camerasConfig = config.cameras || {};

    const cameras = Object.entries(camerasConfig).map(([name, cam]) => {
      const detect = cam.detect || {};
      const objects = (cam.objects && cam.objects.track) || [];
      return {
        name,
        detect: {
          enabled: detect.enabled ?? null,
          width: detect.width ?? null,
          height: detect.height ?? null,
          fps: detect.fps ?? null,
        },
        trackedObjects: objects,
      };
    });

    res.json({ cameras });
  } catch (err) {
    console.error("Frigate config parse error:", err.message);
    res.status(500).json({
      error: "Failed to parse Frigate config",
      detail: err.message,
    });
  }
});

app.get("/api/health", (req, res) => {
  res.json({
    service: "home-grocery-stock-central",
    status: "ok",
  });
});

const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/socket.io")) {
    return next();
  }
  const indexPath = path.join(publicDir, "index.html");
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  res.status(404).send("Frontend not built");
});

function pushMqttMessage(topic, payload) {
  const entry = {
    topic,
    payload,
    timestamp: new Date().toISOString(),
  };
  mqttMessageBuffer.push(entry);
  if (mqttMessageBuffer.length > MQTT_BUFFER_SIZE) {
    mqttMessageBuffer.shift();
  }
  io.emit("mqtt:message", entry);
}

function startMqttBridge() {
  const brokerUrl = `mqtt://${MQTT_BROKER}:1883`;
  console.log(`Connecting MQTT client to ${brokerUrl}...`);

  const client = mqtt.connect(brokerUrl, {
    reconnectPeriod: 3000,
  });

  client.on("connect", () => {
    console.log("MQTT connected. Subscribing to #");
    client.subscribe("#", (err) => {
      if (err) {
        console.error("MQTT subscribe error:", err.message);
      }
    });
  });

  client.on("message", (topic, message) => {
    let payload;
    try {
      payload = message.toString("utf8");
    } catch {
      payload = String(message);
    }
    pushMqttMessage(topic, payload);
  });

  client.on("error", (err) => {
    console.error("MQTT error:", err.message);
  });

  client.on("reconnect", () => {
    console.log("MQTT reconnecting...");
  });
}

io.on("connection", (socket) => {
  socket.emit("mqtt:history", mqttMessageBuffer);
});

startMqttBridge();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`home-grocery-stock-central listening on :${PORT}`);
});
