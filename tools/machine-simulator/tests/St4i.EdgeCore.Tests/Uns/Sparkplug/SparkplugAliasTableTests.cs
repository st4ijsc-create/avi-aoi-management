using St4i.EdgeCore.Uns.Sparkplug;
using Xunit;

namespace St4i.EdgeCore.Tests.Uns.Sparkplug;

/// <summary>G2-2 — <see cref="SparkplugAliasTable"/>: assigns a fresh sequential alias to an unseen metric
/// name, reuses the SAME alias for a name already assigned, keeps different names on different aliases,
/// and <see cref="SparkplugAliasTable.Reset"/> starts the whole table over (the G2-3 (D)BIRTH hook).</summary>
public sealed class SparkplugAliasTableTests
{
    [Fact]
    public void GetOrAssign_FirstUnseenName_AssignsAliasOne()
    {
        var table = new SparkplugAliasTable();

        Assert.Equal(1UL, table.GetOrAssign("temperature"));
    }

    [Fact]
    public void GetOrAssign_SameNameCalledAgain_ReturnsTheSameAlias()
    {
        var table = new SparkplugAliasTable();

        var first = table.GetOrAssign("temperature");
        var second = table.GetOrAssign("temperature");

        Assert.Equal(first, second);
    }

    [Fact]
    public void GetOrAssign_DifferentNames_GetDistinctSequentialAliases()
    {
        var table = new SparkplugAliasTable();

        var a = table.GetOrAssign("temperature");
        var b = table.GetOrAssign("pressure");
        var c = table.GetOrAssign("humidity");

        Assert.Equal(1UL, a);
        Assert.Equal(2UL, b);
        Assert.Equal(3UL, c);
    }

    [Fact]
    public void TryGet_UnknownName_ReturnsFalseAndDoesNotAssign()
    {
        var table = new SparkplugAliasTable();

        var found = table.TryGet("never-seen", out var alias);

        Assert.False(found);
        Assert.Equal(0UL, alias);
        // Confirms TryGet didn't itself assign an alias — the next real assignment still starts at 1.
        Assert.Equal(1UL, table.GetOrAssign("never-seen"));
    }

    [Fact]
    public void TryGet_KnownName_ReturnsTrueAndItsAssignedAlias()
    {
        var table = new SparkplugAliasTable();
        var assigned = table.GetOrAssign("temperature");

        var found = table.TryGet("temperature", out var alias);

        Assert.True(found);
        Assert.Equal(assigned, alias);
    }

    [Fact]
    public void Reset_ClearsAssignmentsAndRestartsNumberingAtOne()
    {
        var table = new SparkplugAliasTable();
        table.GetOrAssign("temperature");
        table.GetOrAssign("pressure");

        table.Reset();

        Assert.False(table.TryGet("temperature", out _));
        Assert.Equal(1UL, table.GetOrAssign("pressure")); // re-assigned fresh, starting at 1 again
    }
}
