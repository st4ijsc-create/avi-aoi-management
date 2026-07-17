/*
 * ══════════════════════════════════════════════════════════════════════════
 * ST4I Device Client — ESP32 (nhiệt-ẩm) -> ST4I AVI/AOI Management
 * ══════════════════════════════════════════════════════════════════════════
 * Gửi TELEMETRY (nhiệt độ + độ ẩm) theo ST4I Standard Process Feed v1 (doc 57 §9).
 *
 *   POST  {SERVER_URL}/api/v1/ingest/telemetry
 *   Header: Authorization: Bearer <mk_...>        (khóa per-machine, scope ingest:write)
 *   Body:   { "samples": [ CanonicalSample, ... ] }
 *   CanonicalSample: { deviceId, metric, value, unit, ts, quality }
 *
 * Thư viện cần cài qua Arduino Library Manager:
 *   - ArduinoJson  (v7.x — dùng JsonDocument; nếu v6 xem ghi chú ở dưới)
 * WiFi.h / HTTPClient.h / WiFiClientSecure.h / time.h đã có sẵn trong ESP32 core.
 *
 * Onboarding khóa mk_ (làm 1 lần, KHÔNG làm trên ESP32):
 *   Admin cấp claim token (mct_) hoặc enrollment token (met_) rồi đổi lấy mk_ bằng
 *   script Python/Node kèm theo (xem ../python hoặc ../nodejs). Dán mk_ vào MK_KEY.
 *   ESP32 chỉ giữ mk_ và bắn telemetry.
 * ══════════════════════════════════════════════════════════════════════════
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>

// ─────────────────────────────────────────────────────────────────────────
// >>> ĐIỀN CÁC GIÁ TRỊ SAU (bắt buộc) <<<
// ─────────────────────────────────────────────────────────────────────────
static const char* WIFI_SSID   = "TEN_WIFI_XUONG";        // <-- SSID WiFi xưởng
static const char* WIFI_PASS   = "MAT_KHAU_WIFI";         // <-- mật khẩu WiFi

// URL máy chủ ST4I. Dùng https nếu server có TLS; http:// nếu LAN nội bộ không TLS.
static const char* SERVER_URL  = "https://factory.local:5000";  // <-- KHÔNG kèm dấu / cuối

// Khóa per-machine mk_ (do admin cấp qua claim/enroll — xem ghi chú đầu file).
static const char* MK_KEY      = "mk_live_XXXXXXXXXXXXXXXX";     // <-- dán mk_ vào đây

// Định danh thiết bị (1 gateway có thể forward nhiều deviceId; server tự resolve máy).
static const char* DEVICE_ID   = "esp32-ws3-01";                // <-- id cảm biến/trạm
static const char* MACHINE_CODE = "IOT-WS3";                    // (tùy chọn) mã trạm

// Múi giờ để đóng dấu ts. Việt Nam = GMT+7, KHÔNG DST.
static const long  GMT_OFFSET_SEC = 7L * 3600L;                 // <-- đổi nếu khác múi giờ
static const int   DST_OFFSET_SEC = 0;
static const char* TS_OFFSET_SUFFIX = "+07:00";                 // <-- PHẢI khớp GMT_OFFSET_SEC

// Chu kỳ gửi + retry.
static const unsigned long SEND_INTERVAL_MS = 30000;            // 30s / batch (doc 57 §9.2)
static const int   MAX_RETRIES     = 3;
static const int   RETRY_DELAY_MS  = 2000;

// TLS: true = tin mọi cert (self-signed dev — KHÔNG an toàn cho production).
// Production: đặt false và nạp CA cert thật bằng client.setCACert(root_ca).
static const bool  TLS_INSECURE = true;

// ─────────────────────────────────────────────────────────────────────────
// Nội bộ
// ─────────────────────────────────────────────────────────────────────────
static bool timeSynced = false;

// Kết nối WiFi (blocking, có timeout).
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("[WiFi] Đang kết nối '%s' ...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[WiFi] OK, IP = ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("[WiFi] THẤT BẠI — sẽ thử lại ở vòng sau.");
  }
}

// Đồng bộ giờ qua NTP để có timestamp thật (kèm offset).
void syncTime() {
  configTime(GMT_OFFSET_SEC, DST_OFFSET_SEC, "pool.ntp.org", "time.google.com");
  struct tm tm;
  // Chờ tối đa ~8s để NTP về.
  for (int i = 0; i < 16; i++) {
    if (getLocalTime(&tm, 500)) {
      timeSynced = true;
      Serial.println("[NTP] Đã đồng bộ giờ.");
      return;
    }
  }
  Serial.println("[NTP] Chưa đồng bộ được — sẽ gửi telemetry KHÔNG kèm ts (server tự đóng dấu).");
}

// Tạo timestamp RFC 3339 KÈM offset, ví dụ 2026-07-17T14:03:00+07:00.
// Trả chuỗi rỗng nếu chưa có giờ (khi đó bỏ field ts — server đóng dấu giờ nhận).
String isoTimestamp() {
  struct tm tm;
  if (!getLocalTime(&tm, 200)) return String("");
  char buf[32];
  // %Y-%m-%dT%H:%M:%S rồi nối offset cố định (khớp GMT_OFFSET_SEC).
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S", &tm);
  return String(buf) + TS_OFFSET_SUFFIX;
}

// Đọc cảm biến nhiệt-ẩm.
// >>> THAY BẰNG mã đọc DHT22/SHT31 thật của bạn <<<
// Ví dụ DHT22: #include <DHT.h>; DHT dht(PIN, DHT22); float t = dht.readTemperature();
void readSensor(float& tempC, float& humidity) {
  // Giả lập quanh 27°C / 61%RH cho demo.
  tempC    = 27.0 + (float)(millis() % 300) / 100.0;   // 27.0 .. 29.99
  humidity = 60.0 + (float)(millis() % 500) / 100.0;   // 60.0 .. 64.99
}

// Dựng body JSON telemetry (ArduinoJson v7).
// LƯU Ý ArduinoJson v6: đổi `JsonDocument doc;` thành `DynamicJsonDocument doc(512);`
// và `samples.add<JsonObject>()` thành `samples.createNestedObject()`.
String buildTelemetryBody(float tempC, float humidity, const String& ts) {
  JsonDocument doc;
  JsonArray samples = doc["samples"].to<JsonArray>();

  JsonObject s1 = samples.add<JsonObject>();
  s1["deviceId"] = DEVICE_ID;
  s1["metric"]   = "temperature";
  s1["value"]    = serialized(String(tempC, 2));   // giữ 2 chữ số thập phân
  s1["unit"]     = "\xC2\xB0" "C";                  // UTF-8 của "°C" (U+00B0 = 0xC2 0xB0)
  s1["quality"]  = "good";
  if (ts.length()) s1["ts"] = ts;

  JsonObject s2 = samples.add<JsonObject>();
  s2["deviceId"] = DEVICE_ID;
  s2["metric"]   = "humidity";
  s2["value"]    = serialized(String(humidity, 2));
  s2["unit"]     = "%RH";
  s2["quality"]  = "good";
  if (ts.length()) s2["ts"] = ts;

  String out;
  serializeJson(doc, out);
  return out;
}

// POST telemetry, có retry. Trả true nếu server nhận (HTTP 2xx).
bool postTelemetry(const String& body) {
  for (int attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (WiFi.status() != WL_CONNECTED) {
      connectWiFi();
      if (WiFi.status() != WL_CONNECTED) { delay(RETRY_DELAY_MS); continue; }
    }

    String url = String(SERVER_URL) + "/api/v1/ingest/telemetry";
    int code = -1;

    if (url.startsWith("https")) {
      WiFiClientSecure client;
      if (TLS_INSECURE) client.setInsecure();          // dev self-signed; production: setCACert()
      HTTPClient http;
      http.begin(client, url);
      http.addHeader("Content-Type", "application/json");
      http.addHeader("Authorization", String("Bearer ") + MK_KEY);  // hoặc: http.addHeader("X-API-Key", MK_KEY);
      code = http.POST(body);
      String resp = http.getString();
      http.end();
      if (code >= 200 && code < 300) {
        Serial.printf("[ingest] OK HTTP %d %s\n", code, resp.c_str());
        return true;
      }
      Serial.printf("[ingest] lỗi HTTP %d (lần %d/%d): %s\n", code, attempt, MAX_RETRIES, resp.c_str());
    } else {
      WiFiClient client;
      HTTPClient http;
      http.begin(client, url);
      http.addHeader("Content-Type", "application/json");
      http.addHeader("Authorization", String("Bearer ") + MK_KEY);
      code = http.POST(body);
      String resp = http.getString();
      http.end();
      if (code >= 200 && code < 300) {
        Serial.printf("[ingest] OK HTTP %d %s\n", code, resp.c_str());
        return true;
      }
      Serial.printf("[ingest] lỗi HTTP %d (lần %d/%d): %s\n", code, attempt, MAX_RETRIES, resp.c_str());
    }

    // 4xx (400/401/403/409) = payload/khóa/version sai -> retry vô ích, dừng sớm.
    if (code >= 400 && code < 500 && code != 429) {
      Serial.println("[ingest] Lỗi client (4xx) — KHÔNG retry. Kiểm tra mk_ / payload / schemaVersion.");
      return false;
    }
    delay(RETRY_DELAY_MS);   // 429/5xx/mạng -> chờ rồi thử lại
  }
  Serial.println("[ingest] Hết retry — bỏ batch này (telemetry liên tục, batch sau sẽ bù).");
  return false;
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n=== ST4I ESP32 Telemetry Client ===");
  connectWiFi();
  syncTime();
}

void loop() {
  float tempC, humidity;
  readSensor(tempC, humidity);

  String ts = isoTimestamp();               // "" nếu chưa có NTP -> server tự đóng dấu
  if (!timeSynced && ts.length()) timeSynced = true;
  String body = buildTelemetryBody(tempC, humidity, ts);

  Serial.printf("[sensor] temp=%.2f°C hum=%.2f%%RH\n", tempC, humidity);
  postTelemetry(body);

  delay(SEND_INTERVAL_MS);
}
