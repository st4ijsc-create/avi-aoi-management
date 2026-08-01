using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers.Modbus;
using St4i.EngineApi.Config;
using St4i.EngineApi.Fleet;
using Xunit;

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

    [Fact]
    public void ResolveEntries_emptyEntries_returnsEmpty_neverThrows()
    {
        var resolved = ConnectorsConfig.ResolveEntries(Array.Empty<ConnectorConfigEntry>(), new HashSet<string>());
        Assert.Empty(resolved);
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
