/**
 * doc 56 Đợt 1 (việc 10) — "Automation Process Feed" API-docs section.
 * Tài liệu endpoint RESULT `POST /api/v1/ingest/process-result` cho máy automation
 * (bắt vít / điểm keo / hàn…). Đặc tả đầy đủ: doc 57 (ST4I Standard Process Feed v1).
 * Presentational tĩnh: chỉ đọc `endpointBase`/`baseUrl` (props); nhãn chrome i18n hóa
 * qua namespace `apiFeeds`, phần code (curl/JSON) giữ nguyên literal.
 */

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Wrench, Shield, Gauge, Droplets, FileText, ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CodeBlock, glassCard } from "./shared";

interface ApiSectionProps {
  endpointBase: string;
  baseUrl: string;
}

export function AutomationProcessFeedSection({ baseUrl }: ApiSectionProps) {
  const { t } = useTranslation();
  const host = baseUrl || "https://<host>";

  const screwCurl = `# Máy bắt vít — screw_tightening (torque + góc + waveform)
curl -X POST "${host}/api/v1/ingest/process-result" \\
  -H "Authorization: ApiKey mk_live_9f3a…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "schemaVersion": "1.0",
    "machineCode": "SCRW-01",
    "serialNumber": "SN-2026-000777",
    "stepType": "screw_tightening",
    "result": "pass",
    "ts": "2026-07-17T14:03:00+07:00",
    "stationId": "ST-SCRW-A",
    "lineCode": "LINE-01",
    "productionOrderCode": "WO-20260717-01",
    "recipe": { "code": "TQ-M3-08", "version": "2.1" },
    "metrics": [
      { "name": "torque", "value": 0.82, "unit": "Nm", "lsl": 0.70, "usl": 0.95, "nominal": 0.82 },
      { "name": "angle",  "value": 412,  "unit": "deg" }
    ],
    "waveforms": [
      { "name": "torque_vs_angle", "unit": "Nm", "rateHz": 500,
        "samples": [[0,0.02],[180,0.38],[360,0.79],[412,0.82]] }
    ],
    "idempotencyKey": "SCRW-01:TQ-M3-08:88123"
  }'`;

  const screwPython = `import requests

BASE = "${host}"
HEADERS = {"Authorization": "ApiKey mk_live_9f3a…"}

payload = {
    "schemaVersion": "1.0",
    "machineCode": "SCRW-01",
    "serialNumber": "SN-2026-000777",
    "stepType": "screw_tightening",
    "result": "pass",
    "ts": "2026-07-17T14:03:00+07:00",
    "recipe": {"code": "TQ-M3-08", "version": "2.1"},
    "metrics": [
        {"name": "torque", "value": 0.82, "unit": "Nm", "lsl": 0.70, "usl": 0.95},
        {"name": "angle",  "value": 412,  "unit": "deg"},
    ],
    "idempotencyKey": "SCRW-01:TQ-M3-08:88123",  # retry an toàn (exactly-once)
}
r = requests.post(f"{BASE}/api/v1/ingest/process-result", json=payload,
                  headers=HEADERS, timeout=10)
print(r.status_code, r.json())`;

  const glueCurl = `# Máy điểm keo — glue_dispense (volume/pressure)
curl -X POST "${host}/api/v1/ingest/process-result" \\
  -H "Authorization: ApiKey mk_live_9f3a…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "schemaVersion": "1.0",
    "machineCode": "GLUE-02",
    "serialNumber": "SN-2026-000777",
    "stepType": "glue_dispense",
    "result": "warn",
    "ts": "2026-07-17T14:05:12+07:00",
    "recipe": { "code": "GLU-DOT-05", "version": "1.0" },
    "metrics": [
      { "name": "volume",   "value": 0.118, "unit": "mL",  "lsl": 0.100, "usl": 0.140, "nominal": 0.120 },
      { "name": "pressure", "value": 305,   "unit": "kPa", "lsl": 280,   "usl": 360 }
    ],
    "idempotencyKey": "GLUE-02:GLU-DOT-05:44219",
    "rawExtras": { "nozzleTempC": 41.2 }
  }'`;

  const successResponse = `{
  "ok": true,
  "data": {
    "processResultId": 100482,
    "idempotent": false,
    "serverReceivedAt": "2026-07-17T07:03:00.512Z"
  }
}`;

  const errorResponse = `// 400 — giờ naive (thiếu offset) bị reject
{
  "ok": false,
  "error": {
    "code": "naive_timestamp",
    "message": "ts must be RFC 3339 with an explicit offset (e.g. +07:00 or Z)"
  }
}`;

  const validateSnippet = `// Tự kiểm chứng offline — KHÔNG ghi DB (contract process-result@1.0)
const r = await trpc.machineContract.validate.mutate({
  version: "process-result@1.0",
  payload: { /* payload phía trên */ }
});
// { ok: true, version: "process-result@1.0" }  hoặc
// { ok: false, version, errors: [{ path: "serialNumber", message: "..." }] }`;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            {t("apiFeeds.processTitle")}
          </CardTitle>
          <CardDescription>{t("apiFeeds.processDesc")}</CardDescription>
        </CardHeader>
      </Card>

      {/* Authentication */}
      <Card className={glassCard}>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="h-4 w-4" />
            {t("apiFeeds.authTitle")}
          </CardTitle>
          <CardDescription>{t("apiFeeds.authDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Authorization: ApiKey mk_…</Badge>
            <Badge variant="outline">X-API-Key</Badge>
            <Badge variant="outline">scope: ingest:write</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{t("apiFeeds.authIssue")}</p>
        </CardContent>
      </Card>

      {/* Endpoint + examples */}
      <Card className={glassCard}>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Badge className="bg-success text-success-foreground">POST</Badge>
            <code className="text-sm text-white">/api/v1/ingest/process-result</code>
          </div>
          <CardDescription>{t("apiFeeds.processEndpointDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs defaultValue="screw">
            <TabsList>
              <TabsTrigger value="screw" className="gap-2">
                <Gauge className="h-4 w-4" />
                {t("apiFeeds.exampleScrew")}
              </TabsTrigger>
              <TabsTrigger value="glue" className="gap-2">
                <Droplets className="h-4 w-4" />
                {t("apiFeeds.exampleGlue")}
              </TabsTrigger>
              <TabsTrigger value="python">Python</TabsTrigger>
            </TabsList>
            <TabsContent value="screw">
              <p className="mb-2 text-sm font-semibold">{t("apiFeeds.requestLabel")}</p>
              <CodeBlock code={screwCurl} language="bash" />
            </TabsContent>
            <TabsContent value="glue">
              <p className="mb-2 text-sm font-semibold">{t("apiFeeds.requestLabel")}</p>
              <CodeBlock code={glueCurl} language="bash" />
            </TabsContent>
            <TabsContent value="python">
              <p className="mb-2 text-sm font-semibold">{t("apiFeeds.requestLabel")}</p>
              <CodeBlock code={screwPython} language="python" />
            </TabsContent>
          </Tabs>
          <div>
            <p className="mb-2 text-sm font-semibold">{t("apiFeeds.responseLabel")}</p>
            <CodeBlock code={successResponse} language="json" />
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-amber-500">{t("apiFeeds.rejectLabel")}</p>
            <CodeBlock code={errorResponse} language="json" />
          </div>
        </CardContent>
      </Card>

      {/* Field table (short) */}
      <Card className={glassCard}>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {t("apiFeeds.fieldsTitle")}
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
                <tr><td className="p-2 border-b border-white/10"><code>schemaVersion</code></td><td className="p-2 border-b border-white/10">string</td><td className="p-2 border-b border-white/10">✔</td><td className="p-2 border-b border-white/10">"1.0"; version lạ → reject</td></tr>
                <tr><td className="p-2 border-b border-white/10"><code>serialNumber</code></td><td className="p-2 border-b border-white/10">string</td><td className="p-2 border-b border-white/10">✔</td><td className="p-2 border-b border-white/10">Serial của unit — trục genealogy</td></tr>
                <tr><td className="p-2 border-b border-white/10"><code>stepType</code></td><td className="p-2 border-b border-white/10">enum</td><td className="p-2 border-b border-white/10">✔</td><td className="p-2 border-b border-white/10">screw_tightening | glue_dispense | weld_spot | leak_test | functional_test | press_fit | label_apply | vision_check</td></tr>
                <tr><td className="p-2 border-b border-white/10"><code>result</code></td><td className="p-2 border-b border-white/10">enum</td><td className="p-2 border-b border-white/10">✔</td><td className="p-2 border-b border-white/10">pass | fail | warn | skip</td></tr>
                <tr><td className="p-2 border-b border-white/10"><code>ts</code></td><td className="p-2 border-b border-white/10">ISO 8601</td><td className="p-2 border-b border-white/10">✔</td><td className="p-2 border-b border-white/10">Offset bắt buộc (+07:00 / Z) — naive bị reject</td></tr>
                <tr><td className="p-2 border-b border-white/10"><code>machineCode</code></td><td className="p-2 border-b border-white/10">string</td><td className="p-2 border-b border-white/10">cond.</td><td className="p-2 border-b border-white/10">Thay bằng mk_ (ingest context override)</td></tr>
                <tr><td className="p-2 border-b border-white/10"><code>recipe</code></td><td className="p-2 border-b border-white/10">object</td><td className="p-2 border-b border-white/10">—</td><td className="p-2 border-b border-white/10">{`{ code, version?, checksum? }`}</td></tr>
                <tr><td className="p-2 border-b border-white/10"><code>metrics[]</code></td><td className="p-2 border-b border-white/10">array</td><td className="p-2 border-b border-white/10">—</td><td className="p-2 border-b border-white/10">{`{ name, value, unit?, lsl?, usl?, nominal? }`} — đơn vị chuẩn Nm/deg/mL/kPa/°C/A/Hz</td></tr>
                <tr><td className="p-2 border-b border-white/10"><code>waveforms[]</code></td><td className="p-2 border-b border-white/10">array</td><td className="p-2 border-b border-white/10">—</td><td className="p-2 border-b border-white/10">{`{ name, unit?, rateHz?, samples:[[t,v]] }`} — cap ~64KB/message</td></tr>
                <tr><td className="p-2 border-b border-white/10"><code>idempotencyKey</code></td><td className="p-2 border-b border-white/10">string</td><td className="p-2 border-b border-white/10">—</td><td className="p-2 border-b border-white/10">Exactly-once; dedup theo (machineId, idempotencyKey)</td></tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Conformance / self-test */}
      <Card className={glassCard}>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ListChecks className="h-4 w-4" />
            {t("apiFeeds.conformanceTitle")}
          </CardTitle>
          <CardDescription>{t("apiFeeds.conformanceDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <CodeBlock code={validateSnippet} language="typescript" />
        </CardContent>
      </Card>

      {/* Link to doc 57 */}
      <div className="rounded-2xl border border-dashed border-indigo-400/30 bg-indigo-500/5 p-5 text-sm text-white/90">
        <h4 className="mb-1 font-semibold text-indigo-300">{t("apiFeeds.specLinkTitle")}</h4>
        <p>{t("apiFeeds.specLinkText")}</p>
        <p className="mt-1 text-white/60">
          <code>docs/ECOSYSTEM/57_ST4I_STANDARD_PROCESS_FEED_SPEC.md</code>
        </p>
      </div>
    </div>
  );
}
