/**
 * doc 56 Đợt 1 (việc 10) — "IoT Telemetry" API-docs section.
 * Tài liệu đường TELEMETRY `POST /api/v1/ingest/telemetry` (alias versioned của
 * `/api/ot/ingest` đang LIVE) — dòng đo liên tục CanonicalSample[]: ESP32 nhiệt-ẩm,
 * mô-men trục máy vít… Đặc tả đầy đủ: doc 57 §9. Presentational tĩnh; nhãn chrome
 * i18n hóa qua namespace `apiFeeds`, phần code (curl/JSON) giữ nguyên literal.
 */

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioTower, Shield, Thermometer, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CodeBlock, glassCard } from "./shared";

interface ApiSectionProps {
  endpointBase: string;
  baseUrl: string;
}

/**
 * The request/response examples shown on this page — exported so a test can check them against the REAL
 * server ingest rules (key ↔ machine, gateway allowlist, timestamp with timezone).
 */
export function buildTelemetryDocExamples(host: string) {
  // doc 81 Đợt 5 G2 (item 8): examples follow the live rules — a machine key writes only for ITS machine
  // (deviceId omitted or = that machine's code, else 403 machine_mismatch); an IOT_GATEWAY key writes only
  // for devices on its allowlist (else / empty list ⇒ 403 gateway_device_not_allowed); every `ts` carries a
  // timezone (naive ⇒ rejected ts_no_timezone). /api/v1 reads `Authorization: Bearer <key>` or `X-API-Key`.
  const deviceKeyMachine = "IOT-WS3-01";
  const screwMachine = "SCRW-01";
  const gatewayMachine = "GW-LINE3";
  const gatewayAllowlist = ["ESP32-ENV-01", "ESP32-ENV-02"];

  const deviceCurl = `# One device, its OWN machine key: deviceId = the key's machine code (or omit it)
curl -X POST "${host}/api/v1/ingest/telemetry" \\
  -H "Authorization: Bearer mk_live_9f3a…" \\
  -H "Content-Type: application/json" \\
  -d '{"samples":[
    {"deviceId":"${deviceKeyMachine}","metric":"temperature","value":27.4,"unit":"°C","ts":"2026-07-17T14:03:00+07:00"},
    {"deviceId":"${deviceKeyMachine}","metric":"humidity","value":61.2,"unit":"%RH","ts":"2026-07-17T14:03:00+07:00"}
  ]}'`;

  const gatewayCurl = `# IoT gateway (machine type IOT_GATEWAY) forwarding several devices:
# every deviceId must be on THIS gateway's allowlist (${gatewayAllowlist.join(", ")}).
curl -X POST "${host}/api/v1/ingest/telemetry" \\
  -H "X-API-Key: mk_live_gw77…" \\
  -H "Content-Type: application/json" \\
  -d '{"samples":[
    {"deviceId":"${gatewayAllowlist[0]}","metric":"temperature","value":31.4,"unit":"°C","ts":"2026-07-17T07:03:00Z"},
    {"deviceId":"${gatewayAllowlist[1]}","metric":"temperature","value":29.8,"unit":"°C","ts":"2026-07-17T07:03:00Z"}
  ]}'`;

  const screwTelemetryCurl = `# Screwdriver machine — spindle stream alongside RESULT (key of machine ${screwMachine})
curl -X POST "${host}/api/v1/ingest/telemetry" \\
  -H "Authorization: Bearer mk_live_5c1d…" \\
  -H "Content-Type: application/json" \\
  -d '{"samples":[
    {"deviceId":"${screwMachine}","metric":"spindle.torque","value":0.81,"unit":"Nm","quality":"good","ts":"2026-07-17T14:03:00+07:00"},
    {"deviceId":"${screwMachine}","metric":"spindle.current","value":1.24,"unit":"A","ts":"2026-07-17T14:03:00+07:00"}
  ]}'`;

  const python = `import requests
from datetime import datetime, timezone

BASE = "${host}"
HEADERS = {"Authorization": "Bearer mk_live_9f3a…"}
TS = datetime.now(timezone.utc).isoformat()  # ALWAYS timezone-aware (naive ⇒ ts_no_timezone)

batch = {"samples": [
    {"deviceId": "${deviceKeyMachine}", "metric": "temperature", "value": 27.4,
     "unit": "°C", "ts": TS},
    {"deviceId": "${deviceKeyMachine}", "metric": "humidity", "value": 61.2,
     "unit": "%RH", "ts": TS},
]}
r = requests.post(f"{BASE}/api/v1/ingest/telemetry", json=batch,
                  headers=HEADERS, timeout=10)
print(r.status_code, r.json())  # 202 {"ok": true, "data": {"accepted": 2, "received": 2, "machine": "${deviceKeyMachine}"}}`;

  const telemetryResponse = `{
  "ok": true,
  "data": { "accepted": 2, "received": 2, "machine": "${deviceKeyMachine}" }
}`;

  return {
    deviceCurl,
    gatewayCurl,
    screwTelemetryCurl,
    python,
    telemetryResponse,
    deviceKeyMachine,
    screwMachine,
    gatewayMachine,
    gatewayAllowlist,
  };
}

