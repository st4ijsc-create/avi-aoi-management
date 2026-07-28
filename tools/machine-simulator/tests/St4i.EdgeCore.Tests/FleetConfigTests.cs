using St4i.EdgeCore.Infrastructure;
using St4i.Connector.Abstractions.Models;
using Xunit;

public class FleetConfigTests
{
    // Locks the canonical fleet.json convention: enum VALUES (deviceClass/driverKind) are matched
    // case-insensitively against the C# enum member names, so a later task authoring fleet.json +
    // mapping presets can't silently misparse just because it picked a different casing style than
    // this loader's original author did.
    [Fact]
    public void Load_parses_mixed_enum_casing_case_insensitively()
    {
        var tmp = Path.Combine(Path.GetTempPath(), "fleet-mixed-case-" + Guid.NewGuid() + ".json");
        File.WriteAllText(tmp, """
        [
          { "code": "AOI-01", "serialSeed": "AOI", "deviceClass": "aoiAvi", "machineType": "aoi",
            "stepType": null, "driverKind": "hotFolderAoi", "recipeCode": null,
            "mappingProfile": null, "cycleSeconds": 4.0 },
          { "code": "SCRW-01", "serialSeed": "SCRW", "deviceClass": "Automation", "machineType": "screwdriver",
            "stepType": "screw_tightening", "driverKind": "Simulated", "recipeCode": "RC1",
            "mappingProfile": null, "cycleSeconds": 2.5 },
          { "code": "IOT-01", "serialSeed": "IOT", "deviceClass": "IOT", "machineType": "sensor-hub",
            "stepType": null, "driverKind": "MQTT", "recipeCode": null,
            "mappingProfile": "default", "cycleSeconds": 1.0 }
        ]
        """);
        try
        {
            var machines = FleetConfig.Load(tmp);

            Assert.Equal(3, machines.Count);

            // lowercase/camelCase entry
            Assert.Equal("AOI-01", machines[0].Code);
            Assert.Equal(DeviceClass.AoiAvi, machines[0].DeviceClass);
            Assert.Equal(DriverKinds.HotFolderAoi, machines[0].DriverKind);

            // PascalCase entry
            Assert.Equal("SCRW-01", machines[1].Code);
            Assert.Equal(DeviceClass.Automation, machines[1].DeviceClass);
            Assert.Equal(DriverKinds.Simulated, machines[1].DriverKind);

            // ALL CAPS entry
            Assert.Equal("IOT-01", machines[2].Code);
            Assert.Equal(DeviceClass.Iot, machines[2].DeviceClass);
            Assert.Equal(DriverKinds.Mqtt, machines[2].DriverKind);
        }
        finally
        {
            File.Delete(tmp);
        }
    }

    [Fact]
    public void Load_missing_file_returns_empty_list()
    {
        var path = Path.Combine(Path.GetTempPath(), "fleet-nope-" + Guid.NewGuid() + ".json");
        var result = FleetConfig.Load(path);
        Assert.Empty(result);
    }

    [Fact]
    public void Load_fileContainingLiteralJsonNull_ReturnsEmptyList_NotAnException()
    {
        // Pre-GP-3 behavior preserved: JsonSerializer.Deserialize<List<MachineDescriptor>>("null", ...)
        // returned a null list, coalesced to an empty fleet by the old single-shot call — this edge case
        // must stay byte-for-byte unchanged now that Load parses element-by-element instead.
        var tmp = Path.Combine(Path.GetTempPath(), "fleet-literal-null-" + Guid.NewGuid() + ".json");
        File.WriteAllText(tmp, "null");
        try
        {
            var result = FleetConfig.Load(tmp);
            Assert.Empty(result);
        }
        finally
        {
            File.Delete(tmp);
        }
    }

