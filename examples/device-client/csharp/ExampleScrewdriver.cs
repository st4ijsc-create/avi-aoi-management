// ─────────────────────────────────────────────────────────────────────────────
// ExampleScrewdriver — ví dụ vòng đời hoàn chỉnh dùng St4iDeviceClient (C#).
// Mô phỏng phần mềm chạy trong máy bắt vít nội bộ:
//   1) kéo recipe về máy (config-sync)  2) siết N con vít, gửi RESULT (torque+angle+waveform)
//   3) idempotent replay  4) heartbeat  5) (tùy chọn) telemetry cảm biến IoT.
//
// Chạy:  dotnet run --project examples/device-client/csharp
//   ST4I_SERVER=http://127.0.0.1:3012 ST4I_MK_KEY=mk_... [ST4I_ESP_KEY=mk_...] [ST4I_VERIFY_TLS=0]
//
// WPF: đây là console demo. Trong WPF, giữ MỘT St4iDeviceClient (singleton), gọi async,
//      chạy vòng telemetry/heartbeat trên Task nền (xem doc 61 §11.3 + St4iDeviceClient.cs header).
// ─────────────────────────────────────────────────────────────────────────────
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Threading.Tasks;
using St4i.DeviceClient;

internal static class ExampleScrewdriver
{
    private static string Env(string k, string dflt = null) =>
        Environment.GetEnvironmentVariable(k) is string v && v.Length > 0 ? v : dflt;

    private static async Task<int> Main()
    {
        string server = Env("ST4I_SERVER", "http://127.0.0.1:3012");
        string mkKey = Env("ST4I_MK_KEY");
        string espKey = Env("ST4I_ESP_KEY");
        bool verifyTls = Env("ST4I_VERIFY_TLS", "1") != "0";
        if (string.IsNullOrEmpty(mkKey)) { Console.Error.WriteLine("Thiếu ST4I_MK_KEY."); return 2; }

        // ── Máy bắt vít ──────────────────────────────────────────────────────
        using var scrw = new St4iDeviceClient(
            server, mkKey: mkKey, machineCode: "SCRW-SIM-01",
            queuePath: "scrw_queue.jsonl", verifyTls: verifyTls);

        // 1) Config-sync: kéo recipe active về máy (check → get → apply → ack)
        string cachedVersion = null;
        var recipe = new Recipe { Code = "SCRW-RC-001", Version = "1" };
        try
        {
            var sync = await scrw.SyncConfigAsync(async cfg =>
            {
                // APPLY: nạp payload recipe vào chương trình máy (ở đây chỉ in ra).
                Console.WriteLine($"  [recipe] code={cfg.Code} v{cfg.Version} payload={cfg.Payload}");
                recipe = new Recipe { Code = cfg.Code, Version = cfg.Version, Checksum = cfg.Checksum };
                await Task.CompletedTask;
                return true;
            }, configKind: "recipe", cachedVersion: cachedVersion);
            cachedVersion = sync.Version;
            Console.WriteLine($"[config-sync] changed={sync.Changed} version={sync.Version} drift={sync.DriftState}");
        }
        catch (St4iApiException e) { Console.WriteLine($"[config-sync] bỏ qua (HTTP {e.Status}): {e.Message}"); }

        // 2) Siết 5 con vít → gửi RESULT
        var rnd = new Random(42);
        for (int i = 1; i <= 5; i++)
        {
            double torque = Math.Round(11.5 + rnd.NextDouble() * 2.0, 2);   // ~11.5..13.5 Nm
            double angle = Math.Round(340 + rnd.NextDouble() * 40, 0);
            string verdict = (torque >= 10.5 && torque <= 13.5) ? "pass" : (torque > 13.5 ? "fail" : "warn");
            string unit = "DEVGUIDE-CS-" + i.ToString("D4");

            // waveform torque-vs-angle (4 điểm minh họa)
            var wave = new Waveform
            {
                Name = "torque_vs_angle", Unit = "Nm", RateHz = 1000,
                Samples = new List<double[]> { new[] { 0.0, 0.1 }, new[] { 0.1, 4.0 }, new[] { 0.2, 9.5 }, new[] { 0.3, torque } },
            };
            try
            {
                var ack = await scrw.SubmitProcessResultAsync(
                    serialNumber: unit, stepType: "screw_tightening", result: verdict,
                    recipe: recipe,
                    metrics: new[]
                    {
                        new Metric { Name = "torque", Value = torque, Unit = "Nm", Lsl = 10.5, Usl = 13.5, Nominal = 12.0 },
                        new Metric { Name = "angle",  Value = angle,  Unit = "deg" },
                    },
                    waveforms: new[] { wave },
                    idempotencyKey: $"SCRW-SIM-01:SCRW-RC-001:{i:D6}",
                    // Genealogy: stationId PHẢI là SỐ (chuỗi → 400). Field lạ top-level bị strip.
                    extra: new Dictionary<string, object> { ["lineCode"] = "LINE-01", ["lotCode"] = "LOT-2026-0001" });
                Console.WriteLine($"[{i}] {verdict.ToUpperInvariant(),-4} torque={torque}Nm angle={angle}° -> id={ack.ProcessResultId}{(ack.Duplicate ? " (dup)" : "")}");
            }
            catch (St4iNetworkException e) { Console.WriteLine($"[{i}] MẤT MẠNG -> đã xếp hàng: {e.Message}"); }
            catch (St4iApiException e) { Console.WriteLine($"[{i}] BỊ TỪ CHỐI (HTTP {e.Status} {e.Code}): {e.Message}"); }
        }

        // 3) Idempotent replay: gửi lại cùng key -> cùng id + duplicate
        var replay = await scrw.SubmitProcessResultAsync(
            serialNumber: "DEVGUIDE-CS-0001", stepType: "screw_tightening", result: "pass",
            idempotencyKey: "SCRW-SIM-01:SCRW-RC-001:000001",
            metrics: new[] { new Metric { Name = "torque", Value = 12.0, Unit = "Nm" } });
        Console.WriteLine($"[replay] id={replay.ProcessResultId} duplicate={replay.Duplicate}");

        // 4) Heartbeat
        try { var hb = await scrw.HeartbeatAsync(); Console.WriteLine($"[heartbeat] {hb}"); }
        catch (Exception e) { Console.WriteLine($"[heartbeat] {e.Message}"); }

        // 5) Telemetry cảm biến IoT (nếu có khóa ESP)
        if (!string.IsNullOrEmpty(espKey))
        {
            using var esp = new St4iDeviceClient(server, mkKey: espKey, machineCode: "ESP32-ENV-01", verifyTls: verifyTls);
            var t = await esp.SubmitTelemetryAsync(new[]
            {
                new Sample { Metric = "temperature", Value = 31.7, Unit = "C", Quality = "good" },
                new Sample { Metric = "humidity",    Value = 61.2, Unit = "%", Quality = "good" },
            });
            Console.WriteLine($"[telemetry] accepted={t.Accepted} received={t.Received}");
        }

        var flush = await scrw.FlushQueueAsync();
        Console.WriteLine($"[queue] flush cuối: sent={flush.sent} kept={flush.kept}");
        Console.WriteLine("Hoàn tất demo máy bắt vít (C#).");
        return 0;
    }
}
