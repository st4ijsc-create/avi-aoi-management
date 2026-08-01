using St4i.EdgeCore.Historian;
using Xunit;

namespace St4i.EdgeCore.Tests.Historian;

/// <summary>
/// WS-A-T5 — <see cref="OeeSettingsStore"/>: default resolution with no stored data, set-then-resolve,
/// restart-survival, the reject-not-clamp guardrail contract (an out-of-range <c>Set</c> throws
/// <see cref="ArgumentOutOfRangeException"/> BEFORE any write — the file is left byte-for-byte unchanged),
/// and a partial update (one field supplied, the other left alone on an existing entry).
/// </summary>
public sealed class OeeSettingsStoreTests : IDisposable
{
    private readonly List<string> _tempDirs = new();

    public void Dispose()
    {
        foreach (var dir in _tempDirs)
        {
            try { Directory.Delete(dir, recursive: true); } catch { /* best-effort cleanup */ }
        }
    }

    private string NewTempDir()
    {
        var dir = Directory.CreateTempSubdirectory("st4i-oee-settings-tests-").FullName;
        _tempDirs.Add(dir);
        return dir;
    }

    [Fact]
    public void Resolve_WithNoStoredData_ReturnsDefaults()
    {
        var store = new OeeSettingsStore(NewTempDir());

        var resolved = store.Resolve("M1", fallbackIdealCycleSeconds: 1.5);

        Assert.Equal("M1", resolved.MachineCode);
        Assert.Null(resolved.IdealCycleSecondsOverride);
        Assert.Equal(1.0, resolved.PlannedProductionRatio);
    }

    [Fact]
    public void Set_ThenResolve_ReturnsStoredOverrideAndRatio()
    {
        var store = new OeeSettingsStore(NewTempDir());

        store.Set("M1", idealCycleSecondsOverride: 2.0, plannedProductionRatio: 0.8);
        var resolved = store.Resolve("M1", fallbackIdealCycleSeconds: 1.5);

        Assert.Equal(2.0, resolved.IdealCycleSecondsOverride);
        Assert.Equal(0.8, resolved.PlannedProductionRatio);
    }

    [Fact]
    public void Set_SurvivesRestart_ANewStoreInstancePointedAtSameDirectorySeesIt()
    {
        var dir = NewTempDir();
        var store = new OeeSettingsStore(dir);
        store.Set("M1", idealCycleSecondsOverride: 2.0, plannedProductionRatio: 0.8);

        var reopened = new OeeSettingsStore(dir);
        var resolved = reopened.Resolve("M1", fallbackIdealCycleSeconds: 1.5);

        Assert.Equal(2.0, resolved.IdealCycleSecondsOverride);
        Assert.Equal(0.8, resolved.PlannedProductionRatio);
    }

    [Fact]
    public void Set_RatioAboveOne_ThrowsAndLeavesFileUnchanged()
    {
        var dir = NewTempDir();
        var store = new OeeSettingsStore(dir);
        store.Set("M1", idealCycleSecondsOverride: 2.0, plannedProductionRatio: 0.8);
        var filePath = Path.Combine(dir, "oee-settings.json");
        var before = File.ReadAllText(filePath);

        Assert.Throws<ArgumentOutOfRangeException>(() => store.Set("M1", null, 1.5));

        Assert.Equal(before, File.ReadAllText(filePath));
        var resolved = store.Resolve("M1", fallbackIdealCycleSeconds: 1.5);
        Assert.Equal(2.0, resolved.IdealCycleSecondsOverride);
        Assert.Equal(0.8, resolved.PlannedProductionRatio);
    }

    [Fact]
    public void Set_NegativeRatio_ThrowsAndLeavesFileUnchanged()
    {
        var dir = NewTempDir();
        var store = new OeeSettingsStore(dir);
        store.Set("M1", idealCycleSecondsOverride: 2.0, plannedProductionRatio: 0.8);
        var filePath = Path.Combine(dir, "oee-settings.json");
        var before = File.ReadAllText(filePath);

        Assert.Throws<ArgumentOutOfRangeException>(() => store.Set("M1", null, -0.1));

        Assert.Equal(before, File.ReadAllText(filePath));
        var resolved = store.Resolve("M1", fallbackIdealCycleSeconds: 1.5);
        Assert.Equal(2.0, resolved.IdealCycleSecondsOverride);
        Assert.Equal(0.8, resolved.PlannedProductionRatio);
    }

    [Fact]
    public void Set_NonPositiveIdealCycle_ThrowsAndLeavesFileUnchanged()
    {
        var dir = NewTempDir();
        var store = new OeeSettingsStore(dir);
        store.Set("M1", idealCycleSecondsOverride: 2.0, plannedProductionRatio: 0.8);
        var filePath = Path.Combine(dir, "oee-settings.json");
        var before = File.ReadAllText(filePath);

        Assert.Throws<ArgumentOutOfRangeException>(() => store.Set("M1", 0, null));

        Assert.Equal(before, File.ReadAllText(filePath));
        var resolved = store.Resolve("M1", fallbackIdealCycleSeconds: 1.5);
        Assert.Equal(2.0, resolved.IdealCycleSecondsOverride);
        Assert.Equal(0.8, resolved.PlannedProductionRatio);
    }

    [Fact]
    public void Set_GuardrailAlsoAppliesOnFirstWriteForANewMachine()
    {
        var store = new OeeSettingsStore(NewTempDir());

        Assert.Throws<ArgumentOutOfRangeException>(() => store.Set("NEW-MACHINE", null, 2.0));
        Assert.Throws<ArgumentOutOfRangeException>(() => store.Set("NEW-MACHINE", -1.0, null));

        // Neither rejected call should have created an entry.
        var resolved = store.Resolve("NEW-MACHINE", fallbackIdealCycleSeconds: 3.0);
        Assert.Null(resolved.IdealCycleSecondsOverride);
        Assert.Equal(1.0, resolved.PlannedProductionRatio);
    }

    [Fact]
    public void Set_PartialUpdate_LeavesUnspecifiedFieldUnchanged()
    {
        var store = new OeeSettingsStore(NewTempDir());
        store.Set("M1", idealCycleSecondsOverride: 2.0, plannedProductionRatio: 0.8);

        store.Set("M1", idealCycleSecondsOverride: null, plannedProductionRatio: 0.5);
        var resolved = store.Resolve("M1", fallbackIdealCycleSeconds: 1.5);

        Assert.Equal(2.0, resolved.IdealCycleSecondsOverride);
        Assert.Equal(0.5, resolved.PlannedProductionRatio);
    }

    [Fact]
    public void Set_ReturnsResolvedSettingsAfterChange()
    {
        var store = new OeeSettingsStore(NewTempDir());

        var returned = store.Set("M1", idealCycleSecondsOverride: 2.0, plannedProductionRatio: 0.8);

        Assert.Equal("M1", returned.MachineCode);
        Assert.Equal(2.0, returned.IdealCycleSecondsOverride);
        Assert.Equal(0.8, returned.PlannedProductionRatio);
    }
}
