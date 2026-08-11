const GROCY_PORT = import.meta.env.VITE_GROCY_PORT || "9283";
const FRIGATE_PORT = import.meta.env.VITE_FRIGATE_PORT || "5000";

export function serviceUrl(port) {
  const host = window.location.hostname || "localhost";
  return `http://${host}:${port}`;
}

export function grocyUrl() {
  return serviceUrl(GROCY_PORT);
}

export function frigateUrl() {
  return serviceUrl(FRIGATE_PORT);
}