/** [HTTP status, error.code (or body), i18n key of the explanation]. Codes are literal API values. */
const TELEMETRY_STATUS_ROWS: ReadonlyArray<readonly [string, string, string]> = [
  ["202", "ok", "apiFeeds.status202"],
  ["207", "partial", "apiFeeds.status207"],
  ["400", "bad_request", "apiFeeds.status400BadRequest"],
  ["400", "all_rejected", "apiFeeds.status400AllRejected"],
  ["401", "unauthorized", "apiFeeds.status401"],
  ["403", "forbidden", "apiFeeds.status403Scope"],
  ["403", "machine_mismatch", "apiFeeds.status403Machine"],
  ["403", "gateway_device_not_allowed", "apiFeeds.status403Gateway"],
  ["429", "Retry-After", "apiFeeds.status429"],
  ["503", "db_unavailable", "apiFeeds.status503"],
];

export function IoTTelemetrySection({ baseUrl }: ApiSectionProps) {
  const { t } = useTranslation();
  const host = baseUrl || "https://<host>";
  const { deviceCurl, gatewayCurl, screwTelemetryCurl, python, telemetryResponse } = buildTelemetryDocExamples(host);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RadioTower className="h-5 w-5" />
            {t("apiFeeds.telemetryTitle")}
          </CardTitle>
          <CardDescription>{t("apiFeeds.telemetryDesc")}</CardDescription>
        </CardHeader>
      </Card>

      {/* Authentication */}
      <Card className={glassCard}>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="h-4 w-4" />
            {t("apiFeeds.authTitle")}
          </CardTitle>
          <CardDescription>{t("apiFeeds.telemetryAuthDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Authorization: Bearer mk_…</Badge>
            <Badge variant="outline">X-API-Key</Badge>
            <Badge variant="outline">alias: /api/ot/ingest</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Endpoint + examples */}
      <Card className={glassCard}>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Badge className="bg-success text-success-foreground">POST</Badge>
            <code className="text-sm text-white">/api/v1/ingest/telemetry</code>
          </div>
          <CardDescription>{t("apiFeeds.telemetryEndpointDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs defaultValue="esp32">
            <TabsList>
              <TabsTrigger value="esp32" className="gap-2">
                <Thermometer className="h-4 w-4" />
                {t("apiFeeds.exampleEsp32")}
              </TabsTrigger>
              <TabsTrigger value="gateway">{t("apiFeeds.exampleGateway")}</TabsTrigger>
              <TabsTrigger value="screw">{t("apiFeeds.exampleScrewTelemetry")}</TabsTrigger>
              <TabsTrigger value="python">Python</TabsTrigger>
            </TabsList>
            <TabsContent value="esp32">
              <p className="mb-2 text-sm font-semibold">{t("apiFeeds.requestLabel")}</p>
              <CodeBlock code={deviceCurl} language="bash" />
            </TabsContent>
            <TabsContent value="gateway">
              <p className="mb-2 text-sm font-semibold">{t("apiFeeds.requestLabel")}</p>
              <CodeBlock code={gatewayCurl} language="bash" />
            </TabsContent>
            <TabsContent value="screw">
              <p className="mb-2 text-sm font-semibold">{t("apiFeeds.requestLabel")}</p>
              <CodeBlock code={screwTelemetryCurl} language="bash" />
            </TabsContent>
            <TabsContent value="python">
              <p className="mb-2 text-sm font-semibold">{t("apiFeeds.requestLabel")}</p>
              <CodeBlock code={python} language="python" />
            </TabsContent>
          </Tabs>
          <div>
            <p className="mb-2 text-sm font-semibold">{t("apiFeeds.responseLabel")}</p>
            <CodeBlock code={telemetryResponse} language="json" />
          </div>
          <p className="text-sm text-white/80" data-testid="telemetry-gateway-note">{t("apiFeeds.gatewayNote")}</p>
        </CardContent>
      </Card>

      {/* doc 81 Đợt 5 G2 — HTTP codes the endpoint really returns (same for /api/ot/ingest, without the data wrapper) */}
      <Card className={glassCard}>
        <CardHeader>
          <CardTitle className="text-lg">{t("apiFeeds.telemetryStatusTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-white/10 rounded" data-testid="telemetry-status-table">
              <tbody>
                {TELEMETRY_STATUS_ROWS.map(([http, code, key]) => (
                  <tr key={`${http}-${code}`}>
                    <td className="p-2 border-b border-white/10 font-mono">{http}</td>
                    <td className="p-2 border-b border-white/10"><code>{code}</code></td>
                    <td className="p-2 border-b border-white/10">{t(key)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Field table (short) — CanonicalSample */}
      <Card className={glassCard}>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {t("apiFeeds.telemetryFieldsTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-white/10 rounded">
              <thead className="bg-white/5">
                <tr>
                  <th className="text-left p-2 border-b border-white/10">{t("apiFeeds.colField")}</th>
                  <th className="text-left p-2 border-b border-white/10">{t("apiFeeds.colType")}</th>
                  <th className="text-left p-2 border-b border-white/10">{t("apiFeeds.colRequired")}</th>
                  <th className="text-left p-2 border-b border-white/10">{t("apiFeeds.colDescription")}</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className="p-2 border-b border-white/10"><code>metric</code></td><td className="p-2 border-b border-white/10">string</td><td className="p-2 border-b border-white/10">✔</td><td className="p-2 border-b border-white/10">Tên metric (temperature, humidity, spindle.torque…)</td></tr>
                <tr><td className="p-2 border-b border-white/10"><code>value</code></td><td className="p-2 border-b border-white/10">number|string|bool</td><td className="p-2 border-b border-white/10">✔</td><td className="p-2 border-b border-white/10">Giá trị mẫu</td></tr>
                <tr><td className="p-2 border-b border-white/10"><code>ts</code></td><td className="p-2 border-b border-white/10">ISO 8601 + TZ</td><td className="p-2 border-b border-white/10">—</td><td className="p-2 border-b border-white/10">{t("apiFeeds.fieldTsDesc")}</td></tr>
                <tr><td className="p-2 border-b border-white/10"><code>deviceId</code></td><td className="p-2 border-b border-white/10">string</td><td className="p-2 border-b border-white/10">—</td><td className="p-2 border-b border-white/10">{t("apiFeeds.fieldDeviceIdDesc")}</td></tr>
                <tr><td className="p-2 border-b border-white/10"><code>unit</code></td><td className="p-2 border-b border-white/10">string</td><td className="p-2 border-b border-white/10">—</td><td className="p-2 border-b border-white/10">°C, %RH, Nm, A… (đơn vị chuẩn)</td></tr>
                <tr><td className="p-2 border-b border-white/10"><code>quality</code></td><td className="p-2 border-b border-white/10">enum</td><td className="p-2 border-b border-white/10">—</td><td className="p-2 border-b border-white/10">good | uncertain | bad (mặc định good)</td></tr>
                <tr><td className="p-2 border-b border-white/10"><code>meta</code></td><td className="p-2 border-b border-white/10">object</td><td className="p-2 border-b border-white/10">—</td><td className="p-2 border-b border-white/10">Namespace mở rộng vendor (bảo toàn)</td></tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Link to doc 57 */}
      <div className="rounded-2xl border border-dashed border-indigo-400/30 bg-indigo-500/5 p-5 text-sm text-white/90">
        <h4 className="mb-1 font-semibold text-indigo-300">{t("apiFeeds.specLinkTitle")}</h4>
        <p>{t("apiFeeds.telemetrySpecLinkText")}</p>
        <p className="mt-1 text-white/60">
          <code>docs/ECOSYSTEM/57_ST4I_STANDARD_PROCESS_FEED_SPEC.md</code> §9
        </p>
      </div>
    </div>
  );
}
