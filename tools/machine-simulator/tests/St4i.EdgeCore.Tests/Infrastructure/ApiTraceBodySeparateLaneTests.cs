using System.Text;
using System.Text.Json;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
using Xunit;

namespace St4i.EdgeCore.Tests.Infrastructure;

/// <summary>
/// 🔴 Task AT-1 — owner item 27, THE OWNER'S RULING of 2026-08-22: a SEPARATE lane for the request body,
/// with <see cref="ApiTraceEvent"/>, the <c>WS /v1/inspector/stream</c> frame and the two Export JSON files
/// frozen to the byte.
/// <para>Each test below names the counterfactual that reddens it, because a test that is green on both
/// sides of a change measures nothing.</para>
/// </summary>
public sealed class ApiTraceBodySeparateLaneTests
{
    // The ten members, in declaration order, as three published surfaces serialize them today.
    private static readonly string[] FrozenTraceEventMembers =
    {
        "At", "MachineCode", "Kind", "Method", "Path", "Status", "LatencyMs", "Mode", "Duplicate", "Error",
    };

    private static CanonicalEnvelope RealisticProcessResult(int waveformPoints = 24)
    {
        var samples = new List<double[]>(waveformPoints);
        for (var i = 0; i < waveformPoints; i++) samples.Add(new[] { i / 1000.0, 123.456789 + i });

        var reading = new DeviceReading
        {
            MachineCode = "WELD-01",
            Kind = ReadingKind.ProcessResult,
            SerialNumber = "SN-ABC-000123456",
            StepType = "weld",
            Verdict = Verdict.Pass,
            RecipeCode = "RC-42",
            RecipeVersion = "v7",
            CycleCounter = 98765,
            Timestamp = DateTimeOffset.UtcNow,
            Waveforms = { new WaveformSeries("current", "A", 30.0, samples) },
            Genealogy = new Dictionary<string, object>
            {
                ["lineCode"] = "LINE-A",
                ["stationId"] = "7",
                ["operatorBadge"] = "EMP-00042",
            },
        };
        reading.Metrics.Add(new MetricSample("torque", 12.34, "Nm", 1, 99, 50));

        return Normalizer.Normalize(reading, MappingProfile.ForClass(DeviceClass.Automation));
    }

