// ─────────────────────────────────────────────────────────────────────────────
// St4iDeviceClient — SDK tham chiếu (reference client) C#/.NET cho phần mềm chạy
// TRONG máy nội bộ (WPF, dịch vụ Windows, gateway). Đẩy dữ liệu vào nền tảng
// ST4I AVI/AOI Management theo ST4I Standard Process Feed v1.
//
// Chuẩn tuân theo:  doc 61 (Machine Developer Integration Guide) · doc 57 (spec Feed v1)
//                   doc 56 (Device Connectivity Standardization).
//
// Yêu cầu:
//   • .NET: netstandard2.0+ / .NET Framework 4.7.2+ / .NET 6/8/10.
//   • NuGet: System.Text.Json (>= 6.0) — CÓ SẴN built-in trên .NET 6+; trên .NET
//     Framework 4.x thêm gói NuGet "System.Text.Json". Không cần thư viện nào khác.
//   • C# 7.3+ (tương thích WPF .NET Framework mặc định).
//
// Đặc điểm (đồng bộ SDK Python/Node):
//   • Bootstrap khóa mk_ qua enroll (met_) / claim (mct_).
//   • Gửi RESULT (vít/keo/hàn…) + TELEMETRY (cảm biến) theo envelope Feed v1.
//   • idempotencyKey (exactly-once) + retry backoff mũ + hàng đợi local JSONL
//     (store-and-forward) replay khi mất mạng.
//   • Config-sync: check → get → apply → ack (kéo recipe về máy).
//   • Timestamp RFC 3339 KÈM offset tường minh (server reject giờ naive — doc 57 §4).
//
// WPF LƯU Ý (đọc kỹ):
//   • Tạo MỘT St4iDeviceClient dùng chung cả vòng đời app (KHÔNG new mỗi lần gửi —
//     HttpClient bên trong là tài nguyên dài hạn). Đăng ký như singleton.
//   • Mọi hàm là async — LUÔN await, KHÔNG .Result/.Wait() trên UI thread (deadlock).
//   • Vòng telemetry chạy nền bằng Task + CancellationToken, cập nhật UI qua Dispatcher.
//
// KHÓA & ENDPOINT:
//   Ingest:      Authorization: Bearer <mk_...>   (hoặc  X-API-Key: <mk_...>)
//     POST {server}/api/v1/ingest/process-result   -> RESULT
//     POST {server}/api/v1/ingest/telemetry        -> TELEMETRY
//   Config-sync: GET  {server}/api/machine/config-sync/check|get   POST .../ack
//   Heartbeat:   POST {server}/api/machine/heartbeat   (X-API-Key, KHÔNG đọc Bearer)
//   Bootstrap:   POST {server}/api/trpc/machine.enroll | machine.claimKey
// ─────────────────────────────────────────────────────────────────────────────
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace St4i.DeviceClient
{
    // ── Ngoại lệ ────────────────────────────────────────────────────────────
    /// <summary>Cấu hình client sai (thiếu mk_, thiếu serverUrl…).</summary>
    public class St4iConfigException : Exception { public St4iConfigException(string m) : base(m) { } }

    /// <summary>Lỗi mạng/timeout — retryable, sẽ đưa vào hàng đợi local.</summary>
    public class St4iNetworkException : Exception { public St4iNetworkException(string m) : base(m) { } }

    /// <summary>Server trả lỗi có cấu trúc (HTTP 4xx/5xx với envelope error).</summary>
    public class St4iApiException : Exception
    {
        public int Status { get; }
        public string Code { get; }
        public string Payload { get; }
        public St4iApiException(string message, int status = 0, string code = "", string payload = null)
            : base(message) { Status = status; Code = code ?? ""; Payload = payload; }
    }

    // ── DTO đầu vào ─────────────────────────────────────────────────────────
    public class Metric
    {
        [JsonPropertyName("name")] public string Name { get; set; }
        [JsonPropertyName("value")] public double Value { get; set; }   // CHỈ number (doc 61 §4.3)
        [JsonPropertyName("unit")] public string Unit { get; set; }
        [JsonPropertyName("lsl")] public double? Lsl { get; set; }
        [JsonPropertyName("usl")] public double? Usl { get; set; }
        [JsonPropertyName("nominal")] public double? Nominal { get; set; }
    }

    public class Waveform
    {
        [JsonPropertyName("name")] public string Name { get; set; }
        [JsonPropertyName("unit")] public string Unit { get; set; }
        [JsonPropertyName("rateHz")] public double? RateHz { get; set; }
        [JsonPropertyName("samples")] public List<double[]> Samples { get; set; }  // [[t,v],…]
    }

    public class Recipe
    {
        [JsonPropertyName("code")] public string Code { get; set; }
        [JsonPropertyName("version")] public string Version { get; set; }
        [JsonPropertyName("checksum")] public string Checksum { get; set; }
    }

    public class Sample
    {
        [JsonPropertyName("metric")] public string Metric { get; set; }
        [JsonPropertyName("value")] public object Value { get; set; }  // number|string|bool
        [JsonPropertyName("unit")] public string Unit { get; set; }
        [JsonPropertyName("ts")] public string Ts { get; set; }
        [JsonPropertyName("deviceId")] public string DeviceId { get; set; }
        [JsonPropertyName("quality")] public string Quality { get; set; }  // good|bad|uncertain
    }

    // ── DTO đầu vào — INSPECTION (AOI/AVI, doc 61 §5 / doc 28 v1.1) ───────────
    public class MeasurementPoint
    {
        [JsonPropertyName("pointCode")] public string PointCode { get; set; }
        [JsonPropertyName("measuredValue")] public double? MeasuredValue { get; set; }
        [JsonPropertyName("result")] public string Result { get; set; }  // OK|NG|NTF
        [JsonPropertyName("unit")] public string Unit { get; set; }
        [JsonPropertyName("defectCatalogCode")] public string DefectCatalogCode { get; set; }
        [JsonPropertyName("defectSeverity")] public string DefectSeverity { get; set; } // critical|major|minor|cosmetic
        [JsonPropertyName("valueHeight")] public double? ValueHeight { get; set; }
        [JsonPropertyName("valueArea")] public double? ValueArea { get; set; }
        [JsonPropertyName("valueVolume")] public double? ValueVolume { get; set; }
        [JsonPropertyName("valueVoidPct")] public double? ValueVoidPct { get; set; }
        [JsonPropertyName("valueCoplanarity")] public double? ValueCoplanarity { get; set; }
        [JsonPropertyName("valueWarpage")] public double? ValueWarpage { get; set; }
        [JsonPropertyName("valueOffsetX")] public double? ValueOffsetX { get; set; }
        [JsonPropertyName("valueOffsetY")] public double? ValueOffsetY { get; set; }
        [JsonPropertyName("valueTilt")] public double? ValueTilt { get; set; }
        [JsonPropertyName("valueThickness")] public double? ValueThickness { get; set; }
        [JsonPropertyName("valueZ")] public double? ValueZ { get; set; }
        [JsonPropertyName("imageBase64")] public string ImageBase64 { get; set; }
    }

    // ── DTO phản hồi ────────────────────────────────────────────────────────
    public class ProcessAck { public bool Success; public long? ProcessResultId; public bool Duplicate; public bool Queued; public string SubmissionId; }
    public class InspectionAck { public bool Success; public long? InspectionId; public bool Duplicate; public bool Queued; }
    public class TelemetryAck { public int Accepted; public int Received; public string Machine; }
    public class ConfigVersion { public bool Success; public string ConfigKind; public string Code; public string Name; public string Version; public string Checksum; public string ResolvedBy; public JsonElement Payload; }
    public class ConfigAck { public bool Success; public long MachineId; public string ConfigKind; public string DriftState; }
    public class SyncResult { public bool Changed; public string Version; public string DriftState; public bool Applied = true; }
    public class Credential { public string ApiKey; public long? MachineId; public string Code; }

    /// <summary>Client cho MỘT thiết bị (1 mk_ = 1 máy). Tạo 1 instance / máy, dùng chung suốt vòng đời.</summary>
    public sealed class St4iDeviceClient : IDisposable
    {
        public const string SchemaVersion = "1.0";

        // HTTP status coi là tạm thời -> retry + đưa vào hàng đợi local.
        private static readonly HashSet<int> RetryableStatus = new HashSet<int> { 429, 500, 502, 503, 504 };

        private static readonly JsonSerializerOptions J = new JsonSerializerOptions
        {
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        };

        private readonly HttpClient _http;
        private readonly string _serverUrl;
        private readonly string _queuePath;
        private readonly int _maxRetries;
        private readonly double _backoffBase;
        private readonly double _backoffMax;
        private readonly List<string> _memQueue = new List<string>();
        private readonly object _queueLock = new object();

        public string MkKey { get; private set; }
        public string MachineCode { get; private set; }
        public string SerialNumber { get; private set; }

        /// <param name="serverUrl">vd "https://factory.local:5000"</param>
        /// <param name="verifyTls">false CHỈ cho server dev self-signed trong LAN xưởng (CẢNH BÁO an ninh)</param>
        /// <param name="queuePath">đường dẫn file JSONL cho hàng đợi bền qua restart; null = hàng đợi RAM</param>
        public St4iDeviceClient(
            string serverUrl,
            string mkKey = null,
            string machineCode = null,
            string serialNumber = null,
            string queuePath = null,
            double timeoutSeconds = 10.0,
            bool verifyTls = true,
            int maxRetries = 4,
            double backoffBase = 0.5,
            double backoffMax = 30.0,
            HttpMessageHandler handler = null)
        {
            if (string.IsNullOrEmpty(serverUrl))
                throw new St4iConfigException("serverUrl là bắt buộc, ví dụ 'https://factory.local:5000'");
            _serverUrl = serverUrl.TrimEnd('/');
            MkKey = mkKey ?? Environment.GetEnvironmentVariable("ST4I_MK_KEY");
            MachineCode = machineCode;
            SerialNumber = serialNumber;
            _queuePath = queuePath;
            _maxRetries = Math.Max(0, maxRetries);
            _backoffBase = backoffBase;
            _backoffMax = backoffMax;

            if (handler == null)
            {
                var h = new HttpClientHandler();
                if (!verifyTls)
                    // Bỏ kiểm chứng cert (dev self-signed). .NET Framework 4.7.1+ / .NET Core.
                    h.ServerCertificateCustomValidationCallback = (m, c, ch, e) => true;
                handler = h;
            }
            _http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(timeoutSeconds) };
        }

        public void Dispose() => _http.Dispose();

        // ── Tiện ích thời gian ────────────────────────────────────────────────
        /// <summary>RFC 3339 KÈM offset local tường minh, vd 2026-07-18T14:03:00.480+07:00.</summary>
        public static string IsoNow() =>
            DateTimeOffset.Now.ToString("yyyy-MM-dd'T'HH:mm:ss.fffzzz", CultureInfo.InvariantCulture);

        // ══════════════════════════════════════════════════════════════════════
        // HTTP tầng thấp
        // ══════════════════════════════════════════════════════════════════════
        private async Task<(int status, string body)> HttpSendAsync(
            HttpMethod method, string url, bool auth, bool xApiKeyOnly, string body, CancellationToken ct)
        {
            using (var req = new HttpRequestMessage(method, url))
            {
                if (body != null)
                    req.Content = new StringContent(body, Encoding.UTF8, "application/json");
                if (auth)
                {
                    if (string.IsNullOrEmpty(MkKey))
                        throw new St4iConfigException("Chưa có khóa mk_. Gọi EnrollAsync/ClaimAsync trước, hoặc truyền mkKey.");
                    // Feed v1 §2: gửi mk_ qua Bearer HOẶC X-API-Key.
                    if (!xApiKeyOnly)
                        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", MkKey);
                    req.Headers.TryAddWithoutValidation("X-API-Key", MkKey);
                }
                try
                {
                    using (var resp = await _http.SendAsync(req, ct).ConfigureAwait(false))
                    {
                        string text = await resp.Content.ReadAsStringAsync().ConfigureAwait(false);
                        return ((int)resp.StatusCode, text);
                    }
                }
                catch (TaskCanceledException e) { throw new St4iNetworkException($"Timeout gọi {url}: {e.Message}"); }
                catch (HttpRequestException e) { throw new St4iNetworkException($"Không kết nối được {url}: {e.Message}"); }
            }
        }

        private static JsonElement ParseJson(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw))
                return default;
            try
            {
                using (var doc = JsonDocument.Parse(raw))
                    return doc.RootElement.Clone();
            }
            catch (JsonException) { return default; }
        }

        private static bool TryGet(JsonElement o, string name, out JsonElement v)
        {
            v = default;
            return o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out v);
        }

        private static string GetStr(JsonElement o, string name)
        {
            if (TryGet(o, name, out var v) && v.ValueKind == JsonValueKind.String) return v.GetString();
            if (TryGet(o, name, out v) && v.ValueKind == JsonValueKind.Number) return v.ToString();
            return null;
        }

        private static bool GetBool(JsonElement o, string name)
            => TryGet(o, name, out var v) && v.ValueKind == JsonValueKind.True;

        // ══════════════════════════════════════════════════════════════════════
        // Bootstrap: enroll (met_) / claim (mct_)  -> nhận mk_
        // ══════════════════════════════════════════════════════════════════════
        private async Task<JsonElement> TrpcMutationAsync(string procedure, object input, CancellationToken ct)
        {
            // Server dùng superjson: body {"json": <input>}; OK -> result.data.json; lỗi -> error.json.
            string url = $"{_serverUrl}/api/trpc/{procedure}";
            string reqBody = JsonSerializer.Serialize(new Dictionary<string, object> { ["json"] = input }, J);

            Exception last = null;
            for (int attempt = 0; attempt <= _maxRetries; attempt++)
            {
                int status; string raw;
                try { (status, raw) = await HttpSendAsync(HttpMethod.Post, url, false, false, reqBody, ct).ConfigureAwait(false); }
                catch (St4iNetworkException e) { last = e; await BackoffAsync(attempt, 0, ct).ConfigureAwait(false); continue; }

                var data = ParseJson(raw);
                if (status >= 400 || TryGet(data, "error", out _))
                {
                    string msg = null;
                    if (TryGet(data, "error", out var err))
                    {
                        var errJson = TryGet(err, "json", out var ej) ? ej : err;
                        msg = GetStr(errJson, "message");
                    }
                    throw new St4iApiException(msg ?? $"tRPC {procedure} lỗi (HTTP {status})", status, "", raw);
                }
                // OK: result.data.json
                if (TryGet(data, "result", out var result) && TryGet(result, "data", out var d))
                    return TryGet(d, "json", out var jj) ? jj : d;
                return data;
            }
            throw new St4iNetworkException($"tRPC {procedure} thất bại sau {_maxRetries + 1} lần: {last?.Message}");
        }

        /// <summary>Đổi enrollment token (met_) lấy khóa mk_ (zero-touch). Server cần ENROLLMENT_ENABLED=true.</summary>
        public async Task<Credential> EnrollAsync(string enrollmentToken, string serialNumber = null,
            IDictionary<string, object> machineInfo = null, CancellationToken ct = default)
        {
            string serial = serialNumber ?? SerialNumber
                ?? throw new St4iConfigException("EnrollAsync cần serialNumber.");
            var input = new Dictionary<string, object> { ["serialNumber"] = serial, ["enrollmentToken"] = enrollmentToken };
            if (machineInfo != null) input["machineInfo"] = machineInfo;
            return AbsorbCredential(await TrpcMutationAsync("machine.enroll", input, ct).ConfigureAwait(false));
        }

        /// <summary>Đổi claim token (mct_) lấy khóa mk_. Token dùng-1-lần (spent sau khi dùng).</summary>
        public async Task<Credential> ClaimAsync(string claimToken, string serialNumber = null, CancellationToken ct = default)
        {
            string serial = serialNumber ?? SerialNumber
                ?? throw new St4iConfigException("ClaimAsync cần serialNumber.");
            var input = new Dictionary<string, object> { ["serialNumber"] = serial, ["claimToken"] = claimToken };
            return AbsorbCredential(await TrpcMutationAsync("machine.claimKey", input, ct).ConfigureAwait(false));
        }

        private Credential AbsorbCredential(JsonElement data)
        {
            var cred = new Credential
            {
                ApiKey = GetStr(data, "apiKey"),
                Code = GetStr(data, "code"),
                MachineId = TryGet(data, "machineId", out var mid) && mid.ValueKind == JsonValueKind.Number ? mid.GetInt64() : (long?)null,
            };
            if (!string.IsNullOrEmpty(cred.ApiKey)) MkKey = cred.ApiKey;
            if (!string.IsNullOrEmpty(cred.Code) && string.IsNullOrEmpty(MachineCode)) MachineCode = cred.Code;
            return cred;
        }

        /// <summary>Lưu mk_ ra file để dùng lại sau restart. mk_ chỉ hiện 1 lần khi cấp!</summary>
        public void SaveKey(string path)
        {
            if (string.IsNullOrEmpty(MkKey)) throw new St4iConfigException("Chưa có mk_ để lưu.");
            File.WriteAllText(path, JsonSerializer.Serialize(new Dictionary<string, object>
            { ["mkKey"] = MkKey, ["machineCode"] = MachineCode }));
        }

        /// <summary>Nạp mk_ đã lưu. Trả true nếu có.</summary>
        public bool LoadKey(string path)
        {
            if (!File.Exists(path)) return false;
            var o = ParseJson(File.ReadAllText(path));
            MkKey = GetStr(o, "mkKey") ?? MkKey;
            MachineCode = GetStr(o, "machineCode") ?? MachineCode;
            return !string.IsNullOrEmpty(MkKey);
        }

        // ══════════════════════════════════════════════════════════════════════
        // RESULT — POST /api/v1/ingest/process-result
        // ══════════════════════════════════════════════════════════════════════
        public async Task<ProcessAck> SubmitProcessResultAsync(
            string serialNumber, string stepType, string result,
            IEnumerable<Metric> metrics = null, IEnumerable<Waveform> waveforms = null, Recipe recipe = null,
            string idempotencyKey = null, string ts = null, string machineCode = null,
            IDictionary<string, object> extra = null, CancellationToken ct = default)
        {
            result = (result ?? "").Trim().ToLowerInvariant();
            if (result != "pass" && result != "fail" && result != "warn" && result != "skip")
                throw new St4iConfigException($"result phải là pass|fail|warn|skip, nhận '{result}'");

            string mc = machineCode ?? MachineCode;
            if (string.IsNullOrEmpty(idempotencyKey))
                idempotencyKey = $"{mc ?? "dev"}:{stepType}:{Guid.NewGuid().ToString("N").Substring(0, 16)}";

            var payload = new Dictionary<string, object>
            {
                ["schemaVersion"] = SchemaVersion,
                ["serialNumber"] = serialNumber,
                ["stepType"] = stepType,
                ["result"] = result,
                ["ts"] = ts ?? IsoNow(),
                ["idempotencyKey"] = idempotencyKey,
            };
            if (!string.IsNullOrEmpty(mc)) payload["machineCode"] = mc;
            if (recipe != null) payload["recipe"] = recipe;
            if (metrics != null) payload["metrics"] = metrics.ToList();
            if (waveforms != null) payload["waveforms"] = waveforms.ToList();
            if (extra != null) foreach (var kv in extra) payload[kv.Key] = kv.Value;  // lineCode/lotCode/stationId(SỐ)…

            var data = await SendWithRetryAsync("process", "/api/v1/ingest/process-result", payload, ct).ConfigureAwait(false);
            return new ProcessAck
            {
                Success = GetBool(data, "success"),
                ProcessResultId = TryGet(data, "processResultId", out var id) && id.ValueKind == JsonValueKind.Number ? id.GetInt64() : (long?)null,
                Duplicate = GetBool(data, "duplicate"),
                Queued = GetBool(data, "queued"),
                SubmissionId = GetStr(data, "submissionId"),
            };
        }

        // ══════════════════════════════════════════════════════════════════════
        // INSPECTION — POST /api/v1/ingest/inspection  (AOI/AVI, doc 61 §5 / doc 28 v1.1)
        // ══════════════════════════════════════════════════════════════════════
        public async Task<InspectionAck> SubmitInspectionAsync(
            string serialNumber, string overallResult, IEnumerable<MeasurementPoint> measurements,
            string productModel = null, string variantCode = null, string idempotencyKey = null,
            string ts = null, string panelId = null, int? boardIndex = null, string inspectionTime = null,
            string machineCode = null, CancellationToken ct = default)
        {
            overallResult = (overallResult ?? "").Trim().ToUpperInvariant();
            if (overallResult != "OK" && overallResult != "NG" && overallResult != "NTF")
                throw new St4iConfigException($"overallResult phải OK|NG|NTF, nhận '{overallResult}'");
            string mc = machineCode ?? MachineCode;
            var payload = new Dictionary<string, object>
            {
                ["schemaVersion"] = "1.1",
                ["serialNumber"] = serialNumber,
                ["overallResult"] = overallResult,
                ["inspectionTime"] = inspectionTime ?? ts ?? IsoNow(),
                ["measurements"] = measurements.ToList(),
            };
            if (!string.IsNullOrEmpty(mc)) payload["machineCode"] = mc;
            if (!string.IsNullOrEmpty(productModel)) payload["productModel"] = productModel;
            if (!string.IsNullOrEmpty(variantCode)) payload["variantCode"] = variantCode;
            if (!string.IsNullOrEmpty(idempotencyKey)) payload["idempotencyKey"] = idempotencyKey;
            if (!string.IsNullOrEmpty(panelId)) payload["panelId"] = panelId;
            if (boardIndex.HasValue) payload["boardIndex"] = boardIndex.Value;

            var data = await SendWithRetryAsync("inspection", "/api/v1/ingest/inspection", payload, ct).ConfigureAwait(false);
            return new InspectionAck
            {
                Success = GetBool(data, "success"),
                InspectionId = TryGet(data, "inspectionId", out var id) && id.ValueKind == JsonValueKind.Number ? id.GetInt64() : (long?)null,
                Duplicate = GetBool(data, "duplicate"),
                Queued = GetBool(data, "queued"),
            };
        }

        // ══════════════════════════════════════════════════════════════════════
        // TELEMETRY — POST /api/v1/ingest/telemetry
        // ══════════════════════════════════════════════════════════════════════
        public async Task<TelemetryAck> SubmitTelemetryAsync(IEnumerable<Sample> samples, CancellationToken ct = default)
        {
            var norm = new List<Sample>();
            foreach (var s in samples)
            {
                if (s.Ts == null) s.Ts = IsoNow();
                if (s.DeviceId == null && !string.IsNullOrEmpty(MachineCode)) s.DeviceId = MachineCode;
                norm.Add(s);
            }
            if (norm.Count == 0) throw new St4iConfigException("SubmitTelemetryAsync cần ít nhất 1 sample.");

            var data = await SendWithRetryAsync("telemetry", "/api/v1/ingest/telemetry",
                new Dictionary<string, object> { ["samples"] = norm }, ct).ConfigureAwait(false);
            return new TelemetryAck
            {
                Accepted = TryGet(data, "accepted", out var a) && a.ValueKind == JsonValueKind.Number ? a.GetInt32() : 0,
                Received = TryGet(data, "received", out var r) && r.ValueKind == JsonValueKind.Number ? r.GetInt32() : 0,
                Machine = GetStr(data, "machine"),
            };
        }

        // ══════════════════════════════════════════════════════════════════════
        // Heartbeat — POST /api/machine/heartbeat  (X-API-Key, KHÔNG Bearer)
        // ══════════════════════════════════════════════════════════════════════
        public async Task<JsonElement> HeartbeatAsync(CancellationToken ct = default)
        {
            if (string.IsNullOrEmpty(MkKey)) throw new St4iConfigException("Heartbeat cần mk_.");
            string url = $"{_serverUrl}/api/machine/heartbeat";
            string body = JsonSerializer.Serialize(new Dictionary<string, object> { ["apiKey"] = MkKey }, J);
            var (status, raw) = await HttpSendAsync(HttpMethod.Post, url, true, true, body, ct).ConfigureAwait(false);
            var data = ParseJson(raw);
            if (status >= 400) throw new St4iApiException(GetStr(data, "message") ?? $"Heartbeat lỗi (HTTP {status})", status, "", raw);
            return data;
        }

        // ══════════════════════════════════════════════════════════════════════
        // Config-sync — kéo recipe/cấu hình (server cần CONFIG_SYNC_GENERIC_ENABLED)
        // ══════════════════════════════════════════════════════════════════════
        private async Task<JsonElement> CfgGetAsync(string path, IDictionary<string, string> selectors, CancellationToken ct)
        {
            var qs = new List<string>();
            qs.Add("configKind=" + Uri.EscapeDataString(selectors["configKind"]));
            if (!string.IsNullOrEmpty(MachineCode)) qs.Add("machineCode=" + Uri.EscapeDataString(MachineCode));
            foreach (var kv in selectors)
                if (kv.Key != "configKind" && !string.IsNullOrEmpty(kv.Value))
                    qs.Add(kv.Key + "=" + Uri.EscapeDataString(kv.Value));
            string url = $"{_serverUrl}{path}?{string.Join("&", qs)}";
            var (status, raw) = await HttpSendAsync(HttpMethod.Get, url, true, false, null, ct).ConfigureAwait(false);
            var data = ParseJson(raw);
            if (status >= 400 || (TryGet(data, "success", out var ok) && ok.ValueKind == JsonValueKind.False))
                throw new St4iApiException(GetStr(data, "message") ?? $"config-sync lỗi (HTTP {status})", status, "", raw);
            return data;
        }

        private static ConfigVersion ToConfigVersion(JsonElement d) => new ConfigVersion
        {
            Success = GetBool(d, "success"),
            ConfigKind = GetStr(d, "configKind"),
            Code = GetStr(d, "code"),
            Name = GetStr(d, "name"),
            Version = GetStr(d, "version"),
            Checksum = GetStr(d, "checksum"),
            ResolvedBy = GetStr(d, "resolvedBy"),
            Payload = TryGet(d, "payload", out var p) ? p : default,
        };

        /// <summary>Kiểm version cấu hình active (nhẹ). configKind ∈ recipe|device_settings|points|model.</summary>
        public async Task<ConfigVersion> CheckConfigAsync(string configKind = "recipe",
            string configCode = null, string productModelCode = null, string variantCode = null, CancellationToken ct = default)
            => ToConfigVersion(await CfgGetAsync("/api/machine/config-sync/check", new Dictionary<string, string>
            { ["configKind"] = configKind, ["configCode"] = configCode, ["productModelCode"] = productModelCode, ["variantCode"] = variantCode }, ct).ConfigureAwait(false));

        /// <summary>Tải payload cấu hình đầy đủ + checksum. Sau khi APPLY, gọi AckConfigAsync().</summary>
        public async Task<ConfigVersion> GetConfigAsync(string configKind = "recipe",
            string configCode = null, string productModelCode = null, string variantCode = null, CancellationToken ct = default)
            => ToConfigVersion(await CfgGetAsync("/api/machine/config-sync/get", new Dictionary<string, string>
            { ["configKind"] = configKind, ["configCode"] = configCode, ["productModelCode"] = productModelCode, ["variantCode"] = variantCode }, ct).ConfigureAwait(false));

        /// <summary>Báo server cấu hình máy ĐÃ ÁP. Trả {Success, MachineId, DriftState}.</summary>
        public async Task<ConfigAck> AckConfigAsync(string configKind, string code = null, string version = null, string checksum = null, CancellationToken ct = default)
        {
            var payload = new Dictionary<string, object> { ["configKind"] = configKind };
            if (!string.IsNullOrEmpty(MachineCode)) payload["machineCode"] = MachineCode;
            if (code != null) payload["code"] = code;
            if (version != null) payload["version"] = version;
            if (checksum != null) payload["checksum"] = checksum;
            string url = $"{_serverUrl}/api/machine/config-sync/ack";
            var (status, raw) = await HttpSendAsync(HttpMethod.Post, url, true, false, JsonSerializer.Serialize(payload, J), ct).ConfigureAwait(false);
            var data = ParseJson(raw);
            if (status >= 400 || (TryGet(data, "success", out var ok) && ok.ValueKind == JsonValueKind.False))
                throw new St4iApiException(GetStr(data, "message") ?? $"AckConfig lỗi (HTTP {status})", status, "", raw);
            return new ConfigAck
            {
                Success = GetBool(data, "success"),
                MachineId = TryGet(data, "machineId", out var m) && m.ValueKind == JsonValueKind.Number ? m.GetInt64() : 0,
                ConfigKind = GetStr(data, "configKind"),
                DriftState = GetStr(data, "driftState"),
            };
        }

        /// <summary>
        /// Vòng lặp pull hoàn chỉnh: check → (nếu version khác cachedVersion) get → applyAsync(cfg) → ack.
        /// applyAsync nạp cfg.Payload vào chương trình máy, PHẢI trả true khi áp thành công.
        /// </summary>
        public async Task<SyncResult> SyncConfigAsync(Func<ConfigVersion, Task<bool>> applyAsync,
            string configKind = "recipe", string cachedVersion = null,
            string configCode = null, string productModelCode = null, string variantCode = null, CancellationToken ct = default)
        {
            var chk = await CheckConfigAsync(configKind, configCode, productModelCode, variantCode, ct).ConfigureAwait(false);
            if (chk.Version != null && chk.Version == cachedVersion)
                return new SyncResult { Changed = false, Version = chk.Version };
            var cfg = await GetConfigAsync(configKind, configCode, productModelCode, variantCode, ct).ConfigureAwait(false);
            if (!await applyAsync(cfg).ConfigureAwait(false))
                return new SyncResult { Changed = false, Version = chk.Version, Applied = false };
            var ack = await AckConfigAsync(configKind, cfg.Code, cfg.Version, cfg.Checksum, ct).ConfigureAwait(false);
            return new SyncResult { Changed = true, Version = cfg.Version, DriftState = ack.DriftState };
        }

        // ══════════════════════════════════════════════════════════════════════
        // Gửi có retry + hàng đợi local (store-and-forward)
        // ══════════════════════════════════════════════════════════════════════
        private async Task<JsonElement> SendWithRetryAsync(string kind, string path, Dictionary<string, object> payload, CancellationToken ct)
        {
            if (QueueLen() > 0)
                try { await FlushQueueAsync(ct).ConfigureAwait(false); } catch (St4iNetworkException) { /* mạng kém — thử tiếp */ }

            string url = $"{_serverUrl}{path}";
            string body = JsonSerializer.Serialize(payload, J);
            int lastStatus = 0;

            for (int attempt = 0; attempt <= _maxRetries; attempt++)
            {
                int status; string raw;
                try { (status, raw) = await HttpSendAsync(HttpMethod.Post, url, true, false, body, ct).ConfigureAwait(false); }
                catch (St4iNetworkException e)
                {
                    if (attempt < _maxRetries) { await BackoffAsync(attempt, 0, ct).ConfigureAwait(false); continue; }
                    Enqueue(kind, path, payload);
                    throw new St4iNetworkException($"{path}: mất mạng, đã xếp vào hàng đợi local. ({e.Message})");
                }

                var data = ParseJson(raw);
                lastStatus = status;

                if (status >= 200 && status < 300)
                    return TryGet(data, "data", out var d) ? d : data;   // {ok:true,data:{…}} -> data

                if (RetryableStatus.Contains(status))
                {
                    if (attempt < _maxRetries) { await BackoffAsync(attempt, 0, ct).ConfigureAwait(false); continue; }
                    Enqueue(kind, path, payload);
                    throw new St4iNetworkException($"{path}: server tạm lỗi HTTP {status} sau {_maxRetries + 1} lần — đã xếp hàng.");
                }

                // 4xx còn lại = LỖI VĨNH VIỄN -> KHÔNG xếp hàng, ném ngay để firmware sửa/loại bỏ.
                string code = null, msg = null;
                if (TryGet(data, "error", out var err))
                {
                    if (err.ValueKind == JsonValueKind.Object) { code = GetStr(err, "code"); msg = GetStr(err, "message"); }
                    else if (err.ValueKind == JsonValueKind.String) msg = err.GetString();
                }
                throw new St4iApiException(msg ?? $"{path} bị từ chối (HTTP {status})", status, code ?? "", raw);
            }
            throw new St4iApiException($"{path}: hết retry (HTTP {lastStatus})", lastStatus);
        }

        // ── Hàng đợi local ───────────────────────────────────────────────────
        private void Enqueue(string kind, string path, Dictionary<string, object> payload)
        {
            string line = JsonSerializer.Serialize(new Dictionary<string, object>
            { ["kind"] = kind, ["path"] = path, ["payload"] = payload, ["queuedAt"] = IsoNow() }, J);
            lock (_queueLock)
            {
                if (_queuePath != null) File.AppendAllText(_queuePath, line + "\n");
                else _memQueue.Add(line);
            }
        }

        private int QueueLen()
        {
            lock (_queueLock)
            {
                if (_queuePath != null)
                    return File.Exists(_queuePath) ? File.ReadAllLines(_queuePath).Count(l => l.Trim().Length > 0) : 0;
                return _memQueue.Count;
            }
        }

        private List<string> DrainQueue()
        {
            lock (_queueLock)
            {
                if (_queuePath != null)
                {
                    if (!File.Exists(_queuePath)) return new List<string>();
                    var lines = File.ReadAllLines(_queuePath).Where(l => l.Trim().Length > 0).ToList();
                    File.WriteAllText(_queuePath, "");
                    return lines;
                }
                var drained = new List<string>(_memQueue);
                _memQueue.Clear();
                return drained;
            }
        }

        /// <summary>Thử gửi lại toàn bộ bản ghi đang xếp hàng (cùng idempotencyKey nên server dedup). Trả (sent, kept).</summary>
        public async Task<(int sent, int kept)> FlushQueueAsync(CancellationToken ct = default)
        {
            var pending = DrainQueue();
            if (pending.Count == 0) return (0, 0);

            int sent = 0; var kept = new List<(string kind, string path, JsonElement payload)>();
            foreach (var line in pending)
            {
                var entry = ParseJson(line);
                string path = GetStr(entry, "path");
                string kind = GetStr(entry, "kind");
                var payload = TryGet(entry, "payload", out var p) ? p : default;
                int status; string raw;
                try { (status, raw) = await HttpSendAsync(HttpMethod.Post, $"{_serverUrl}{path}", true, false, JsonSerializer.Serialize(payload), ct).ConfigureAwait(false); }
                catch (St4iNetworkException) { kept.Add((kind, path, payload)); continue; }

                if ((status >= 200 && status < 300) || status == 409) sent++;
                else if (RetryableStatus.Contains(status)) kept.Add((kind, path, payload));
                else sent++;  // 4xx payload sai -> bỏ (không gửi được) nhưng coi như đã xử lý
            }
            foreach (var e in kept)
                Enqueue(e.kind, e.path, JsonSerializer.Deserialize<Dictionary<string, object>>(e.payload.GetRawText()));
            return (sent, kept.Count);
        }

        private async Task BackoffAsync(int attempt, double retryAfter, CancellationToken ct)
        {
            double delay = Math.Min(_backoffBase * Math.Pow(2, attempt), _backoffMax);
            if (retryAfter > 0) delay = Math.Max(delay, retryAfter);
            await Task.Delay(TimeSpan.FromSeconds(delay), ct).ConfigureAwait(false);
        }
    }
}
