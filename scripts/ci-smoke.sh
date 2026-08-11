#!/usr/bin/env bash
# Smoke / integration checks for the CI compose stack (no Frigate).
set -euo pipefail

BRIDGE_URL="${BRIDGE_URL:-http://localhost:9000}"
CENTRAL_URL="${CENTRAL_URL:-http://localhost:80}"
GROCY_URL="${GROCY_URL:-http://localhost:9283}"
MQTT_HOST="${MQTT_HOST:-localhost}"
MQTT_PORT="${MQTT_PORT:-1883}"
CAMERA="${CAMERA:-fridge_zone}"
TIMEOUT_SECS="${TIMEOUT_SECS:-180}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

need_cmd curl
need_cmd jq

wait_http() {
  local url=$1
  local name=$2
  local elapsed=0
  echo "Waiting for ${name} at ${url}..."
  until curl -sf --max-time 5 "${url}" >/dev/null 2>&1; do
    sleep 2
    elapsed=$((elapsed + 2))
    if [[ "${elapsed}" -ge "${TIMEOUT_SECS}" ]]; then
      echo "Timed out waiting for ${name} (${url})" >&2
      exit 1
    fi
  done
  echo "OK: ${name} is up"
}

assert_json_eq() {
  local actual=$1
  local expected=$2
  local label=$3
  if [[ "${actual}" != "${expected}" ]]; then
    echo "Assertion failed (${label}): expected '${expected}', got '${actual}'" >&2
    exit 1
  fi
}

echo "==> Waiting for services"
wait_http "${BRIDGE_URL}/" "bridge"
wait_http "${CENTRAL_URL}/api/health" "central"
wait_http "${GROCY_URL}/" "grocy"

echo "==> Bridge health"
bridge_health=$(curl -sf "${BRIDGE_URL}/")
assert_json_eq "$(echo "${bridge_health}" | jq -r '.status')" "ok" "bridge status"
assert_json_eq "$(echo "${bridge_health}" | jq -r '.service')" "hgs-bridge" "bridge service"

echo "==> Central health"
central_health=$(curl -sf "${CENTRAL_URL}/api/health")
assert_json_eq "$(echo "${central_health}" | jq -r '.status')" "ok" "central status"

echo "==> Central → bridge proxy"
curl -sf "${CENTRAL_URL}/api/bridge/state" | jq -e '.cameras' >/dev/null
curl -sf "${CENTRAL_URL}/api/bridge/openapi" | jq -e '.' >/dev/null
echo "OK: proxy routes respond"

echo "==> Detect toggle session"
curl -sf -X POST "${BRIDGE_URL}/api/detect/${CAMERA}/on" | jq -e '.status == "success"' >/dev/null
active_on=$(curl -sf "${BRIDGE_URL}/api/state" | jq -r ".cameras.\"${CAMERA}\".active")
assert_json_eq "${active_on}" "true" "camera active after on"

curl -sf -X POST "${BRIDGE_URL}/api/detect/${CAMERA}/off" | jq -e '.status == "success"' >/dev/null
active_off=$(curl -sf "${BRIDGE_URL}/api/state" | jq -r ".cameras.\"${CAMERA}\".active")
assert_json_eq "${active_off}" "false" "camera active after off"
echo "OK: detect on/off cycle"

echo "==> MQTT broker reachability"
if command -v mosquitto_pub >/dev/null 2>&1 && command -v mosquitto_sub >/dev/null 2>&1; then
  topic="hgs/ci/smoke"
  payload="ci-$(date +%s)"
  (
    timeout 10 mosquitto_sub -h "${MQTT_HOST}" -p "${MQTT_PORT}" -t "${topic}" -C 1
  ) >"/tmp/hgs-mqtt-smoke.out" &
  sub_pid=$!
  sleep 1
  mosquitto_pub -h "${MQTT_HOST}" -p "${MQTT_PORT}" -t "${topic}" -m "${payload}"
  wait "${sub_pid}"
  received=$(cat /tmp/hgs-mqtt-smoke.out)
  assert_json_eq "${received}" "${payload}" "mqtt round-trip"
  echo "OK: MQTT pub/sub"
else
  # Fallback: TCP connect check when mosquitto clients are unavailable
  if command -v nc >/dev/null 2>&1; then
    nc -z "${MQTT_HOST}" "${MQTT_PORT}"
    echo "OK: MQTT port open (nc; mosquitto clients not installed)"
  else
    (echo >/dev/tcp/"${MQTT_HOST}"/"${MQTT_PORT}") >/dev/null 2>&1
    echo "OK: MQTT port open (/dev/tcp; mosquitto clients not installed)"
  fi
fi

echo "==> All smoke checks passed"
