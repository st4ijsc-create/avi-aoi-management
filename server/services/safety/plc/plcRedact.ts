/**
 * doc 81 Đợt 8 Group N (N3 self-review; fix 1 review M3) — the safety-PLC ENDPOINT (host / port) never reaches a
 * safety_events row or a readSafetyPlc answer (the feed is readable by monitoring users). Leaf module: used by the
 * background poller AND by the user-triggered readSafetyPlc path (safetyPlcAdapter.readAndRecord).
 */

/** Unbracketed IPv6 (Node's net errors print "fd00::5:502"): ≥ 3 colons, or a "::", over hex groups (+ optional %zone). */
const IPV6_UNBRACKETED = /(?<![0-9a-z.:])(?:[0-9a-f]{0,4}:){2,8}[0-9a-f]{0,4}(?:%[0-9a-z_.-]+)?(?![0-9a-z.:])/gi;

/**
 * Remove the configured endpoint, its host, and any URL / IPv4[:port] / [IPv6]:port / unbracketed IPv6[:port] /
 * host:port token from a free text (driver error, label). Keeps the error class (ECONNREFUSED …).
 */
export function redactEndpoint(text: string, endpoint: string | null | undefined): string {
  let out = String(text);
  const ep = String(endpoint ?? "").trim();
  if (ep) {
    const host = ep.replace(/^[a-z.+-]+:\/\//i, "").replace(/\/.*$/, "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
    for (const needle of [ep, host].filter((x) => x.length > 0)) out = out.split(needle).join("<endpoint>");
  }
  return out
    .replace(/[a-z][a-z.+-]*:\/\/[^\s)'"]+/gi, "<endpoint>")
    .replace(/\[[0-9a-f:.%a-z_-]+\](?::\d+)?/gi, "<host>")
    .replace(IPV6_UNBRACKETED, (m) => (m.includes("::") || (m.match(/:/g) ?? []).length >= 3 ? "<host>" : m))
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "<host>")
    .replace(/<endpoint>:\d+/g, "<endpoint>")
    .replace(/\b[a-z0-9][a-z0-9.-]*:\d{2,5}\b/gi, "<host>");
}

/** A backend label WITHOUT the endpoint: "real modbus read" / "real opcua read" / "sim (scripted) — NOT a live PLC". */
export function safeBackendLabel(backend: { kind: string } | null | undefined): string {
  if (!backend) return "none";
  return backend.kind === "sim" ? "sim (scripted) — NOT a live PLC" : `real ${String(backend.kind).slice(0, 16)} read`;
}
