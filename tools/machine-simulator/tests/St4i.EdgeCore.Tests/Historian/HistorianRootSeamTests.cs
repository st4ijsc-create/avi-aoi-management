using St4i.EdgeCore.Historian;
using Xunit;

namespace St4i.EdgeCore.Tests.Historian;

/// <summary>
/// 🔴 <b>OWNER ITEM 72, the ninth leaf — the seam the owner opened on 2026-08-25 (<i>"open the seam"</i>),
/// and the reason this file exists at all is the FIRST test in it rather than the second.</b>
///
/// <para><b>What the ruling permitted and what it did not.</b> It permitted a change to <c>src/</c>: the two
/// classes that generate the <c>historian</c> leaf may read a relocation variable. It did NOT permit moving
/// the production default, and this leaf is the one where that distinction is worth the most — <c>historian</c>
/// holds the event table every reported OEE number is computed from, which is standing exemption (c). So the
/// control witness (<i>variable unset ⇒ the old path, unchanged</i>) is written FIRST and asserted against the
/// literal production path rather than against <c>DefaultRoot()</c>'s own return value, because a test that
/// compared the method to itself would stay green through a moved default.</para>
///
/// <para>🔴 <b>WHO WINS, and it is derived rather than defaulted.</b> <c>St4i.EngineApi/Program.cs</c> has read
/// <c>ST4I_HISTORIAN_DIR</c> at the composition root since WS-A-T14 and threads the value into BOTH store
/// constructors as an explicit argument. With the seam open there are three readers of one variable, so the
/// question "who wins" has to be answered rather than assumed — it is the shape item 65 had to pay for. The
/// answer is the <c>explicit path &gt; environment variable &gt; default</c> order F-1 established for all
/// sixteen machine-wide roots: <b>the composition root's explicit argument wins</b>, and the store's own env
/// read answers for every other construction site. <c>AnExplicitDirectory_BeatsTheVariable_…</c> is that
/// assertion, and it is why <c>Program.cs</c> did not have to change.</para>
///
/// <para>🔴 <b>WHAT THIS FILE DOES NOT MEASURE — law (3), stated where the result appears.</b>
/// <list type="number">
/// <item><b>It does not observe a leak, and the seam did not stop one.</b> CB-1 measured, on both
/// counterfactual branches of its own control pair, that the REAL <c>%ProgramData%\ST4I\sim</c> tree did not
/// change — no suite writes a byte there today. What item 72 buys on this leaf is a CAPABILITY closed, not a
/// leak stopped. <b>A capability is not an event</b>, and nothing here upgrades it to one.</item>
/// <item><b>It does not close the bracket's directory-mtime hole.</b> That hole belongs to
/// <c>scripts/verify-suites.sh</c>'s <c>sim_snapshot</c> (<c>find -type f</c>, which excludes directories);
/// nothing in <c>src/</c> or in this file touches it, so §72.2(i) stands exactly as written.</item>
/// <item><b>It does not prove the two stores are the only generators of this leaf.</b> That is a count over
/// <c>src/</c>, recorded in <c>docs/owner-decisions.md</c> §72.8 with its unit spelled out; this file asserts
/// only that the two it names agree with each other.</item>
/// </list></para>
///
/// <para><b>Why mutating a process-wide variable here is safe, stated rather than assumed.</b> xUnit runs
/// classes in parallel and methods within a class sequentially. The window in which this class leaves
/// <c>ST4I_HISTORIAN_DIR</c> unset contains no store construction of any kind — only pure path arithmetic —
/// and every other historian test in this assembly (<c>SqliteHistorianStoreTests</c>,
/// <c>OeeSettingsStoreTests</c>, <c>OeeAggregateSnapshotUnderConcurrentWriterTests</c>) passes an EXPLICIT
/// directory, which by the precedence above never consults the variable at all. So no concurrent test can
/// observe the window, and none can be redirected into the real install by it.</para>
/// </summary>
public sealed class HistorianRootSeamTests
{
    private static string ProductionDefault() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "historian");

    private static string NewTempDir() =>
        Directory.CreateTempSubdirectory("st4i-historian-seam-").FullName;

    /// <summary>🔴 <b>THE CONTROL, and the one that had to exist before the seam was worth having.</b> With the
    /// variable absent, both stores resolve the SAME path they resolved before item 72 touched them, spelled
    /// out here as its three literal components rather than read back from the method under test.
    ///
    /// <para>It is red-able in the direction that matters: any edit that moved the production default — a
    /// different folder, a <c>%TEMP%</c> fallback, a per-user root — fails this, and fails it for both stores
    /// independently.</para></summary>
    [Fact]
    public void WithNoVariableSet_BothStoresResolveTheUnchangedProductionDefault()
    {
        var previous = Environment.GetEnvironmentVariable(SqliteHistorianStore.EnvVarDir);
        try
        {
            Environment.SetEnvironmentVariable(SqliteHistorianStore.EnvVarDir, null);

            Assert.Equal(ProductionDefault(), SqliteHistorianStore.DefaultRoot());
            Assert.Equal(ProductionDefault(), OeeSettingsStore.DefaultRoot());
            Assert.Equal(ProductionDefault(), SqliteHistorianStore.ResolveRoot());
            Assert.Equal(ProductionDefault(), OeeSettingsStore.ResolveRoot());
        }
        finally
        {
            Environment.SetEnvironmentVariable(SqliteHistorianStore.EnvVarDir, previous);
        }
    }

    /// <summary>The seam itself, and asserted through a REAL construction rather than through the resolver
    /// alone: <c>new OeeSettingsStore()</c> with no argument — the exact call CB-1 measured the old code could
    /// not redirect — now lands where the variable points.
    ///
    /// <para><see cref="SqliteHistorianStore"/> is exercised the same way; it opens and migrates
    /// <c>historian.db</c> in its constructor, so the assertion that the file appeared under the temp root is
    /// also the assertion that the store really used it.</para></summary>
    [Fact]
    public void WithTheVariableSet_ConstructionWithNoArgument_FollowsIt()
    {
        var previous = Environment.GetEnvironmentVariable(SqliteHistorianStore.EnvVarDir);
        var target = NewTempDir();
        try
        {
            Environment.SetEnvironmentVariable(SqliteHistorianStore.EnvVarDir, target);

            Assert.Equal(target, SqliteHistorianStore.ResolveRoot());
            Assert.Equal(target, OeeSettingsStore.ResolveRoot());

            var oee = new OeeSettingsStore();
            Assert.Equal(target, oee.RootDirectory);

            _ = new SqliteHistorianStore();
            Assert.True(File.Exists(Path.Combine(target, "historian.db")),
                "SqliteHistorianStore did not open its database under the directory the variable names.");
        }
        finally
        {
            Environment.SetEnvironmentVariable(SqliteHistorianStore.EnvVarDir, previous);
        }
    }

    /// <summary>🔴 <b>The precedence assertion, and it is the one that answers "who wins".</b> An explicit
    /// directory beats a variable pointing somewhere else — which is precisely the arrangement
    /// <c>St4i.EngineApi/Program.cs</c> is in, so this is the measurement behind the claim that the
    /// composition root still decides for the shipping host and the seam only answers for everyone
    /// else.</summary>
    [Fact]
    public void AnExplicitDirectory_BeatsTheVariable_WhichIsWhyTheCompositionRootStillWins()
    {
        var previous = Environment.GetEnvironmentVariable(SqliteHistorianStore.EnvVarDir);
        var fromVariable = NewTempDir();
        var fromCaller = NewTempDir();
        try
        {
            Environment.SetEnvironmentVariable(SqliteHistorianStore.EnvVarDir, fromVariable);

            Assert.Equal(fromCaller, SqliteHistorianStore.ResolveRoot(fromCaller));
            Assert.Equal(fromCaller, OeeSettingsStore.ResolveRoot(fromCaller));
            Assert.Equal(fromCaller, new OeeSettingsStore(fromCaller).RootDirectory);
        }
        finally
        {
            Environment.SetEnvironmentVariable(SqliteHistorianStore.EnvVarDir, previous);
        }
    }

    /// <summary>ONE variable for ONE directory. The two stores share a folder by design, so a second variable
    /// would be the defect rather than the feature — this pins that they name the same literal and compute the
    /// same default, which is what lets <c>Program.cs</c> keep threading a single resolved value into
    /// both.</summary>
    [Fact]
    public void TheTwoGeneratingClasses_ShareOneVariableAndOneDefault()
    {
        Assert.Equal("ST4I_HISTORIAN_DIR", SqliteHistorianStore.EnvVarDir);
        Assert.Equal(SqliteHistorianStore.EnvVarDir, OeeSettingsStore.EnvVarDir);
        Assert.Equal(SqliteHistorianStore.DefaultRoot(), OeeSettingsStore.DefaultRoot());
    }
}
