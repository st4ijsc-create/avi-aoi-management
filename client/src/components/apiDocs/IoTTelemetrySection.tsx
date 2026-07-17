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

export function IoTTelemetrySection({ baseUrl }: ApiSectionProps) {
  const { t } = useTranslation();
  const host = baseUrl || "https://<host>";

  const esp32Curl = `# ESP32 nhiệt-ẩm — batch [temperature, humidity] mỗi ~30s
curl -X POST "${host}/api/v1/ingest/telemetry" \\
  -H "Authorization: ApiKey mk_live_9f3a…" \\
  -H "Content-Type: application/json" \\
  -d '{"samples":[
    {"deviceId":"esp32-ws3-01","metric":"temperature","value":27.4,"unit":"°C","ts":"2026-07-17T14:03:00+07:00"},
    {"deviceId":"esp32-ws3-01","metric":"humidity","value":61.2,"unit":"%RH","ts":"2026-07-17T14:03:00+07:00"}
  ]}'`;

  const screwTelemetryCurl = `# Máy bắt vít — stream mô-men trục song song với RESULT
curl -X POST "${host}/api/v1/ingest/telemetry" \\
  -H "Authorization: ApiKey mk_live_9f3a…" \\
  -H "Content-Type: application/json" \\
  -d '{"samples":[
    {"deviceId":"SCRW-01","metric":"spindle.torque","value":0.81,"unit":"Nm","quality":"good","ts":"2026-07-17T14:03:00+07:00"},
    {"deviceId":"SCRW-01","metric":"spindle.current","value":1.24,"unit":"A","ts":"2026-07-17T14:03:00+07:00"}
  ]}'`;

  const esp32Python = `import requests

BASE = "${host}"
HEADERS = {"Authorization": "ApiKey mk_live_9f3a…"}

batch = {"samples": [
    {"deviceId": "esp32-ws3-01", "metric": "temperature", "value": 27.4,
     "unit": "°C", "ts": "2026-07-17T14:03:00+07:00"},
    {"deviceId": "esp32-ws3-01", "metric": "humidity", "value": 61.2,
     "unit": "%RH", "ts": "2026-07-17T14:03:00+07:00"},
]}
r = requests.post(f"{BASE}/api/v1/ingest/telemetry", json=batch,
                  headers=HEADERS, timeout=10)
print(r.status_code, r.json())  # {"ok": true, "accepted": 2, "received": 2, ...}`;

  const telemetryResponse = `{
  "ok": true,
  "accepted": 2,
  "received": 2,
  "machine": "IOT-WS3-01"
}`;

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
            <Badge variant="outline">Authorization: ApiKey mk_…</Badge>
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
              <TabsTrigger value="screw">{t("apiFeeds.exampleScrewTelemetry")}</TabsTrigger>
              <TabsTrigger value="python">Python</TabsTrigger>
            </TabsList>
            <TabsContent value="esp32">
              <p className="mb-2 text-sm font-semibold">{t("apiFeeds.requestLabel")}</p>
              <CodeBlock code={esp32Curl} language="bash" />
            </TabsContent>
            <TabsContent value="screw">
              <p className="mb-2 text-sm font-semibold">{t("apiFeeds.requestLabel")}</p>
              <CodeBlock code={screwTelemetryCurl} language="bash" />
            </TabsContent>
            <TabsContent value="python">
              <p className="mb-2 text-sm font-semibold">{t("apiFeeds.requestLabel")}</p>
              <CodeBlock code={esp32Python} language="python" />
            </TabsContent>
          </Tabs>
          <div>
            <p className="mb-2 text-sm font-semibold">{t("apiFeeds.responseLabel")}</p>
            <CodeBlock code={telemetryResponse} language="json" />
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
                <tr><td className="p-2 border-b border-white/10"><code>ts</code></td><td className="p-2 border-b border-white/10">ISO 8601</td><td className="p-2 border-b border-white/10">—</td><td className="p-2 border-b border-white/10">Offset khuyến nghị; vắng → server đóng dấu giờ nhận</td></tr>
                <tr><td className="p-2 border-b border-white/10"><code>deviceId</code></td><td className="p-2 border-b border-white/10">string</td><td className="p-2 border-b border-white/10">—</td><td className="p-2 border-b border-white/10">1 gateway credential forward nhiều device</td></tr>
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
