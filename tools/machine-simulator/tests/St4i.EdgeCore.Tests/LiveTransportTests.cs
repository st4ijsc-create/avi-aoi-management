using St4i.DeviceClient;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Transport;
using St4i.EdgeCore.Tests.Fakes;
using Xunit;

public class LiveTransportTests
{
    [Fact]
    public async Task Process_send_hits_process_result_and_maps_id()
    {
        var h = new CapturingHandler
        {
            Responder = (_, __) => (System.Net.HttpStatusCode.Created,
                "{\"ok\":true,\"data\":{\"success\":true,\"processResultId\":27817}}"),
        };
        var live = LiveTransport.ForMachine("http://x", "mk_test", "SCRW-01", null, true, h);
        var env = new CanonicalEnvelope(ReadingKind.ProcessResult, "SCRW-01", "/api/v1/ingest/process-result",
            new()
            {
                ["serialNumber"] = "SN1",
                ["stepType"] = "screw_tightening",
                ["result"] = "pass",
                ["idempotencyKey"] = "SCRW-01:RC1:000001",
                ["metrics"] = new List<object> { new Dictionary<string, object> { ["name"] = "torque", ["value"] = 12.1 } },
            }, "SCRW-01:RC1:000001");

        var ack = await live.SendAsync(env, default);

        Assert.True(ack.Success);
        Assert.Equal(27817, ack.Id);
        Assert.Contains("/api/v1/ingest/process-result", h.LastRequest!.RequestUri!.ToString());
    }

    // Regression: an OK measurement point has no defect — the Normalizer leaves defectSeverity/
    // defectCatalogCode null. LiveTransport used to coerce that to "" via `?? ""`, which serialized as
    // `"defectSeverity":""` on the wire. The live server schema is
    // `defectSeverity: z.enum([...]).optional()` — .optional() allows the KEY to be absent, but rejects
    // an empty string, so the whole `measurements` array failed validation and the server rejected the
    // entire inspection with HTTP 400. Since OK points dominate real traffic this broke the common case.
    [Fact]
    public async Task Inspection_send_with_OK_point_omits_empty_defectSeverity()
    {
        var h = new CapturingHandler
        {
            Responder = (_, __) => (System.Net.HttpStatusCode.Created,
                "{\"ok\":true,\"data\":{\"success\":true,\"inspectionId\":501}}"),
        };
        var live = LiveTransport.ForMachine("http://x", "mk_test", "AOI-01", null, true, h);
        var env = new CanonicalEnvelope(ReadingKind.Inspection, "AOI-01", "/api/v1/ingest/inspection",
            new()
            {
                ["serialNumber"] = "SN1",
                ["overallResult"] = "OK",
                ["idempotencyKey"] = "AOI-01:MB-X1-TOP:000001",
                ["measurements"] = new List<object>
                {
                    new Dictionary<string, object> { ["pointCode"] = "R12", ["result"] = "OK" },
                },
            }, "AOI-01:MB-X1-TOP:000001");

        var ack = await live.SendAsync(env, default);

        Assert.True(ack.Success);
        Assert.Equal(501, ack.Id);
        Assert.Contains("/api/v1/ingest/inspection", h.LastRequest!.RequestUri!.ToString());
        Assert.DoesNotContain("\"defectSeverity\":\"\"", h.LastBody);
        Assert.DoesNotContain("\"defectCatalogCode\":\"\"", h.LastBody);
    }

    // Task 19a — Auto-mode-graceful-when-unconfigured fix. An empty mkKey makes the wrapped
    // St4iDeviceClient throw St4iConfigException SYNCHRONOUSLY out of HttpSendAsync — before it ever
    // touches the HttpMessageHandler (see St4iDeviceClient.HttpSendAsync's `if
    // (string.IsNullOrEmpty(MkKey)) throw new St4iConfigException(...)` guard, which runs before the
    // real `_http.SendAsync` call). The Responder below throws if ever invoked, so this test also
    // proves the handler is never reached. Before the fix, this St4iConfigException propagated straight
    // out of SendAsync uninherited (LiveTransport only caught St4iNetworkException/St4iApiException),
    // which is exactly the bug that made AutoTransport's failed-ack fallback logic never trigger for an
    // unconfigured live transport (it never got an ack to inspect — it got an exception instead, and
    // AutoTransport.SendAsync only catches St4iNetworkException around its own live call).
    [Fact]
    public async Task SendAsync_with_unconfigured_mkKey_returns_failed_queued_ack_not_throw()
    {
        var h = new CapturingHandler
        {
            Responder = (_, __) => throw new InvalidOperationException(
                "handler must never be reached — St4iConfigException (no mk_) should short-circuit before any HTTP call"),
        };
        var live = LiveTransport.ForMachine("http://x", "", "M1", null, true, h);
        var env = new CanonicalEnvelope(ReadingKind.ProcessResult, "M1", "/api/v1/ingest/process-result",
            new()
            {
                ["serialNumber"] = "SN1",
                ["stepType"] = "screw_tightening",
                ["result"] = "pass",
                ["idempotencyKey"] = "M1:RC1:000001",
            }, "M1:RC1:000001");

        var ack = await live.SendAsync(env, default);

        Assert.False(ack.Success);
        Assert.True(ack.Queued);
        Assert.NotNull(ack.Error);
    }