    /// <summary>🔴 THE WITNESS FOR THE FROZEN SURFACE — the single assertion the whole ruling rests on.
    /// Reddens the moment anybody adds, removes, renames or reorders a member of
    /// <see cref="ApiTraceEvent"/>, which is exactly the change task AS-1 refused to make unilaterally on
    /// 2026-08-21 and the owner then ruled against on 2026-08-22. That record is serialized straight onto a
    /// published WebSocket frame and into two JSON files on users' disks, and AS-1 measured that two of
    /// those three have no consumer count behind them at all.</summary>
    [Fact]
    public void ApiTraceEvent_still_has_exactly_the_ten_published_members_and_no_body()
    {
        var members = typeof(ApiTraceEvent)
            .GetProperties(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance)
            .Select(p => p.Name)
            .ToArray();

        Assert.Equal(FrozenTraceEventMembers, members);

        // Said twice on purpose: the shape assertion above would also catch this, but a future reader
        // deleting the array literal should still be stopped by a named statement of the actual rule.
        Assert.DoesNotContain(members, m => m.Contains("Body", StringComparison.OrdinalIgnoreCase) ||
                                            m.Contains("Payload", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>🔴 THE WITNESS FOR THE ALLOWLIST. Reddens if the allowlist is widened to admit customer
    /// data, or if it is ever reimplemented as a denylist — a denylist cannot close over
    /// <see cref="CanonicalEnvelope.Payload"/>, because <c>Normalizer</c> forwards every unrecognised
    /// genealogy key into that untyped dictionary, so the key space is open-ended and operator-supplied.
    /// <c>operatorBadge</c> below is exactly such a key: nothing in this repository knows it exists.</summary>
    [Fact]
    public void Body_renders_only_allowlisted_keys_and_names_every_key_it_withheld()
    {
        var body = ApiTraceBody.From(RealisticProcessResult(), DateTimeOffset.UtcNow);

        using var doc = JsonDocument.Parse(body.Json);
        var renderedKeys = doc.RootElement.EnumerateObject().Select(p => p.Name).ToArray();

        Assert.All(renderedKeys, k => Assert.Contains(k, ApiTraceBody.AllowedKeys));

        // The customer data item 27 names in its own body — measurements, serial numbers, recipe codes —
        // must not be in the rendered JSON at any nesting level.
        Assert.DoesNotContain("SN-ABC-000123456", body.Json, StringComparison.Ordinal);
        Assert.DoesNotContain("RC-42", body.Json, StringComparison.Ordinal);
        Assert.DoesNotContain("EMP-00042", body.Json, StringComparison.Ordinal);
        Assert.DoesNotContain("123.456789", body.Json, StringComparison.Ordinal);

        // ...and each one is NAMED as withheld, so a reader cannot mistake this for the whole body.
        Assert.Contains("serialNumber", body.WithheldKeys);
        Assert.Contains("operatorBadge", body.WithheldKeys);
        Assert.Contains(body.WithheldKeys, k => k.StartsWith("metrics[", StringComparison.Ordinal));
        Assert.Contains(body.WithheldKeys, k => k.StartsWith("waveforms[", StringComparison.Ordinal));
        Assert.Equal(body.WithheldKeys.Count, body.WithheldKeyCount);

        // The structural keys that make the surface worth having ARE present.
        Assert.Contains("schemaVersion", renderedKeys);
        Assert.Contains("result", renderedKeys);
    }

    /// <summary>🔴 THE WITNESS FOR THE LEAK THAT ALMOST SHIPPED — a regression test for a defect this
    /// feature's own tests found in it, which is why it asserts on VALUES and not on key names.
    /// <para><c>idempotencyKey</c> reads like a structural identifier and is not one:
    /// <c>Normalizer.BuildIdempotencyKey</c> composes it from the RECIPE CODE on every shape, and from the
    /// SERIAL NUMBER as well on the inspection shape. Both are values owner item 27 names as reasons to
    /// withhold. Allowlisting the key therefore re-admitted them through an allowlist built to exclude them,
    /// and a test that only checked which KEYS were rendered would have passed.</para>
    /// <para>Reddens if the raw key is ever put back on <see cref="ApiTraceBody.AllowedKeys"/> or restored
    /// as a member.</para></summary>
    [Fact]
    public void The_idempotency_key_is_digested_because_it_is_built_out_of_the_recipe_and_the_serial()
    {
        // Inspection is the worse of the two shapes: its key embeds the serial number as well.
        var inspection = new DeviceReading
        {
            MachineCode = "AOI-01",
            Kind = ReadingKind.Inspection,
            SerialNumber = "SN-SECRET-99",
            RecipeCode = "RECIPE-SECRET",
            CycleCounter = 4242,
            Timestamp = DateTimeOffset.UtcNow,
        };
        var env = Normalizer.Normalize(inspection, MappingProfile.ForClass(DeviceClass.AoiAvi));

        // The premise: the raw key really does carry both values.
        Assert.Contains("RECIPE-SECRET", env.IdempotencyKey, StringComparison.Ordinal);
        Assert.Contains("SN-SECRET-99", env.IdempotencyKey, StringComparison.Ordinal);

        var body = ApiTraceBody.From(env, DateTimeOffset.UtcNow);

        Assert.DoesNotContain("RECIPE-SECRET", body.Json, StringComparison.Ordinal);
        Assert.DoesNotContain("SN-SECRET-99", body.Json, StringComparison.Ordinal);
        Assert.DoesNotContain("RECIPE-SECRET", body.IdempotencyDigest, StringComparison.Ordinal);
        Assert.DoesNotContain("SN-SECRET-99", body.IdempotencyDigest, StringComparison.Ordinal);
        Assert.DoesNotContain("idempotencyKey", ApiTraceBody.AllowedKeys);

        // The digest still does its job: same reading in, same digest out; a different reading differs.
        Assert.Equal(body.IdempotencyDigest, ApiTraceBody.From(env, DateTimeOffset.UtcNow).IdempotencyDigest);
        inspection.CycleCounter = 4243;
        var other = Normalizer.Normalize(inspection, MappingProfile.ForClass(DeviceClass.AoiAvi));
        Assert.NotEqual(body.IdempotencyDigest, ApiTraceBody.From(other, DateTimeOffset.UtcNow).IdempotencyDigest);
    }

    /// <summary>🔴 THE WITNESS FOR THE BYTE CAP, and for the cap SAYING that it bit. Reddens if the cap is
    /// removed, or if truncation is ever made silent — owner item 28's finding was a surface that printed a
    /// cap's value without naming it as a cap, and a body cut without a flag is the same defect one step
    /// worse, because the result still parses as a plausible whole.</summary>
    [Fact]
    public void An_oversized_body_is_cut_at_the_cap_and_says_so()
    {
        // Drive the RENDERED (allowlisted) part over the cap, since that is what the cap applies to: a
        // long stepType is allowlisted and is therefore genuinely unbounded input.
        var reading = new DeviceReading
        {
            MachineCode = "WELD-01",
            Kind = ReadingKind.ProcessResult,
            SerialNumber = "SN-1",
            StepType = new string('x', ApiTraceBody.DefaultByteCap + 5000),
            Verdict = Verdict.Pass,
            Timestamp = DateTimeOffset.UtcNow,
        };
        var env = Normalizer.Normalize(reading, MappingProfile.ForClass(DeviceClass.Automation));

        var body = ApiTraceBody.From(env, DateTimeOffset.UtcNow);

        Assert.True(body.Truncated);
        Assert.Equal(ApiTraceBody.DefaultByteCap, body.RetainedByteCap);
        Assert.True(body.RenderedByteCount > body.RetainedByteCap);
        Assert.True(Encoding.UTF8.GetByteCount(body.Json) <= ApiTraceBody.DefaultByteCap);

        // A body this product actually emits today is nowhere near the cap, and is NOT flagged.
        var shipped = ApiTraceBody.From(RealisticProcessResult(), DateTimeOffset.UtcNow);
        Assert.False(shipped.Truncated);
    }

    /// <summary>🔴 THE WITNESS FOR THE LIFETIME. Reddens if bodies are ever stored anywhere other than the
    /// trace's own ring slot — a second collection with its own eviction is how a diagnostic buffer becomes
    /// a memory leak and an unbounded store of customer data. The rule is that a retained body lives inside
    /// the lifetime of the trace it belongs to, never one event longer.</summary>
    [Fact]
    public void A_retained_body_is_evicted_with_the_event_it_belongs_to()
    {
        var bus = new EventBus(capacity: 4);
        var env = RealisticProcessResult();

        for (var i = 0; i < 10; i++)
        {
            var at = DateTimeOffset.UtcNow.AddSeconds(i);
            bus.Publish(
                new ApiTraceEvent(at, "WELD-01", ReadingKind.ProcessResult, "POST", env.Path, 200, 5,
                    TransportMode.Demo, false, null),
                ApiTraceBody.From(env, at));
        }

        // The ring is four deep, so at most four bodies can survive no matter how many were published or
        // how large a window is requested.
        Assert.Equal(4, bus.Recent(1000).Count);
        Assert.Equal(4, bus.RecentBodies(1000).Count);

        // A slot published WITHOUT a body contributes nothing, so the body list is shorter than the event
        // list — which is why its length must never be read as an event count.
        var mixed = new EventBus(capacity: 4);
        var now = DateTimeOffset.UtcNow;
        mixed.Publish(new ApiTraceEvent(now, "A", ReadingKind.Telemetry, "POST", "/t", 200, 1, TransportMode.Demo, false, null));
        mixed.Publish(
            new ApiTraceEvent(now, "B", ReadingKind.ProcessResult, "POST", env.Path, 200, 1, TransportMode.Demo, false, null),
            ApiTraceBody.From(env, now));

        Assert.Equal(2, mixed.Recent(10).Count);
        Assert.Single(mixed.RecentBodies(10));
    }

    /// <summary>🔴 THE WITNESS FOR THE STREAM BEING UNTOUCHED. <see cref="EventBus.Traced"/> is what the
    /// WS endpoint serializes and what the WPF pane's Export button ultimately writes to disk, so it must
    /// deliver the event and nothing else even when the publisher retained a body. Reddens if the event
    /// signature is ever widened to carry one.</summary>
    [Fact]
    public void Publishing_a_body_changes_nothing_a_Traced_subscriber_receives()
    {
        var bus = new EventBus(capacity: 8);
        var env = RealisticProcessResult();
        var at = DateTimeOffset.UtcNow;
        var expected = new ApiTraceEvent(at, "WELD-01", ReadingKind.ProcessResult, "POST", env.Path, 200, 7,
            TransportMode.Demo, false, null);

        var received = new List<ApiTraceEvent>();
        bus.Traced += received.Add;

        bus.Publish(expected, ApiTraceBody.From(env, at));

        var only = Assert.Single(received);
        Assert.Equal(expected, only);

        // The delegate's own type is the contract: it carries one ApiTraceEvent, full stop.
        var invoke = typeof(Action<ApiTraceEvent>).GetMethod("Invoke")!;
        Assert.Equal(typeof(ApiTraceEvent), Assert.Single(invoke.GetParameters()).ParameterType);
    }
}
