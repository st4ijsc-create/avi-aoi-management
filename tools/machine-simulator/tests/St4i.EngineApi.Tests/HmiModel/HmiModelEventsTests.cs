using System.Net;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.HmiModel;
using St4i.EngineApi.Tests.Auth;
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.EngineApi.Tests.HmiModel;

/// <summary>
/// WS-HMI-0b Task 3 — change events for the component tree and the tag namespace, on their OWN realtime
/// lane (<c>WS /v1/hmi/changes</c>).
///
/// <para>🔴 <b>Why a second route rather than the existing stream — the decision this file measures.</b>
/// The plan said "extend the running <c>WS /v1/inspector/stream</c>, do not build a second SSE channel".
/// The second half stands and is honoured: this is a WebSocket, not SSE, so the web branch speaks ONE
/// realtime dialect at one more URL. The first half rested on a premise that measurement refuted —
/// <c>/v1/inspector/stream</c> is not a general API-event channel. <c>EventBus.Publish</c> has exactly one
/// caller in <c>src/</c> (<c>EdgePipeline.cs:135</c>, the OUTBOUND ingest path), so its frames mean "we sent
/// a reading for machine X and got status S", and an HMI model change is not more of that. Carrying
/// <c>tagCount</c> there would have required a new field on <c>ApiTraceEvent</c>, changing the frame on all
/// three surfaces the ruling at <c>InspectorStream.cs:217-219</c> froze. The codebase had already answered
/// this once — <c>InspectorBodiesResponse</c> took a new route rather than widen the frame — and this
/// follows that precedent.</para>
///
/// <para><b>KHÔNG đo cái gì — what this file deliberately does not measure:</b>
/// <list type="number">
///   <item><description>It does NOT measure which policy STRING is attached to the new route — that is
///   <c>RbacPolicyTests</c>, the one exhaustive census. Here a real logged-in Operator subscribes over the
///   real auth pipeline, and an anonymous client is refused.</description></item>
///   <item><description>It does NOT measure the existing inspector stream's behaviour. It measures only
///   that <c>ApiTraceEvent</c>'s wire shape is unchanged — the ruling's actual subject — and that this
///   lane never publishes onto that bus.</description></item>
///   <item><description>It does NOT measure delivery ordering under concurrent writers, or what a slow
///   subscriber does to a fast publisher. One writer, one subscriber, sequential.</description></item>
///   <item><description>It does NOT measure that a UI re-reads on being told. The event is a signal; what
///   a consumer does with it is WS-HMI-0c's.</description></item>
/// </list></para>
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class HmiModelEventsTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync()
    {
        var modelDir = Directory.CreateTempSubdirectory("st4i-hmi-ev-model-").FullName;
        var tagsDir = Directory.CreateTempSubdirectory("st4i-hmi-ev-tags-").FullName;
        var securityDir = Directory.CreateTempSubdirectory("st4i-hmi-ev-security-").FullName;

        await EnvLock.WaitAsync().ConfigureAwait(false);
        var prevModel = Environment.GetEnvironmentVariable(ComponentModelStore.EnvVarDir);
        var prevTags = Environment.GetEnvironmentVariable(TagNamespaceStore.EnvVarDir);
        var prevSecurity = Environment.GetEnvironmentVariable("ST4I_SECURITY_DIR");
        var prevEnvironment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        try
        {
            Environment.SetEnvironmentVariable(ComponentModelStore.EnvVarDir, modelDir);
            Environment.SetEnvironmentVariable(TagNamespaceStore.EnvVarDir, tagsDir);
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", securityDir);
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Production");

            var factory = new WebApplicationFactory<Program>();
            _ = factory.Server;
            return factory;
        }
        finally
        {
            Environment.SetEnvironmentVariable(ComponentModelStore.EnvVarDir, prevModel);
            Environment.SetEnvironmentVariable(TagNamespaceStore.EnvVarDir, prevTags);
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", prevSecurity);
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", prevEnvironment);
            EnvLock.Release();
        }
    }

    /// <summary>Logs in and returns both a cookie-carrying <see cref="HttpClient"/> and the raw
    /// <c>Set-Cookie</c> value, because a <c>TestServer</c> WebSocket upgrade does not share the
    /// <see cref="HttpClient"/>'s cookie container and has to be handed the header itself.</summary>
    private static async Task<(HttpClient Client, string Cookie)> LoginAsync(
        WebApplicationFactory<Program> factory, string username, string password)
    {
        string cookie;
        using (var raw = factory.CreateClient())
        {
            using var login = await raw.PostAsJsonAsync(
                "/v1/auth/login", new { username, password }, JsonOptions).ConfigureAwait(false);
            Assert.Equal(HttpStatusCode.OK, login.StatusCode);
            var setCookie = login.Headers.TryGetValues("Set-Cookie", out var values) ? values.First() : null;
            Assert.False(string.IsNullOrWhiteSpace(setCookie), "login returned no Set-Cookie");
            cookie = setCookie!.Split(';')[0];
        }

        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        using var again = await client.PostAsJsonAsync(
            "/v1/auth/login", new { username, password }, JsonOptions).ConfigureAwait(false);
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);

        return (client, cookie);
    }

    private static async Task<(WebApplicationFactory<Program> Factory, HttpClient Engineer, HttpClient Operator, string OperatorCookie)>
        NewFactoryWithUsersAsync(string suffix)
    {
        var factory = await CreateFactoryAsync().ConfigureAwait(false);

        using (var bootstrapClient = factory.CreateClient())
        {
            using var bootstrap = await bootstrapClient.PostAsJsonAsync(
                "/v1/auth/bootstrap",
                new { username = $"ev-admin-{suffix}", password = "AdminPass123!", displayName = (string?)null },
                JsonOptions).ConfigureAwait(false);
            Assert.Equal(HttpStatusCode.OK, bootstrap.StatusCode);
        }

        var userStore = factory.Services.GetRequiredService<IUserStore>();
        var hasher = new PasswordHasher<AppUser>();
        await userStore.CreateAsync($"ev-engineer-{suffix}", hasher.HashPassword(AppUser.Instance, "EngineerPass123!"),
            Roles.Engineer, null, "test", CancellationToken.None).ConfigureAwait(false);
        await userStore.CreateAsync($"ev-operator-{suffix}", hasher.HashPassword(AppUser.Instance, "OperatorPass123!"),
            Roles.Operator, null, "test", CancellationToken.None).ConfigureAwait(false);

        var (engineer, _) = await LoginAsync(factory, $"ev-engineer-{suffix}", "EngineerPass123!").ConfigureAwait(false);
        var (op, opCookie) = await LoginAsync(factory, $"ev-operator-{suffix}", "OperatorPass123!").ConfigureAwait(false);

        return (factory, engineer, op, opCookie);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fixtures
    // ─────────────────────────────────────────────────────────────────────

    private static ComponentModelDocument ValidModel(string machineCode) =>
        new(1, machineCode,
            new[] { new ComponentNode("spindle", "st4i.motor.spindle", "S", null, $"{machineCode}/spindle") },
            new[] { new ComponentTypeDef("st4i.motor.spindle", "Spindle", Array.Empty<ComponentTagDef>(),
                Array.Empty<ComponentStateDef>(), "fp.x") });

    private static TagDescriptor ReadTag(string path) =>
        new(path, "float", null, null, null, null, "r", null, new TagSource("simulated"), false);

    private static TagNamespaceDocument ValidNs(string machineCode) =>
        new(1, machineCode, new[] { ReadTag($"{machineCode}/a"), ReadTag($"{machineCode}/b") });

    /// <summary>Collects everything the lane publishes for the duration of a test, by subscribing to the
    /// SAME bus the WS route subscribes to. This measures the ENDPOINT's emission, which is what every
    /// proposition below is about; the socket itself is measured separately and once.</summary>
    private sealed class Recorder : IDisposable
    {
        private readonly IHmiChangeBus _bus;
        public List<HmiModelChangedEvent> Events { get; } = new();

        public Recorder(IHmiChangeBus bus)
        {
            _bus = bus;
            _bus.Changed += OnChanged;
        }

        private void OnChanged(HmiModelChangedEvent e)
        {
            lock (Events) Events.Add(e);
        }

        public void Dispose() => _bus.Changed -= OnChanged;
    }

    // ═════════════════════════════════════════════════════════════════════
    // The two happy paths — exactly ONE event each, carrying the canonical machine code.
    // ═════════════════════════════════════════════════════════════════════

    /// <summary>🔴 The route is spelled in LOWER CASE deliberately. Task 1 spent five fix rounds making one
    /// machine have one name; an event announcing <c>find-01</c> for a machine every read surface calls
    /// <c>FIND-01</c> sends a subscriber to a name that returns the §5-bis empty document — "nothing here" —
    /// which is precisely the "heard changed, re-read, found nothing" failure this task exists to prevent,
    /// arriving by a different door.</summary>
    [Fact]
    public async Task A_successful_component_put_emits_exactly_one_event_naming_the_machine_canonically()
    {
        var (factory, engineer, _, _) = await NewFactoryWithUsersAsync("component-one");
        await using var _f = factory;
        using var engineerC = engineer;
        using var recorder = new Recorder(factory.Services.GetRequiredService<IHmiChangeBus>());

        var put = await engineerC.PutAsJsonAsync(
            "/v1/components/find-01", ValidModel("find-01"), HmiContractJson.Options);
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var e = Assert.Single(recorder.Events);
        Assert.Equal(HmiModelEvents.ComponentModelChangeKind, e.Change);
        Assert.Equal("FIND-01", e.MachineCode);
        Assert.Null(e.TagCount);
    }

    [Fact]
    public async Task A_successful_tag_put_emits_exactly_one_event_carrying_the_tag_count()
    {
        var (factory, engineer, _, _) = await NewFactoryWithUsersAsync("tag-one");
        await using var _f = factory;
        using var engineerC = engineer;
        using var recorder = new Recorder(factory.Services.GetRequiredService<IHmiChangeBus>());

        var put = await engineerC.PutAsJsonAsync(
            "/v1/tags/find-02", ValidNs("find-02"), HmiContractJson.Options);
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var e = Assert.Single(recorder.Events);
        Assert.Equal(HmiModelEvents.TagNamespaceChangeKind, e.Change);
        Assert.Equal("FIND-02", e.MachineCode);
        Assert.Equal(2, e.TagCount);
    }

    // ═════════════════════════════════════════════════════════════════════
    // 🔴 THE MOST IMPORTANT TEST IN THIS TASK, stated as a PROPERTY rather than as a list.
    //
    // The property: a request that does not return 2xx emits nothing. The rows below are EVIDENCE that the
    // property is reachable by several different doors — they are not the property, and a future door
    // (a 5xx, a new guard, a status nobody has thought of) is covered by the assertion, not by the list.
    // A client that hears "changed", re-reads, and finds nothing changed stops trusting the channel; that
    // is cheap to cause and expensive to undo.
    //
    // Two of these doors did not exist when this task's brief was written: the 409 collision is Task 2's,
    // and so is the tag route/body machine-code guard.
    // ═════════════════════════════════════════════════════════════════════

    public static TheoryData<string, string, string> FailingWrites() => new()
    {
        // §5 violation — a setpoint with no hard band.
        { "component-400-section5", "/v1/components/FAIL-01",
          "{\"schemaVersion\":1,\"machineCode\":\"FAIL-01\",\"components\":[],\"types\":[{\"typeId\":\"t\"," +
          "\"label\":\"T\",\"tags\":[{\"name\":\"x\",\"role\":\"setpoint\",\"dataType\":\"float\"," +
          "\"policyAction\":\"p\"}],\"states\":[],\"defaultFaceplate\":\"f\"}]}" },

        // route/body machine-code mismatch.
        { "component-400-route-body", "/v1/components/FAIL-02",
          "{\"schemaVersion\":1,\"machineCode\":\"OTHER-99\",\"components\":[],\"types\":[]}" },

        // model-binding rejection — a field of the wrong kind.
        { "component-400-binding", "/v1/components/FAIL-03",
          "{\"schemaVersion\":\"one\",\"machineCode\":\"FAIL-03\",\"components\":[],\"types\":[]}" },

        // non-finite number: passes §5's presence rules, refused by the finite rule.
        { "component-400-nonfinite", "/v1/components/FAIL-04",
          "{\"schemaVersion\":1,\"machineCode\":\"FAIL-04\",\"components\":[],\"types\":[{\"typeId\":\"t\"," +
          "\"label\":\"T\",\"tags\":[{\"name\":\"x\",\"role\":\"setpoint\",\"dataType\":\"float\"," +
          "\"min\":1e400,\"max\":2,\"policyAction\":\"p\"}],\"states\":[],\"defaultFaceplate\":\"f\"}]}" },

        // §5 on the tag side — a writable tag with no policyAction.
        { "tag-400-section5", "/v1/tags/FAIL-05",
          "{\"schemaVersion\":1,\"machineCode\":\"FAIL-05\",\"tags\":[{\"path\":\"FAIL-05/x\"," +
          "\"dataType\":\"float\",\"access\":\"rw\",\"source\":{\"kind\":\"simulated\"}," +
          "\"isBackedByDriver\":false}]}" },

        // tag route/body mismatch.
        { "tag-400-route-body", "/v1/tags/FAIL-06",
          "{\"schemaVersion\":1,\"machineCode\":\"OTHER-99\",\"tags\":[]}" },

        // duplicate path within one document.
        { "tag-400-duplicate-path", "/v1/tags/FAIL-07",
          "{\"schemaVersion\":1,\"machineCode\":\"FAIL-07\",\"tags\":[" +
          "{\"path\":\"FAIL-07/x\",\"dataType\":\"float\",\"access\":\"r\",\"source\":{\"kind\":\"simulated\"},\"isBackedByDriver\":false}," +
          "{\"path\":\"FAIL-07/x\",\"dataType\":\"float\",\"access\":\"r\",\"source\":{\"kind\":\"simulated\"},\"isBackedByDriver\":false}]}" },
    };

    [Theory]
    [MemberData(nameof(FailingWrites))]
    public async Task A_write_that_does_not_succeed_emits_nothing(string label, string url, string json)
    {
        var (factory, engineer, _, _) = await NewFactoryWithUsersAsync($"fail-{label}");
        await using var _f = factory;
        using var engineerC = engineer;
        using var recorder = new Recorder(factory.Services.GetRequiredService<IHmiChangeBus>());

        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using var put = await engineerC.PutAsync(url, content);

        Assert.True((int)put.StatusCode is >= 400 and < 500,
            $"[{label}] expected this write to be refused, but it answered {(int)put.StatusCode} — the test " +
            "is only evidence for the emit-nothing property if the write genuinely failed.");
        Assert.Empty(recorder.Events);
    }

    /// <summary>The 409 arm, which needs prior state and so cannot be a row in the theory above: a tag path
    /// is a GLOBAL key, so a second machine claiming one another machine owns is refused with a conflict.
    /// The brief predates this failure mode entirely.</summary>
    [Fact]
    public async Task A_tag_put_refused_with_409_emits_nothing()
    {
        var (factory, engineer, _, _) = await NewFactoryWithUsersAsync("fail-409");
        await using var _f = factory;
        using var engineerC = engineer;

        var owner = new TagNamespaceDocument(1, "OWNER-11", new[] { ReadTag("shared/path") });
        Assert.Equal(HttpStatusCode.OK,
            (await engineerC.PutAsJsonAsync("/v1/tags/OWNER-11", owner, HmiContractJson.Options)).StatusCode);

        // Recorder starts AFTER the legitimate write, so the only event it could see is a wrong one.
        using var recorder = new Recorder(factory.Services.GetRequiredService<IHmiChangeBus>());

        var clash = new TagNamespaceDocument(1, "CLAIM-11", new[] { ReadTag("shared/path") });
        using var put = await engineerC.PutAsJsonAsync("/v1/tags/CLAIM-11", clash, HmiContractJson.Options);

        Assert.Equal(HttpStatusCode.Conflict, put.StatusCode);
        Assert.Empty(recorder.Events);
    }

    /// <summary>The authorisation arm: an Operator is refused the write, and a refused write is still a
    /// write that did not happen. Worth its own row because it fails in the pipeline BEFORE the handler
    /// runs at all, which is a different mechanism from every other row.</summary>
    [Fact]
    public async Task A_write_refused_by_authorisation_emits_nothing()
    {
        var (factory, engineer, op, _) = await NewFactoryWithUsersAsync("fail-403");
        await using var _f = factory;
        using var engineerC = engineer;
        using var operatorC = op;
        using var recorder = new Recorder(factory.Services.GetRequiredService<IHmiChangeBus>());

        using var put = await operatorC.PutAsJsonAsync(
            "/v1/components/FORBID-01", ValidModel("FORBID-01"), HmiContractJson.Options);

        Assert.Equal(HttpStatusCode.Forbidden, put.StatusCode);
        Assert.Empty(recorder.Events);
    }

    // ═════════════════════════════════════════════════════════════════════
    // 🔴 P1 — a successful write must never be reported as a failure because ANNOUNCING it failed.
    //
    // EventBus-style fan-out invokes subscribers synchronously on the publishing thread, and this emit sits
    // between a store write that already succeeded and the response. An unguarded throw would return 500
    // for a change that really happened — telling the client nothing happened when something did, which is
    // the exact inversion of the emit-nothing property above and strictly worse, because the record on disk
    // and the client's belief now disagree in the direction nothing can correct.
    // ═════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task A_subscriber_that_throws_cannot_turn_a_successful_write_into_a_failure()
    {
        var (factory, engineer, _, _) = await NewFactoryWithUsersAsync("throwing-subscriber");
        await using var _f = factory;
        using var engineerC = engineer;

        var bus = factory.Services.GetRequiredService<IHmiChangeBus>();
        void Saboteur(HmiModelChangedEvent _) => throw new InvalidOperationException("subscriber exploded");
        bus.Changed += Saboteur;

        // A second, well-behaved subscriber added AFTER the saboteur: the delivery of one must not be
        // cancelled by the failure of another, or one bad tab silences the lane for every other client.
        using var recorder = new Recorder(bus);

        try
        {
            using var put = await engineerC.PutAsJsonAsync(
                "/v1/components/BOOM-01", ValidModel("BOOM-01"), HmiContractJson.Options);

            Assert.Equal(HttpStatusCode.OK, put.StatusCode);

            // ...and the write really landed, so the 200 is not itself a lie.
            using var get = await engineerC.GetAsync("/v1/components/BOOM-01");
            var back = await get.Content.ReadFromJsonAsync<ComponentModelDocument>(HmiContractJson.Options);
            Assert.Single(back!.Components);

            Assert.Single(recorder.Events);
        }
        finally
        {
            bus.Changed -= Saboteur;
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    // The lane itself: it delivers over a real socket, it is Operator-gated, and it does NOT backfill.
    // ═════════════════════════════════════════════════════════════════════

    /// <summary>🔴 <b>THE BACKFILL RULE, pinned rather than inherited.</b> This lane replays NOTHING on
    /// connect. A change event is an invalidation signal, not a record: a client that has just connected is
    /// about to read current state anyway, so replaying history would make a fresh pane issue re-reads for
    /// changes it never missed. And a bounded replay could never promise completeness to a RECONNECTING
    /// client either, so a client that cares must re-read on reconnect regardless — which means a backfill
    /// buys nothing anyone can rely on.
    ///
    /// <para>The inspector stream backfills 200 and skips it only when the client passes
    /// <c>?skipBackfill=1</c>, which its web client sets on reconnect but NOT on first connect — so that
    /// lane deliberately behaves differently for a fresh pane than a reconnecting one. This lane behaves
    /// the same for both, and that is the stated rule rather than an inherited accident.</para></summary>
    [Fact]
    public async Task The_change_lane_replays_nothing_on_connect_and_then_delivers_live()
    {
        var (factory, engineer, op, opCookie) = await NewFactoryWithUsersAsync("ws-live");
        await using var _f = factory;
        using var engineerC = engineer;
        using var operatorC = op;

        // A change BEFORE anyone is listening. A backfilling lane would replay this on connect.
        Assert.Equal(HttpStatusCode.OK,
            (await engineerC.PutAsJsonAsync("/v1/components/PRE-01", ValidModel("PRE-01"), HmiContractJson.Options)).StatusCode);

        var wsClient = factory.Server.CreateWebSocketClient();
        wsClient.ConfigureRequest = r => r.Headers["Cookie"] = opCookie;

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        using var socket = await wsClient.ConnectAsync(
            new Uri(factory.Server.BaseAddress, "/v1/hmi/changes"), cts.Token);

        Assert.Equal(WebSocketState.Open, socket.State);

        // Now a change WHILE listening.
        Assert.Equal(HttpStatusCode.OK,
            (await engineerC.PutAsJsonAsync("/v1/tags/live-01", ValidNs("live-01"), HmiContractJson.Options)).StatusCode);

        var first = await ReceiveOneAsync(socket, cts.Token);

        // The FIRST frame is the live change, never the pre-connect one — which is the backfill rule
        // measured rather than asserted: had this lane replayed, PRE-01 would have arrived first.
        Assert.Equal("LIVE-01", first.GetProperty("machineCode").GetString());
        Assert.Equal(2, first.GetProperty("tagCount").GetInt32());
    }

    [Fact]
    public async Task The_change_lane_refuses_an_unauthenticated_subscriber()
    {
        var (factory, engineer, _, _) = await NewFactoryWithUsersAsync("ws-anon");
        await using var _f = factory;
        using var engineerC = engineer;

        var wsClient = factory.Server.CreateWebSocketClient();
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));

        await Assert.ThrowsAnyAsync<Exception>(
            () => wsClient.ConnectAsync(new Uri(factory.Server.BaseAddress, "/v1/hmi/changes"), cts.Token));
    }

    private static async Task<JsonElement> ReceiveOneAsync(WebSocket socket, CancellationToken ct)
    {
        var buffer = new byte[16 * 1024];
        var result = await socket.ReceiveAsync(buffer, ct);
        Assert.Equal(WebSocketMessageType.Text, result.MessageType);
        using var doc = JsonDocument.Parse(new ReadOnlyMemory<byte>(buffer, 0, result.Count));
        return doc.RootElement.Clone();
    }

    // ═════════════════════════════════════════════════════════════════════
    // 🔴 The ruling this task nearly broke: the EXISTING stream's frame is untouched.
    // ═════════════════════════════════════════════════════════════════════

    /// <summary>The commitment at <c>InspectorStream.cs:217-219</c> is that
    /// <c>WS /v1/inspector/stream</c>'s frames stay byte-identical. This pins its SHAPE — the exact ten
    /// property names, in order — so that adding a field to <c>ApiTraceEvent</c> to carry an HMI concern
    /// (the shortcut this task refused) reddens here rather than being discovered by the web branch.
    ///
    /// <para>What this does NOT measure: the values, the enum spellings (that is
    /// <c>EnumSpellingContractTests</c>), or the WPF/web Export files that share this shape.</para></summary>
    [Fact]
    public void The_existing_inspector_frame_shape_is_unchanged()
    {
        var e = new St4i.EdgeCore.Infrastructure.ApiTraceEvent(
            DateTimeOffset.UnixEpoch, "M1", St4i.Connector.Abstractions.Models.ReadingKind.Telemetry,
            "POST", "/x", 200, 5, St4i.EdgeCore.Models.TransportMode.Demo, false, null);

        var json = JsonSerializer.Serialize(e, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        using var doc = JsonDocument.Parse(json);

        Assert.Equal(
            new[] { "at", "machineCode", "kind", "method", "path", "status", "latencyMs", "mode", "duplicate", "error" },
            doc.RootElement.EnumerateObject().Select(p => p.Name).ToArray());
    }

    /// <summary>...and the new lane is a genuinely separate mechanism, not a second publisher onto the old
    /// bus. If an HMI change ever reached <c>EventBus</c>, every inspector subscriber and both Export files
    /// would start carrying rows they have no vocabulary for — the frame would still be byte-identical and
    /// the commitment would still be broken, which is why this is measured and not merely intended.</summary>
    [Fact]
    public async Task An_hmi_change_never_reaches_the_inspector_bus()
    {
        var (factory, engineer, _, _) = await NewFactoryWithUsersAsync("bus-separation");
        await using var _f = factory;
        using var engineerC = engineer;

        var inspectorBus = factory.Services.GetRequiredService<St4i.EdgeCore.Infrastructure.EventBus>();
        var seen = new List<St4i.EdgeCore.Infrastructure.ApiTraceEvent>();
        void OnTraced(St4i.EdgeCore.Infrastructure.ApiTraceEvent e) { lock (seen) seen.Add(e); }
        inspectorBus.Traced += OnTraced;

        try
        {
            Assert.Equal(HttpStatusCode.OK,
                (await engineerC.PutAsJsonAsync("/v1/components/SEP-01", ValidModel("SEP-01"), HmiContractJson.Options)).StatusCode);
            Assert.Equal(HttpStatusCode.OK,
                (await engineerC.PutAsJsonAsync("/v1/tags/SEP-01", ValidNs("SEP-01"), HmiContractJson.Options)).StatusCode);

            Assert.Empty(seen);
            Assert.Empty(inspectorBus.Recent(200));
        }
        finally
        {
            inspectorBus.Traced -= OnTraced;
        }
    }
}