    [Fact]
    public async Task HeartbeatAsync_with_unconfigured_mkKey_returns_failed_result_not_throw()
    {
        var h = new CapturingHandler
        {
            Responder = (_, __) => throw new InvalidOperationException("handler must never be reached"),
        };
        var live = LiveTransport.ForMachine("http://x", "", "M1", null, true, h);

        var result = await live.HeartbeatAsync("M1", default);

        Assert.False(result.Success);
    }

    [Fact]
    public async Task SyncConfigAsync_with_unconfigured_mkKey_returns_error_drift_state_not_throw()
    {
        var h = new CapturingHandler
        {
            Responder = (_, __) => throw new InvalidOperationException("handler must never be reached"),
        };
        var live = LiveTransport.ForMachine("http://x", "", "M1", null, true, h);

        var result = await live.SyncConfigAsync("M1", "recipe", null, default);

        Assert.False(result.Changed);
        Assert.Equal("error", result.DriftState);
    }

    // Fix-pass review crux #1 — a CONFIGURED (valid mk_) live connection that reaches the server and
    // gets a real 4xx back must SURFACE (Success:false, Queued:false, HttpStatus:400), never look like
    // a "queued for later" network hiccup. This exercises the pre-existing St4iApiException catch (NOT
    // the St4iConfigException one) — included here as the contrast baseline for the next test.
    [Fact]
    public async Task SendAsync_with_configured_live_4xx_surfaces_not_queued()
    {
        var h = new CapturingHandler
        {
            Responder = (_, __) => (System.Net.HttpStatusCode.BadRequest,
                "{\"error\":{\"message\":\"stepType không hợp lệ\",\"code\":\"VALIDATION\"}}"),
        };
        var live = LiveTransport.ForMachine("http://x", "mk_valid", "M1", null, true, h);
        var env = new CanonicalEnvelope(ReadingKind.ProcessResult, "M1", "/api/v1/ingest/process-result",
            new()
            {
                ["serialNumber"] = "SN1",
                ["stepType"] = "screw_tightening",
                ["result"] = "pass",
                ["idempotencyKey"] = "M1:RC1:000001",
            }, "M1:RC1:000001");

        var ack = await live.SendAsync(env, default);

        Assert.False(ack.Success);
        Assert.False(ack.Queued);
        Assert.Equal(400, ack.HttpStatus);
    }

    // Fix-pass review crux #2 — the gap the review flagged: St4iConfigException is thrown for TWO
    // unrelated reasons (missing mk_ AND a locally-rejected payload on a client that DOES have a valid
    // mk_ — see SubmitProcessResultAsync's own "result phải là pass|fail|warn|skip" guard, which runs
    // BEFORE any HTTP call, same as the missing-mk_ guard does). The naive fix (treat every
    // St4iConfigException as "unconfigured, queue+fallback") silently masked a real payload bug behind
    // a "queued, couldn't reach server" ack. RED before the MkKey-empty distinction was added to
    // LiveTransport.SendAsync (asserted Queued:false, got Queued:true) — GREEN after.
    [Fact]
    public async Task SendAsync_configured_but_malformed_payload_surfaces_not_queued()
    {
        var h = new CapturingHandler
        {
            Responder = (_, __) => throw new InvalidOperationException(
                "handler must never be reached — the SDK validates 'result' LOCALLY before any HTTP call"),
        };
        var live = LiveTransport.ForMachine("http://x", "mk_valid", "M1", null, true, h);
        var env = new CanonicalEnvelope(ReadingKind.ProcessResult, "M1", "/api/v1/ingest/process-result",
            new()
            {
                ["serialNumber"] = "SN1",
                ["stepType"] = "screw_tightening",
                ["result"] = "not-a-valid-result", // SubmitProcessResultAsync rejects this LOCALLY
                ["idempotencyKey"] = "M1:RC1:000001",
            }, "M1:RC1:000001");

        var ack = await live.SendAsync(env, default);

        Assert.False(ack.Success);
        Assert.False(ack.Queued); // MUST surface — a configured live with a bad payload is not "unreachable"
        Assert.Equal(400, ack.HttpStatus);
        Assert.NotNull(ack.Error);
    }
}
