/**
 * doc 48 R4 (tech-debt) — "Hierarchy Tree & MQTT" API-docs section extracted VERBATIM from
 * ApiDocs.tsx. PURE RELOCATION: presentational static-docs section. Reads only
 * `endpointBase`/`baseUrl` (threaded as props); no shared mutable state. JSX and the
 * section's example-string constants were moved unchanged — no behavior change.
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Network,
} from "lucide-react";
import { CodeBlock, glassCard } from "./shared";

interface ApiSectionProps {
  endpointBase: string;
  baseUrl: string;
}

export function HierarchyTreeSection({ endpointBase, baseUrl }: ApiSectionProps) {
  return (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Network className="h-5 w-5" />
                    Hierarchy Tree & MQTT Subscription APIs
                  </CardTitle>
                  <CardDescription>
                    API lấy cây phân cấp Factory → Workshop → Line → Station → Machine và tự động sinh chuỗi MQTT Subscription topics tối ưu cho App client.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">hierarchyTree.getTree — Toàn bộ cây phân cấp</CardTitle>
                  <CardDescription>Lấy toàn bộ cây Factory → Workshop → Line → Station → Machine. Dùng để hiển thị tree selector trên App.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">Request (tRPC Query — Protected)</h4>
                    <CodeBlock code={`const { data } = trpc.hierarchyTree.getTree.useQuery();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">REST equivalent</h4>
                    <CodeBlock code={`GET ${endpointBase}/hierarchyTree.getTree
Headers: Cookie: auth-session=<jwt>`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Response</h4>
                    <CodeBlock code={`[
  {
    "id": 1,
    "code": "FAC-001",
    "name": "Nhà máy Bắc Ninh",
    "workshops": [
      {
        "id": 1,
        "code": "WS-SMT",
        "name": "Xưởng SMT",
        "lines": [
          {
            "id": 1,
            "code": "LINE-A",
            "name": "Dây chuyền A",
            "stations": [
              {
                "id": 1,
                "code": "ST-A01",
                "name": "Station AOI-01",
                "orderIndex": 1,
                "machines": [
                  {
                    "id": 5,
                    "code": "AOI-01",
                    "name": "AOI Machine #1",
                    "machineType": "AOI",
                    "operationStatus": "running"
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
]`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">hierarchyTree.getFactoryTree — Cây 1 Factory</CardTitle>
                  <CardDescription>Lấy cây phân cấp cho 1 factory cụ thể (chỉ trả về active entities).</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">Request</h4>
                    <CodeBlock code={`const { data } = trpc.hierarchyTree.getFactoryTree.useQuery({ factoryId: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">REST equivalent</h4>
                    <CodeBlock code={`GET ${endpointBase}/hierarchyTree.getFactoryTree?input={"factoryId":1}
Headers: Cookie: auth-session=<jwt>`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Response</h4>
                    <CodeBlock code={`// Trả về 1 FactoryNode (hoặc null nếu không tìm thấy)
{
  "id": 1,
  "code": "FAC-001",
  "name": "Nhà máy Bắc Ninh",
  "workshops": [ ... ]
}`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">hierarchyTree.getMqttTopics — Sinh MQTT Topics tối ưu</CardTitle>
                  <CardDescription>
                    Tự động sinh danh sách MQTT subscription topics theo scope level. App client dùng để subscribe đúng topic cần thiết, tối ưu băng thông.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">Request</h4>
                    <CodeBlock code={`// Subscribe tất cả
const { data } = trpc.hierarchyTree.getMqttTopics.useQuery({
  level: "all"
});

// Subscribe 1 factory
const { data } = trpc.hierarchyTree.getMqttTopics.useQuery({
  level: "factory",
  factoryId: 1
});

// Subscribe 1 workshop
const { data } = trpc.hierarchyTree.getMqttTopics.useQuery({
  level: "workshop",
  factoryId: 1,
  workshopId: 2
});

// Subscribe tất cả station trong 1 line
const { data } = trpc.hierarchyTree.getMqttTopics.useQuery({
  level: "line",
  lineId: 3
});

// Subscribe 1 station cụ thể
const { data } = trpc.hierarchyTree.getMqttTopics.useQuery({
  level: "station",
  stationId: 5
});

// Chỉ subscribe errors + inspection (bỏ heartbeat, status)
const { data } = trpc.hierarchyTree.getMqttTopics.useQuery({
  level: "factory",
  factoryId: 1,
  messageTypes: ["errors", "inspection"]
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Response</h4>
                    <CodeBlock code={`[
  {
    "topic": "avi/1/workshop/+/station/+/#",
    "description": "Nhà máy Bắc Ninh - all messages",
    "qos": 1
  },
  // Hoặc khi chỉ định messageTypes:
  {
    "topic": "avi/1/workshop/+/station/+/errors",
    "description": "Nhà máy Bắc Ninh - errors",
    "qos": 2
  },
  {
    "topic": "avi/1/workshop/+/station/+/inspection",
    "description": "Nhà máy Bắc Ninh - inspection",
    "qos": 1
  }
]`} />
                  </div>
                  <div className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-4 text-sm text-white/80">
                    <h4 className="mb-2 font-semibold text-white">Scope Levels & Wildcards</h4>
                    <ul className="list-disc space-y-1 pl-5">
                      <li><strong>all</strong>: <code className="text-white">avi/+/workshop/+/station/+/#</code> — subscribe toàn bộ hệ thống</li>
                      <li><strong>factory</strong>: <code className="text-white">{`avi/{factoryId}/workshop/+/station/+/#`}</code> — wildcard cho workshop & station</li>
                      <li><strong>workshop</strong>: <code className="text-white">{`avi/{fId}/workshop/{wId}/station/+/#`}</code> — wildcard cho station</li>
                      <li><strong>line</strong>: Liệt kê từng station topic thuộc line đó (không dùng wildcard)</li>
                      <li><strong>station</strong>: <code className="text-white">{`avi/{fId}/workshop/{wId}/station/{sId}/#`}</code> — exact match</li>
                    </ul>
                  </div>
                  <div className="rounded-2xl border border-dashed border-yellow-400/30 bg-yellow-500/5 p-4 text-sm text-white/90">
                    <h4 className="mb-2 font-semibold text-yellow-300">QoS mặc định theo message type</h4>
                    <ul className="list-disc space-y-1 pl-5">
                      <li><strong>errors</strong>: QoS 2 (exactly once — đảm bảo không mất cảnh báo NG)</li>
                      <li><strong>inspection, summary/daily, summary/weekly</strong>: QoS 1 (at least once)</li>
                      <li><strong>status, heartbeat</strong>: QoS 0 (at most once — realtime, có thể mất)</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">hierarchyTree.getMqttMessageTypes — Danh sách Message Types</CardTitle>
                  <CardDescription>Lấy danh sách tất cả MQTT message types hỗ trợ, kèm QoS và mô tả.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">Request</h4>
                    <CodeBlock code={`const { data } = trpc.hierarchyTree.getMqttMessageTypes.useQuery();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Response</h4>
                    <CodeBlock code={`[
  { "type": "inspection",     "qos": 1, "description": "Kết quả kiểm tra" },
  { "type": "errors",         "qos": 2, "description": "Cảnh báo NG" },
  { "type": "status",         "qos": 0, "description": "Trạng thái máy" },
  { "type": "heartbeat",      "qos": 0, "description": "Heartbeat" },
  { "type": "summary/daily",  "qos": 1, "description": "Báo cáo ngày" },
  { "type": "summary/weekly", "qos": 1, "description": "Báo cáo tuần" }
]`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">hierarchyTree.getSummary — Tóm tắt hierarchy</CardTitle>
                  <CardDescription>Lấy số lượng từng cấp để hiển thị trên dashboard.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">Request</h4>
                    <CodeBlock code={`const { data } = trpc.hierarchyTree.getSummary.useQuery();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Response</h4>
                    <CodeBlock code={`{
  "factories": 3,
  "workshops": 8,
  "lines": 15,
  "stations": 42,
  "machines": 67
}`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">App Client Integration Flow</CardTitle>
                  <CardDescription>Luồng tích hợp MQTT cho Android/iOS/Web App</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">TypeScript / React Native Example</h4>
                    <CodeBlock code={`import mqtt from "mqtt";

// Step 1: Lấy cây hierarchy → hiển thị tree selector cho user chọn scope
const { data: tree } = trpc.hierarchyTree.getTree.useQuery();

// Step 2: User chọn scope (vd: factory 1) → lấy danh sách MQTT topics
const { data: topics } = trpc.hierarchyTree.getMqttTopics.useQuery({
  level: "factory",
  factoryId: 1,
  messageTypes: ["errors", "inspection"]  // chỉ cần cảnh báo NG + inspection
});

// Step 3: Connect MQTT và subscribe các topics
const client = mqtt.connect("mqtt://broker.local:1883");
client.on("connect", () => {
  for (const t of topics) {
    client.subscribe(t.topic, { qos: t.qos });
    console.log("Subscribed:", t.topic, "QoS:", t.qos);
  }
});

client.on("message", (topic, payload) => {
  const data = JSON.parse(payload.toString());
  console.log("Received:", topic, data);
  // Xử lý message theo topic...
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Python Example</h4>
                    <CodeBlock code={`import requests, json
import paho.mqtt.client as mqtt

BASE = "${typeof window !== "undefined" ? window.location.origin : ""}/api/trpc"

# Step 1: Lấy MQTT topics cho factory 1
res = requests.get(
    f"{BASE}/hierarchyTree.getMqttTopics",
    params={"input": json.dumps({
        "level": "factory",
        "factoryId": 1,
        "messageTypes": ["errors", "inspection"]
    })},
    cookies={"auth-session": jwt_token}
)
topics = res.json()["result"]["data"]

# Step 2: Connect MQTT & subscribe
client = mqtt.Client()
client.connect("broker.local", 1883)
for t in topics:
    client.subscribe(t["topic"], qos=t["qos"])
    print(f"Subscribed: {t['topic']} QoS={t['qos']}")

def on_message(client, userdata, msg):
    data = json.loads(msg.payload)
    print(f"Topic: {msg.topic}", data)

client.on_message = on_message
client.loop_forever()`} />
                  </div>
                  <div className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-4 text-sm text-white/80">
                    <h4 className="mb-2 font-semibold text-white">Best Practices</h4>
                    <ul className="list-disc space-y-1 pl-5">
                      <li>Dùng <code className="text-white">getTree</code> một lần khi app khởi động, cache kết quả</li>
                      <li>Khi user thay đổi scope → gọi <code className="text-white">getMqttTopics</code> để lấy topics mới, unsubscribe cũ &amp; subscribe mới</li>
                      <li>Dùng <code className="text-white">messageTypes</code> filter để giảm lượng message nhận được, tiết kiệm bandwidth</li>
                      <li>Subscribe ở level cao hơn (factory/workshop) dùng wildcard <code className="text-white">+</code>, tiết kiệm connection</li>
                      <li>Dùng <code className="text-white">getSummary</code> để hiển thị dashboard overview và badge counts</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">REST API cho App bên ngoài (External Apps)</CardTitle>
                  <CardDescription>Hỗ trợ 2 cách xác thực: Master API Key hoặc Login lấy Bearer Token</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-2xl border border-dashed border-yellow-500/30 bg-yellow-500/5 p-4 text-sm text-white/80">
                    <h4 className="mb-2 font-semibold text-yellow-400">Xác thực (Authentication) — 2 cách</h4>

                    <p className="mb-2 font-semibold text-white">Cách 1: Master API Key (server-to-server)</p>
                    <p className="mb-2">Thêm header <code className="text-white">x-master-key</code>:</p>
                    <CodeBlock code={`x-master-key: <MASTER_API_KEY từ .env>`} />
                    <p className="mt-2 mb-4 text-white/60">Master API Key được cấu hình trong file <code className="text-white">.env</code> → biến <code className="text-white">MASTER_API_KEY</code></p>

                    <p className="mb-2 font-semibold text-white">Cách 2: Login lấy Bearer Token (cho App client)</p>
                    <p className="mb-2">Gọi endpoint login với username/password, nhận JWT token, rồi dùng header <code className="text-white">Authorization</code>:</p>
                    <CodeBlock code={`# Bước 1: Login lấy token
POST /api/external/auth/login
Content-Type: application/json

{ "username": "your_username", "password": "your_password" }

# Response:
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": "30d",
  "user": { "id": 1, "name": "Nguyễn Văn A", "email": "a@example.com", "role": "admin" },
  "usage": "Add header: Authorization: Bearer <token>"
}

# Bước 2: Dùng token cho mọi request tiếp theo
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...`} />
                    <p className="mt-2 text-white/60">Token có hiệu lực <strong>30 ngày</strong>. Khi hết hạn, gọi lại endpoint login để lấy token mới.</p>
                  </div>

                  <div>
                    <Badge variant="outline" className="mb-2 border-blue-500/50 text-blue-400">POST</Badge>
                    <span className="ml-2 text-sm font-mono text-white">/api/external/auth/login</span>
                    <p className="mt-1 text-sm text-white/60">Đăng nhập lấy Bearer token (không cần Master Key)</p>
                    <CodeBlock code={`# cURL
curl -X POST http://localhost:3000/api/external/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"username": "admin", "password": "admin123"}'

# Response thành công (200)
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": "30d",
  "user": { "id": 1, "name": "Admin", "email": "admin@company.com", "role": "admin" },
  "usage": "Add header: Authorization: Bearer <token>"
}

# Response lỗi (401)
{ "success": false, "message": "Invalid username or password" }`} />
                  </div>

                  <div>
                    <Badge variant="outline" className="mb-2 border-green-500/50 text-green-400">GET</Badge>
                    <span className="ml-2 text-sm font-mono text-white">/api/external/hierarchy/tree</span>
                    <p className="mt-1 text-sm text-white/60">Lấy toàn bộ cây phân cấp: Factory → Workshop → Line → Station → Machine</p>
                    <CodeBlock code={`# Dùng Master Key
curl -H "x-master-key: YOUR_MASTER_KEY" \\
  http://localhost:3000/api/external/hierarchy/tree

# Hoặc dùng Bearer Token (từ login)
curl -H "Authorization: Bearer YOUR_TOKEN" \\
  http://localhost:3000/api/external/hierarchy/tree

# Response
{
  "success": true,
  "data": [
    {
      "id": 1, "code": "F01", "name": "Factory A",
      "workshops": [
        {
          "id": 1, "code": "WS01", "name": "Workshop 1",
          "lines": [
            {
              "id": 1, "code": "L01", "name": "Line 1",
              "stations": [
                {
                  "id": 1, "code": "ST01", "name": "Station 1",
                  "orderIndex": 1,
                  "machines": [
                    { "id": 1, "code": "M01", "name": "AOI-01", "machineType": "AOI", "operationStatus": "running" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}`} />
                  </div>

                  <div>
                    <Badge variant="outline" className="mb-2 border-green-500/50 text-green-400">GET</Badge>
                    <span className="ml-2 text-sm font-mono text-white">/api/external/hierarchy/factory/:factoryId</span>
                    <p className="mt-1 text-sm text-white/60">Lấy cây phân cấp cho 1 factory cụ thể</p>
                    <CodeBlock code={`curl -H "x-master-key: YOUR_MASTER_KEY" \\
  http://localhost:3000/api/external/hierarchy/factory/1

# Response: { "success": true, "data": { "id": 1, "code": "F01", ... } }`} />
                  </div>

                  <div>
                    <Badge variant="outline" className="mb-2 border-green-500/50 text-green-400">GET</Badge>
                    <span className="ml-2 text-sm font-mono text-white">/api/external/hierarchy/mqtt-topics</span>
                    <p className="mt-1 text-sm text-white/60">Sinh danh sách MQTT subscription topics theo scope level</p>
                    <CodeBlock code={`# Subscribe tất cả
curl -H "x-master-key: YOUR_MASTER_KEY" \\
  "http://localhost:3000/api/external/hierarchy/mqtt-topics?level=all"

# Subscribe 1 factory, chỉ lấy inspection + errors
curl -H "x-master-key: YOUR_MASTER_KEY" \\
  "http://localhost:3000/api/external/hierarchy/mqtt-topics?level=factory&factoryId=1&messageTypes=inspection,errors"

# Subscribe 1 workshop
curl -H "x-master-key: YOUR_MASTER_KEY" \\
  "http://localhost:3000/api/external/hierarchy/mqtt-topics?level=workshop&factoryId=1&workshopId=2"

# Subscribe 1 station
curl -H "x-master-key: YOUR_MASTER_KEY" \\
  "http://localhost:3000/api/external/hierarchy/mqtt-topics?level=station&stationId=5"

# Response
{
  "success": true,
  "data": [
    { "topic": "avi/1/workshop/+/station/+/inspection", "description": "Factory A - inspection", "qos": 1 },
    { "topic": "avi/1/workshop/+/station/+/errors", "description": "Factory A - errors", "qos": 2 }
  ]
}`} />
                    <div className="mt-2 text-xs text-white/50">
                      <strong>Query params:</strong> level (required), factoryId, workshopId, lineId, stationId, messageTypes (comma-separated)
                    </div>
                  </div>

                  <div>
                    <Badge variant="outline" className="mb-2 border-green-500/50 text-green-400">GET</Badge>
                    <span className="ml-2 text-sm font-mono text-white">/api/external/hierarchy/mqtt-message-types</span>
                    <p className="mt-1 text-sm text-white/60">Lấy danh sách tất cả message types hỗ trợ</p>
                    <CodeBlock code={`curl -H "x-master-key: YOUR_MASTER_KEY" \\
  http://localhost:3000/api/external/hierarchy/mqtt-message-types`} />
                  </div>

                  <div>
                    <Badge variant="outline" className="mb-2 border-green-500/50 text-green-400">GET</Badge>
                    <span className="ml-2 text-sm font-mono text-white">/api/external/hierarchy/summary</span>
                    <p className="mt-1 text-sm text-white/60">Thống kê số lượng mỗi cấp (factories, workshops, lines, stations, machines)</p>
                    <CodeBlock code={`curl -H "x-master-key: YOUR_MASTER_KEY" \\
  http://localhost:3000/api/external/hierarchy/summary

# Response: { "success": true, "data": { "factories": 3, "workshops": 8, "lines": 15, "stations": 42, "machines": 67 } }`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Ví dụ tích hợp đầy đủ (Python / C# / Node.js)</CardTitle>
                  <CardDescription>Luồng hoàn chỉnh: login → lấy hierarchy → sinh MQTT topics → subscribe</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold text-white">Python Example</h4>
                    <CodeBlock code={`import requests
import paho.mqtt.client as mqtt

BASE_URL = "http://192.168.1.100:3000"

# ===== Cách 1: Login lấy Bearer token (khuyến nghị cho App) =====
login = requests.post(f"{BASE_URL}/api/external/auth/login", json={
    "username": "your_username",
    "password": "your_password"
}).json()

if not login["success"]:
    raise Exception(f"Login failed: {login['message']}")

TOKEN = login["token"]
HEADERS = {"Authorization": f"Bearer {TOKEN}"}
print(f"Logged in as: {login['user']['name']} (token expires in {login['expiresIn']})")

# ===== Cách 2: Dùng Master API Key (thay thế) =====
# HEADERS = {"x-master-key": "your-master-api-key"}

# Step 1: Lấy hierarchy tree
tree = requests.get(f"{BASE_URL}/api/external/hierarchy/tree", headers=HEADERS).json()
for factory in tree["data"]:
    print(f"Factory: {factory['name']}")
    for ws in factory["workshops"]:
        print(f"  Workshop: {ws['name']}")
        for line in ws["lines"]:
            print(f"    Line: {line['name']} ({len(line['stations'])} stations)")

# Step 2: Sinh MQTT topics cho factory đầu tiên
resp = requests.get(
    f"{BASE_URL}/api/external/hierarchy/mqtt-topics",
    headers=HEADERS,
    params={"level": "factory", "factoryId": tree["data"][0]["id"], "messageTypes": "inspection,errors"}
).json()

topics = resp["data"]
print(f"\\nSubscribing to {len(topics)} topics:")
for t in topics:
    print(f"  {t['topic']} (QoS={t['qos']})")

# Step 3: Connect MQTT và subscribe
client = mqtt.Client()
client.connect("192.168.1.100", 1883, 60)

for t in topics:
    client.subscribe(t["topic"], qos=t["qos"])
    print(f"Subscribed: {t['topic']}")

def on_message(client, userdata, msg):
    print(f"[{msg.topic}] {msg.payload.decode()}")

client.on_message = on_message
client.loop_forever()`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold text-white">C# / .NET Example</h4>
                    <CodeBlock code={`using System.Net.Http;
using System.Text;
using System.Text.Json;
using MQTTnet;
using MQTTnet.Client;

var baseUrl = "http://192.168.1.100:3000";

// ===== Cách 1: Login lấy Bearer token (khuyến nghị cho App) =====
using var http = new HttpClient();
var loginBody = new StringContent(
    JsonSerializer.Serialize(new { username = "your_username", password = "your_password" }),
    Encoding.UTF8, "application/json");
var loginResp = await http.PostAsync($"{baseUrl}/api/external/auth/login", loginBody);
var loginResult = JsonSerializer.Deserialize<JsonElement>(await loginResp.Content.ReadAsStringAsync());
var token = loginResult.GetProperty("token").GetString()!;
http.DefaultRequestHeaders.Add("Authorization", $"Bearer {token}");
Console.WriteLine($"Logged in, token expires: {loginResult.GetProperty("expiresIn")}");

// ===== Cách 2: Dùng Master API Key (thay thế) =====
// http.DefaultRequestHeaders.Add("x-master-key", "your-master-api-key");

// Step 1: Lấy MQTT topics cho 1 factory
var resp = await http.GetStringAsync(
    $"{baseUrl}/api/external/hierarchy/mqtt-topics?level=factory&factoryId=1&messageTypes=inspection,errors");
var result = JsonSerializer.Deserialize<JsonElement>(resp);
var topics = result.GetProperty("data").EnumerateArray();

// Step 2: Connect MQTT
var factory = new MqttFactory();
var mqttClient = factory.CreateMqttClient();
var options = new MqttClientOptionsBuilder()
    .WithTcpServer("192.168.1.100", 1883)
    .Build();

await mqttClient.ConnectAsync(options);

// Step 3: Subscribe
foreach (var topic in topics) {
    var topicStr = topic.GetProperty("topic").GetString()!;
    var qos = topic.GetProperty("qos").GetInt32();
    await mqttClient.SubscribeAsync(topicStr, (MQTTnet.Protocol.MqttQualityOfServiceLevel)qos);
    Console.WriteLine($"Subscribed: {topicStr} (QoS={qos})");
}

mqttClient.ApplicationMessageReceivedAsync += e => {
    Console.WriteLine($"[{e.ApplicationMessage.Topic}] {e.ApplicationMessage.ConvertPayloadToString()}");
    return Task.CompletedTask;
};`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold text-white">Node.js Example</h4>
                    <CodeBlock code={`const mqtt = require("mqtt");

const BASE_URL = "http://192.168.1.100:3000";

async function main() {
  // ===== Cách 1: Login lấy Bearer token (khuyến nghị cho App) =====
  const loginResp = await fetch(\`\${BASE_URL}/api/external/auth/login\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "your_username", password: "your_password" })
  });
  const login = await loginResp.json();
  if (!login.success) throw new Error("Login failed: " + login.message);

  const HEADERS = { Authorization: \`Bearer \${login.token}\` };
  console.log("Logged in as:", login.user.name);

  // ===== Cách 2: Dùng Master API Key (thay thế) =====
  // const HEADERS = { "x-master-key": "your-master-api-key" };

  // Step 1: Lấy topics
  const resp = await fetch(
    \`\${BASE_URL}/api/external/hierarchy/mqtt-topics?level=all\`,
    { headers: HEADERS }
  );
  const { data: topics } = await resp.json();

  // Step 2: Connect MQTT
  const client = mqtt.connect("mqtt://192.168.1.100:1883");
  
  client.on("connect", () => {
    for (const t of topics) {
      client.subscribe(t.topic, { qos: t.qos });
      console.log(\`Subscribed: \${t.topic} (QoS=\${t.qos})\`);
    }
  });

  client.on("message", (topic, payload) => {
    console.log(\`[\${topic}]\`, JSON.parse(payload.toString()));
  });
}

main();`} />
                  </div>

                  <div className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-4 text-sm text-white/80">
                    <h4 className="mb-2 font-semibold text-yellow-400">Bảng tóm tắt Endpoints</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-white/10">
                            <th className="pb-2 pr-4 text-white">Method</th>
                            <th className="pb-2 pr-4 text-white">Endpoint</th>
                            <th className="pb-2 pr-4 text-white">Auth</th>
                            <th className="pb-2 text-white">Mô tả</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          <tr><td className="py-1 pr-4 text-blue-400">POST</td><td className="py-1 pr-4 font-mono">/api/external/auth/login</td><td className="py-1 pr-4">Không cần</td><td className="py-1">Đăng nhập lấy Bearer token</td></tr>
                          <tr><td className="py-1 pr-4 text-green-400">GET</td><td className="py-1 pr-4 font-mono">/api/external/hierarchy/tree</td><td className="py-1 pr-4">Key / Bearer</td><td className="py-1">Toàn bộ cây hierarchy</td></tr>
                          <tr><td className="py-1 pr-4 text-green-400">GET</td><td className="py-1 pr-4 font-mono">/api/external/hierarchy/factory/:id</td><td className="py-1 pr-4">Key / Bearer</td><td className="py-1">Cây 1 factory</td></tr>
                          <tr><td className="py-1 pr-4 text-green-400">GET</td><td className="py-1 pr-4 font-mono">/api/external/hierarchy/mqtt-topics</td><td className="py-1 pr-4">Key / Bearer</td><td className="py-1">Sinh MQTT topics theo scope</td></tr>
                          <tr><td className="py-1 pr-4 text-green-400">GET</td><td className="py-1 pr-4 font-mono">/api/external/hierarchy/mqtt-message-types</td><td className="py-1 pr-4">Key / Bearer</td><td className="py-1">Danh sách message types</td></tr>
                          <tr><td className="py-1 pr-4 text-green-400">GET</td><td className="py-1 pr-4 font-mono">/api/external/hierarchy/summary</td><td className="py-1 pr-4">Key / Bearer</td><td className="py-1">Thống kê số lượng</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
  );
}