    [Fact]
    public void Load_malformed_json_throws_FleetConfigException_not_raw_JsonException()
    {
        var tmp = Path.Combine(Path.GetTempPath(), "fleet-bad-" + Guid.NewGuid() + ".json");
        File.WriteAllText(tmp, "{ this is not [ valid json");
        try
        {
            var ex = Assert.Throws<FleetConfigException>(() => FleetConfig.Load(tmp));
            Assert.Contains(tmp, ex.Message);
        }
        finally
        {
            File.Delete(tmp);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // GP-3 — casing/normalization: fleet.json's historical lowercase driverKind must still resolve to
    // the exact canonical built-in spelling (the compatibility guarantee), asserted as literal strings.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public void Load_lowercase_fleetJson_driverKind_normalizes_to_the_exact_canonical_spelling()
    {
        // The shipped fleet.json's own real-world shape: "driverKind": "simulated" (lowercase).
        var tmp = Path.Combine(Path.GetTempPath(), "fleet-lowercase-driverkind-" + Guid.NewGuid() + ".json");
        File.WriteAllText(tmp, """
        [
          { "code": "SCRW-01", "serialSeed": "SCRW", "deviceClass": "Automation", "machineType": "screwdriver",
            "stepType": "screw_tightening", "driverKind": "simulated", "recipeCode": null,
            "mappingProfile": null, "cycleSeconds": 1.0 }
        ]
        """);
        try
        {
            var machines = FleetConfig.Load(tmp);

            var machine = Assert.Single(machines);
            // Literal string assertion — this IS the compatibility guarantee: "simulated" on disk must
            // resolve to exactly "Simulated" on the wire, the same spelling the old enum's
            // JsonStringEnumConverter always produced.
            Assert.Equal("Simulated", machine.DriverKind);
        }
        finally
        {
            File.Delete(tmp);
        }
    }

    [Theory]
    [InlineData("Modbus", "Modbus")]
    [InlineData("MODBUS", "Modbus")]
    [InlineData("modbus", "Modbus")]
    [InlineData("OpcUa", "OpcUa")]
    [InlineData("OPCUA", "OpcUa")]
    [InlineData("opcua", "OpcUa")]
    public void Load_anyCasingOfABuiltIn_normalizes_to_the_canonical_spelling(string rawDriverKind, string expectedCanonical)
    {
        var tmp = Path.Combine(Path.GetTempPath(), "fleet-casing-" + Guid.NewGuid() + ".json");
        File.WriteAllText(tmp, $$"""
        [
          { "code": "M-01", "serialSeed": "M1", "deviceClass": "Automation", "machineType": "test",
            "stepType": null, "driverKind": "{{rawDriverKind}}", "recipeCode": null,
            "mappingProfile": null, "cycleSeconds": 1.0 }
        ]
        """);
        try
        {
            var machine = Assert.Single(FleetConfig.Load(tmp));
            Assert.Equal(expectedCanonical, machine.DriverKind);
        }
        finally
        {
            File.Delete(tmp);
        }
    }

    [Fact]
    public void Load_thirdPartyDriverKind_survivesByteForByte_notCaseFolded()
    {
        // GP-3's deliverable: a third-party id (recommended, not enforced, namespaced convention) is
        // opaque — never folded against the built-ins, never rejected. Two different casings of the SAME
        // third-party id must NOT collapse to one (the failure mode the brief specifically warns about).
        var tmp = Path.Combine(Path.GetTempPath(), "fleet-thirdparty-" + Guid.NewGuid() + ".json");
        File.WriteAllText(tmp, """
        [
          { "code": "WELD-VENDOR-01", "serialSeed": "W1", "deviceClass": "Automation", "machineType": "welder",
            "stepType": null, "driverKind": "vendor.acme.weld", "recipeCode": null,
            "mappingProfile": null, "cycleSeconds": 1.0 },
          { "code": "WELD-VENDOR-02", "serialSeed": "W2", "deviceClass": "Automation", "machineType": "welder",
            "stepType": null, "driverKind": "Vendor.Acme.Weld", "recipeCode": null,
            "mappingProfile": null, "cycleSeconds": 1.0 }
        ]
        """);
        try
        {
            var machines = FleetConfig.Load(tmp);

            Assert.Equal(2, machines.Count);
            Assert.Equal("vendor.acme.weld", machines[0].DriverKind);
            Assert.Equal("Vendor.Acme.Weld", machines[1].DriverKind);
            Assert.NotEqual(machines[0].DriverKind, machines[1].DriverKind);
        }
        finally
        {
            File.Delete(tmp);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // GP-3 — per-entry tolerance: one malformed MACHINE ENTRY must never destroy the whole roster.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public void Load_oneMalformedEntryAmongValidOnes_LoadsTheValidEntries_SkipsOnlyTheBadOne_WarnsNamingIt()
    {
        // "deviceClass" is still a real enum (unlike driverKind, which after this task is never a parse
        // error at all — see the brief's own note) — an unrecognized value here is exactly the shape of
        // mistake that used to throw the WHOLE FILE out as a FleetConfigException, silently swapping an
        // operator's entire fleet for the in-code demo roster.
        var tmp = Path.Combine(Path.GetTempPath(), "fleet-one-bad-entry-" + Guid.NewGuid() + ".json");
        File.WriteAllText(tmp, """
        [
          { "code": "GOOD-01", "serialSeed": "G1", "deviceClass": "Automation", "machineType": "screwdriver",
            "stepType": null, "driverKind": "Simulated", "recipeCode": null,
            "mappingProfile": null, "cycleSeconds": 1.0 },
          { "code": "BAD-01", "serialSeed": "B1", "deviceClass": "NotARealDeviceClass", "machineType": "bad",
            "stepType": null, "driverKind": "Simulated", "recipeCode": null,
            "mappingProfile": null, "cycleSeconds": 1.0 },
          { "code": "GOOD-02", "serialSeed": "G2", "deviceClass": "Iot", "machineType": "sensor",
            "stepType": null, "driverKind": "Mqtt", "recipeCode": null,
            "mappingProfile": null, "cycleSeconds": 1.0 }
        ]
        """);
        try
        {
            var warnings = new List<string>();

            var machines = FleetConfig.Load(tmp, logWarning: warnings.Add);

            // The valid entries load — the roster is NOT replaced by the in-code default (this method has
            // no concept of "the default fleet" at all; it just never throws for the whole file).
            Assert.Equal(new[] { "GOOD-01", "GOOD-02" }, machines.Select(m => m.Code));

            // The bad entry is skipped with a warning that actually names it.
            var warning = Assert.Single(warnings);
            Assert.Contains("BAD-01", warning);
        }
        finally
        {
            File.Delete(tmp);
        }
    }

    [Fact]
    public void Load_allEntriesMalformed_ReturnsEmptyList_NotAnException()
    {
        // Every entry individually malformed still isn't a FleetConfigException — the file itself parses
        // fine (it's a valid JSON array); it just has zero usable machines in it. Callers already treat an
        // empty-but-successfully-parsed result as "fall back to the default fleet" (FleetHost.LoadFleet/
        // FleetService.LoadFleet's own `if (loaded.Count > 0)` gate) — this method's own job stops at
        // "here are the valid entries, however many that is."
        var tmp = Path.Combine(Path.GetTempPath(), "fleet-all-bad-" + Guid.NewGuid() + ".json");
        File.WriteAllText(tmp, """
        [
          { "code": "BAD-01", "serialSeed": "B1", "deviceClass": "NotARealDeviceClass", "machineType": "bad",
            "stepType": null, "driverKind": "Simulated", "recipeCode": null,
            "mappingProfile": null, "cycleSeconds": 1.0 }
        ]
        """);
        try
        {
            var warnings = new List<string>();
            var machines = FleetConfig.Load(tmp, logWarning: warnings.Add);

            Assert.Empty(machines);
            Assert.Single(warnings);
        }
        finally
        {
            File.Delete(tmp);
        }
    }

    [Fact]
    public void Load_noLogWarningCallback_StillSkipsMalformedEntry_NeverThrows()
    {
        // logWarning is optional (null default) — a caller that doesn't care about per-entry diagnostics
        // must still get the tolerant behavior, just silently.
        var tmp = Path.Combine(Path.GetTempPath(), "fleet-no-callback-" + Guid.NewGuid() + ".json");
        File.WriteAllText(tmp, """
        [
          { "code": "GOOD-01", "serialSeed": "G1", "deviceClass": "Automation", "machineType": "screwdriver",
            "stepType": null, "driverKind": "Simulated", "recipeCode": null,
            "mappingProfile": null, "cycleSeconds": 1.0 },
          { "code": "BAD-01", "serialSeed": "B1", "deviceClass": "NotARealDeviceClass", "machineType": "bad",
            "stepType": null, "driverKind": "Simulated", "recipeCode": null,
            "mappingProfile": null, "cycleSeconds": 1.0 }
        ]
        """);
        try
        {
            var machines = FleetConfig.Load(tmp);
            Assert.Equal(new[] { "GOOD-01" }, machines.Select(m => m.Code));
        }
        finally
        {
            File.Delete(tmp);
        }
    }

    /// <summary>Post-Task-22 review fix: a bad fleet.json must never take down the kiosk, but
    /// <c>UnauthorizedAccessException</c> escaped <see cref="FleetConfig.Load"/> unwrapped before this
    /// fix — past <c>FleetService.LoadFleet</c>'s own <c>catch (FleetConfigException)</c>, out of the DI
    /// constructor / App.OnStartup, an unhandled startup crash. A path that is actually a DIRECTORY is
    /// the simplest portable repro: <see cref="File.Exists"/> is false for a directory (it's specifically
    /// a FILE-existence check), so without <see cref="FleetConfig.Load"/>'s explicit
    /// <see cref="Directory.Exists"/> guard this would silently fall through to the "path doesn't exist"
    /// branch and return an EMPTY fleet — masking a real config mistake — rather than raising a clear,
    /// path-carrying error; WITH that guard it takes the same "never a raw framework exception" path this
    /// whole class promises everywhere else.</summary>
    [Fact]
    public void Load_path_is_a_directory_throws_FleetConfigException_not_UnauthorizedAccessException()
    {
        var dir = Path.Combine(Path.GetTempPath(), "fleet-is-a-dir-" + Guid.NewGuid());
        Directory.CreateDirectory(dir);
        try
        {
            var ex = Assert.Throws<FleetConfigException>(() => FleetConfig.Load(dir));
            Assert.Contains(dir, ex.Message);
        }
        finally
        {
            Directory.Delete(dir);
        }
    }
}
