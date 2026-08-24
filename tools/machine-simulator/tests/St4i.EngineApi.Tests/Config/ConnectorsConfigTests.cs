using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers.Modbus;
using St4i.EngineApi.Config;
using St4i.EngineApi.Fleet;
using Xunit;
using St4i.EdgeCore.Config;  // E-3: ConnectorsConfig/ConnectorConfigEntry moved down (one parser, both hosts).

namespace St4i.EngineApi.Tests.Config;

/// <summary>
/// GP-5 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-5-brief.md item 2) — unit
/// coverage for <see cref="ConnectorsConfig"/>: per-entry-tolerant parsing (mirrors
/// <c>FleetConfigTests</c>'s own "one bad entry must never destroy the whole file" coverage exactly, the
/// GP-3 lesson this class deliberately reapplies here), id/kind/settings extraction (including the
/// normalize-on-ingest + verbatim-settings-forwarding guarantees), and the env-var-vs-connectors.json
/// precedence rule (<see cref="ConnectorsConfig.ResolveEntries"/>).
/// </summary>
public sealed class ConnectorsConfigTests
{
    private static string WriteTemp(string json)
    {
        var path = Path.Combine(Path.GetTempPath(), "connectors-config-" + Guid.NewGuid() + ".json");
        File.WriteAllText(path, json);
        return path;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Absent file / compatibility.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Load_missing_file_returns_empty_list()
    {
        var path = Path.Combine(Path.GetTempPath(), "connectors-nope-" + Guid.NewGuid() + ".json");
        var result = ConnectorsConfig.Load(path);
        Assert.Empty(result);
    }

    [Fact]
    public void Load_pathIsADirectory_throwsConnectorsConfigException_notUnauthorizedAccessException()
    {
        var dir = Directory.CreateTempSubdirectory("connectors-config-dir-");
        try
        {
            var ex = Assert.Throws<ConnectorsConfigException>(() => ConnectorsConfig.Load(dir.FullName));
            Assert.Contains(dir.FullName, ex.Message);
        }
        finally
        {
            dir.Delete(recursive: true);
        }
    }

    [Fact]
    public void Load_malformed_json_throws_ConnectorsConfigException_not_raw_JsonException()
    {
        var path = WriteTemp("{ this is not [ valid json");
        try
        {
            var ex = Assert.Throws<ConnectorsConfigException>(() => ConnectorsConfig.Load(path));
            Assert.Contains(path, ex.Message);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void Load_rootIsNotAnArray_throwsConnectorsConfigException()
    {
        var path = WriteTemp("""{ "id": "modbus", "kind": "Modbus", "settings": {} }""");
        try
        {
            Assert.Throws<ConnectorsConfigException>(() => ConnectorsConfig.Load(path));
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void Load_literalJsonNull_returnsEmptyList_notAnException()
    {
        var path = WriteTemp("null");
        try
        {
            Assert.Empty(ConnectorsConfig.Load(path));
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void Load_emptyArray_returnsEmptyList()
    {
        var path = WriteTemp("[]");
        try
        {
            Assert.Empty(ConnectorsConfig.Load(path));
        }
        finally
        {
            File.Delete(path);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Valid entries — id/kind/settings extraction.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Load_validEntry_extractsIdKindAndVerbatimSettings()
    {
        var path = WriteTemp("""
        [
          { "id": "vendor.acme.widget", "kind": "vendor.acme.widget", "settings": { "host": "10.0.0.5", "port": 502 } }
        ]
        """);
        try
        {
            var entries = ConnectorsConfig.Load(path);
            var entry = Assert.Single(entries);

            Assert.Equal("vendor.acme.widget", entry.Id);
            Assert.Equal("vendor.acme.widget", entry.Kind);
            // Verbatim — the exact JSON substring, parseable back into the same shape, never re-interpreted.
            using var reparsed = System.Text.Json.JsonDocument.Parse(entry.SettingsJson);
            Assert.Equal("10.0.0.5", reparsed.RootElement.GetProperty("host").GetString());
            Assert.Equal(502, reparsed.RootElement.GetProperty("port").GetInt32());
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void Load_kindMatchingABuiltIn_normalizesToTheCanonicalSpelling()
    {
        // Same casing-tolerance rule as fleet.json's driverKind and ConnectorRegistry's own id comparisons —
        // reused here via DriverKinds.Normalize, not reinvented.
        var path = WriteTemp("""
        [
          { "id": "my-modbus", "kind": "MODBUS", "settings": {} }
        ]
        """);
        try
        {
            var entry = Assert.Single(ConnectorsConfig.Load(path));
            Assert.Equal(DriverKinds.Modbus, entry.Kind);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void Load_missingId_defaultsIdToKind()
    {
        var path = WriteTemp("""
        [
          { "kind": "Modbus", "settings": {} }
        ]
        """);
        try
        {
            var entry = Assert.Single(ConnectorsConfig.Load(path));
            Assert.Equal("Modbus", entry.Id);
        }
        finally
        {
            File.Delete(path);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // GP-3's lesson, reapplied: one malformed entry must never destroy the whole file.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Load_oneMalformedEntryAmongValidOnes_LoadsTheValidEntries_SkipsOnlyTheBadOne_WarnsNamingIt()
    {
        var path = WriteTemp("""
        [
          { "id": "good-one", "kind": "Modbus", "settings": {} },
          { "id": "bad-one", "settings": {} },
          { "id": "good-two", "kind": "OpcUa", "settings": {} }
        ]
        """);
        try
        {
            var warnings = new List<string>();
            var entries = ConnectorsConfig.Load(path, logWarning: warnings.Add);

            Assert.Equal(new[] { "good-one", "good-two" }, entries.Select(e => e.Id));

            var warning = Assert.Single(warnings);
            Assert.Contains("bad-one", warning);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void Load_entryMissingSettings_skippedWithWarning_othersStillLoad()
    {
        var path = WriteTemp("""
        [
          { "id": "no-settings", "kind": "Modbus" },
          { "id": "has-settings", "kind": "OpcUa", "settings": {} }
        ]
        """);
        try
        {
            var warnings = new List<string>();
            var entries = ConnectorsConfig.Load(path, logWarning: warnings.Add);

            Assert.Equal(new[] { "has-settings" }, entries.Select(e => e.Id));
            Assert.Contains(warnings, w => w.Contains("no-settings"));
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void Load_entryIsNotAnObject_skippedWithWarning_positionNamed()
    {
        var path = WriteTemp("""
        [
          { "id": "good-one", "kind": "Modbus", "settings": {} },
          "just a string, not an object"
        ]
        """);
        try
        {
            var warnings = new List<string>();
            var entries = ConnectorsConfig.Load(path, logWarning: warnings.Add);

            Assert.Equal(new[] { "good-one" }, entries.Select(e => e.Id));
            Assert.Contains(warnings, w => w.Contains("#2"));
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void Load_allEntriesMalformed_returnsEmptyList_notAnException()
    {
        var path = WriteTemp("""
        [
          { "id": "bad-one", "settings": {} }
        ]
        """);
        try
        {
            var warnings = new List<string>();
            var entries = ConnectorsConfig.Load(path, logWarning: warnings.Add);

            Assert.Empty(entries);
            Assert.Single(warnings);
        }
        finally
        {
            File.Delete(path);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Env-var vs connectors.json precedence (ResolveEntries) — item 2's documented precedence rule.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void ResolveEntries_noConflicts_returnsEveryEntryUnchanged()
    {
        var entries = new[]
        {
            new ConnectorConfigEntry("modbus", DriverKinds.Modbus, "{}"),
            new ConnectorConfigEntry("vendor.acme.widget", "vendor.acme.widget", "{}"),
        };

        var resolved = ConnectorsConfig.ResolveEntries(entries, new HashSet<string>());

        Assert.Equal(entries, resolved);
    }

    [Fact]
    public void ResolveEntries_kindAlreadyConfiguredByEnvVar_skipsThatEntry_logsTheConflict_envVarWins()
    {
        // The documented precedence rule: an env-var-configured kind ALWAYS wins over a connectors.json
        // entry for the SAME kind — this is what keeps "an existing install with only the four env vars
        // set behaves byte-identically" true even once that install later gains an UNRELATED
        // connectors.json (e.g. to onboard a genuinely different connector).
        var entries = new[]
        {
            new ConnectorConfigEntry("json-modbus", DriverKinds.Modbus, "{}"),
            new ConnectorConfigEntry("vendor.acme.widget", "vendor.acme.widget", "{}"),
        };
        var alreadyConfigured = new HashSet<string> { DriverKinds.Modbus };
        var warnings = new List<string>();

        var resolved = ConnectorsConfig.ResolveEntries(entries, alreadyConfigured, warnings.Add);

        Assert.Single(resolved);
        Assert.Equal("vendor.acme.widget", resolved[0].Id);

        var warning = Assert.Single(warnings);
        Assert.Contains("json-modbus", warning);
        Assert.Contains(DriverKinds.Modbus, warning);
    }

    [Fact]
    public void ResolveEntries_duplicateKindWithinConnectorsJsonItself_firstEntryWins_secondSkippedAndLogged()
    {
        // ConnectorRegistry.Register is "last write wins" per normalized kind — without this
        // de-duplication, a second connectors.json entry for the same kind would silently supersede the
        // first with no warning at all. Resolved in file order: the FIRST entry for a kind wins.
        var entries = new[]
        {
            new ConnectorConfigEntry("modbus-first", DriverKinds.Modbus, "{\"a\":1}"),
            new ConnectorConfigEntry("modbus-second", DriverKinds.Modbus, "{\"a\":2}"),
        };
        var warnings = new List<string>();

        var resolved = ConnectorsConfig.ResolveEntries(entries, new HashSet<string>(), warnings.Add);

        Assert.Single(resolved);
        Assert.Equal("modbus-first", resolved[0].Id);

        var warning = Assert.Single(warnings);
        Assert.Contains("modbus-second", warning);
        Assert.Contains("modbus-first", warning);
    }

    /// <summary>🔴 <b>WITNESS for owner item 65, direction C — 2026-08-24. Reddens by restoring the previous
    /// constant warning sentence.</b> This is the EngineApi half of the pair; the EdgeService half is
    /// <c>EdgeWorkerConnectorsTests.ADuplicateId_IsSkippedWithAWarningNamingTheIdThatCollided_NotTheKind</c>,
    /// and the two together are what item 65 means by "one file, two hosts, two answers".
    ///
    /// <para>The operator does the thing item 65 §65.2 describes: declares two Modbus-TCP connectors in one
    /// file and gives them <b>two ids of their own choosing</b>. Under this host's resolver both answer the
    /// key <c>"Modbus"</c>, so the second is dropped. The old message told them entry two "already configures
    /// this same kind" — naming a KIND at a person who had just named two IDS, which §65.4 calls the
    /// costliest species of wrongness because the product does not break, it breaks differently in two
    /// places.</para>
    ///
    /// <para>🔴 <b>What direction C does NOT change, asserted here and not merely said:</b> the resolved
    /// list. One entry survives, exactly as before — C fixes the sentence, not the behaviour, and the
    /// divergence stays open as item 65.</para></summary>
    [Fact]
    public void ResolveEntries_whenTheKeyIsTheKind_theWarningSaysSo_andNamesTheOtherHost_Item65DirectionC()
    {
        var entries = new[]
        {
            new ConnectorConfigEntry("line-a", DriverKinds.Modbus, "{\"a\":1}"),
            new ConnectorConfigEntry("line-b", DriverKinds.Modbus, "{\"a\":2}"),
        };
        var warnings = new List<string>();

        var resolved = ConnectorsConfig.ResolveEntries(
            entries, new HashSet<string>(), warnings.Add,
            registrationKeyOf: St4i.EngineApi.Config.ConnectorsJsonRegistration.RegistrationKeyOf);

        // Behaviour is untouched: the second entry is still dropped, the first still wins.
        Assert.Single(resolved);
        Assert.Equal("line-a", resolved[0].Id);

        var warning = Assert.Single(warnings);
        Assert.Contains("line-a", warning);
        Assert.Contains("line-b", warning);

        // It names the key that collided, says it was the KIND and not the id the operator chose, and says
        // the other host would have kept both.
        Assert.Contains($"registers a '{DriverKinds.Modbus}' entry under its KIND ('{DriverKinds.Modbus}')", warning, StringComparison.Ordinal);
        Assert.Contains("NOT under the `id` you gave it", warning, StringComparison.Ordinal);
        Assert.Contains("St4i.EdgeService", warning, StringComparison.Ordinal);

        // 🔴 And it declares that it has not fixed the divergence, at the place the operator reads it —
        // law (3) applied to a log line. Without this a reader could take the message for a fix report.
        Assert.Contains("item 65", warning, StringComparison.Ordinal);
        Assert.Contains("does not fix it", warning, StringComparison.Ordinal);
    }

    [Fact]
    public void ResolveEntries_emptyEntries_returnsEmpty_neverThrows()
    {
        var resolved = ConnectorsConfig.ResolveEntries(Array.Empty<ConnectorConfigEntry>(), new HashSet<string>());
        Assert.Empty(resolved);
    }

    /// <summary>
    /// 🔴 Task D-7a — <b>both rules compare on the REGISTRATION KEY, and the resolver is what supplies it.</b>
    ///
    /// <para>Two entries of one kind used to be a duplicate by definition, because both built-in arms register
    /// under the kind. A Modbus RTU BUS does not: it registers under its own instance id and fans out into N
    /// instances, so two RS-485 lines in one file are two connectors that do not conflict — and neither of them
    /// conflicts with an <c>ST4I_MODBUS_MAP</c>-configured TCP connector. Driven here with a stand-in resolver
    /// so this test says what the RULE is rather than restating the production predicate;
    /// <c>ConnectorsJsonRegistrationTests</c> drives the real one.</para>
    /// </summary>
    [Fact]
    public void ResolveEntries_withARegistrationKeyResolver_deDuplicatesOnThatKeyRatherThanTheKind()
    {
        var entries = new[]
        {
            new ConnectorConfigEntry("line1", DriverKinds.Modbus, """{"transport":"rtu-gateway"}"""),
            new ConnectorConfigEntry("line2", DriverKinds.Modbus, """{"transport":"rtu-gateway"}"""),
            new ConnectorConfigEntry("line1-again", DriverKinds.Modbus, """{"transport":"rtu-gateway"}"""),
        };
        var warnings = new List<string>();

        // The stand-in: "an entry whose settings mention a transport registers under its own id". line1 and
        // line1-again deliberately collapse onto ONE key so the de-duplication is still proved to fire.
        static string KeyOf(ConnectorConfigEntry e) =>
            e.SettingsJson.Contains("transport", StringComparison.Ordinal)
                ? e.Id.Replace("-again", string.Empty, StringComparison.Ordinal)
                : e.Kind;

        var resolved = ConnectorsConfig.ResolveEntries(entries, new HashSet<string>(), warnings.Add, KeyOf);

        Assert.Equal(new[] { "line1", "line2" }, resolved.Select(e => e.Id));
        var warning = Assert.Single(warnings);
        Assert.Contains("line1-again", warning);
    }

    /// <summary>🔴 The compatibility half of the same change: with NO resolver supplied, this method behaves
    /// byte-for-byte as it did before D-7a — which is what the three tests above already pin, and what this one
    /// states as the contract rather than leaving as a coincidence of their inputs. The env-precedence set
    /// still holds KINDS, so an entry whose key is its own id is never suppressed by an env-configured
    /// connector of the same protocol.</summary>
    [Fact]
    public void ResolveEntries_envPrecedence_comparesTheRegistrationKey_soAnInstanceKeyedEntrySurvives()
    {
        var entries = new[]
        {
            new ConnectorConfigEntry("plain-modbus", DriverKinds.Modbus, "{}"),
            new ConnectorConfigEntry("rs485-line1", DriverKinds.Modbus, """{"transport":"rtu-gateway"}"""),
        };
        var alreadyConfigured = new HashSet<string> { DriverKinds.Modbus };

        static string KeyOf(ConnectorConfigEntry e) =>
            e.SettingsJson.Contains("transport", StringComparison.Ordinal) ? e.Id : e.Kind;

        var resolved = ConnectorsConfig.ResolveEntries(entries, alreadyConfigured, logWarning: null, KeyOf);

        // The kind-keyed entry is suppressed by the env var, exactly as before. The instance-keyed one is not:
        // it is a different connector that merely shares a protocol.
        Assert.Equal(new[] { "rs485-line1" }, resolved.Select(e => e.Id));
    }

    // ─────────────────────────────────────────────────────────────────────
    // End-to-end (no ASP.NET host, no network I/O): a connectors.json entry, parsed by THIS class, feeds
    // the REAL (production) ModbusConnectorFactory/ConnectorRegistry and produces a genuinely working
    // driver — directly proving the acceptance bullet "present with a valid entry ⇒ that connector starts."
    // Mirrors exactly what Program.cs's own dispatch does for a resolved Modbus entry (see Program.cs's
    // ConnectorRegistry DI singleton lambda), just without booting a whole WebApplicationFactory for it —
    // Program.cs's OWN Modbus/OPC-UA env-var wiring has never had a dedicated end-to-end test either
    // (ModbusOptions/ModbusRegisterMap/ModbusConnectorFactory/ConnectorRegistry each have their own unit
    // coverage; this test composes them the same way this task's own connectors.json dispatch does).
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task EndToEnd_ConnectorsJsonModbusEntry_ProducesAWorkingModbusDriver_ThroughTheRealConnectorRegistry()
    {
        var path = WriteTemp("""
        [
          { "id": "line1-modbus", "kind": "Modbus", "settings":
            { "machineCode": "PLC-01", "unitId": 1, "pollIntervalMs": 1000,
              "registers": [ { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "temperature", "unit": "C" } ] } }
        ]
        """);
        try
        {
            var parsed = ConnectorsConfig.Load(path);
            var resolved = ConnectorsConfig.ResolveEntries(parsed, alreadyConfiguredKinds: new HashSet<string>());
            var entry = Assert.Single(resolved);
            Assert.Equal(DriverKinds.Modbus, entry.Kind);

            var registry = new ConnectorRegistry();
            var registered = registry.Register(new ModbusConnectorFactory(new ModbusOptions { Host = "127.0.0.1", Port = 15020 }), entry.SettingsJson);
            Assert.True(registered);
            Assert.Contains(DriverKinds.Modbus, registry.RegisteredIds);

            var ok = registry.TryCreateDriver(DriverKinds.Modbus, out var driver, out var error);
            Assert.True(ok);
            Assert.Null(error);
            Assert.NotNull(driver);
            Assert.Equal(DriverKinds.Modbus, driver!.Kind);

            await driver.DisposeAsync();
        }
        finally
        {
            File.Delete(path);
        }
    }
}
