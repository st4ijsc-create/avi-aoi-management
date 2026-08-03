using St4i.EdgeCore.Drivers.Modbus;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// 🔴 Task D-7a — <b>the read backoff's arithmetic, asserted at values that reached the boundary rather than
/// values the test chose.</b>
///
/// <para>Blueprint §8.1: <i>"a test that supplies the value it is checking is blind to who chose that
/// value."</i> D-2 shipped a retry test that passed its own number in and could not see I-2. So the tests here
/// that matter are the ones about the RELATIONSHIP between inputs — that the base is the HOLD and not the poll
/// interval, that growth is per additional failure, that both ends clamp — rather than a table of
/// input/output pairs that would pass just as well against a lookup.</para>
///
/// <para>The end-to-end effect this arithmetic exists to produce is measured on D-4's own harness, not here:
/// see <c>ModbusMultidropBusTests.TheReadBackoff_CutsADeadDevicesTaxOnItsHealthyNeighbours_…</c>, which runs
/// the SAME bus with the mechanism off and on in one process.</para>
/// </summary>
public sealed class ModbusRtuReadBackoffTests
{
    [Fact]
    public void AHealthyDevice_PollsAtItsDeclaredCadence_WhateverTheBackoffSays()
    {
        // consecutiveFailures 0 is the ONLY input that matters here: no configuration may make a device that
        // is answering poll at anything other than what its map declares.
        Assert.Equal(250, ModbusRtuReadBackoff.Default.DelayMsFor(250, worstCaseBusHoldMs: 60_000, consecutiveFailures: 0));
        Assert.Equal(250, ModbusRtuReadBackoff.Disabled.DelayMsFor(250, worstCaseBusHoldMs: 60_000, consecutiveFailures: 0));
    }

    [Fact]
    public void Disabled_NeverDelaysMoreThanTheDeclaredCadence_HoweverManyPollsHaveFailed()
    {
        // The control for every measurement in this task: "off" has to mean byte-for-byte the pre-D-7a poll
        // loop, or a before/after comparison is comparing two different mitigations.
        foreach (var failures in new[] { 1, 2, 5, 50 })
        {
            Assert.Equal(
                20,
                ModbusRtuReadBackoff.Disabled.DelayMsFor(20, worstCaseBusHoldMs: 8_000, consecutiveFailures: failures));
        }

        Assert.False(ModbusRtuReadBackoff.Disabled.IsEnabled);
        Assert.True(ModbusRtuReadBackoff.Default.IsEnabled);
    }

    /// <summary>
    /// 🔴 <b>The design decision, isolated: the base is the HOLD, not the poll interval.</b> This is the
    /// configuration the whole type exists for — a fast-cadence device with a long read timeout, which costs
    /// the bus 8 000 ms per failed poll and, under the obvious "back off from pollIntervalMs" design, would
    /// wait 100 ms before doing it again. A test that only checked "the delay grew" would pass against that
    /// design too.
    /// </summary>
    [Fact]
    public void TheFirstFailure_WaitsAWholeBusHold_NotAPollInterval()
    {
        var delay = ModbusRtuReadBackoff.Default.DelayMsFor(
            pollIntervalMs: 100, worstCaseBusHoldMs: 8_000, consecutiveFailures: 1);

        Assert.Equal(8_000, delay);

        // And the discriminating pair: the SAME failure count against a device whose hold is small stays
        // small. If the implementation had a constant floor in it, this would be the constant.
        Assert.Equal(
            300,
            ModbusRtuReadBackoff.Default.DelayMsFor(pollIntervalMs: 100, worstCaseBusHoldMs: 300, consecutiveFailures: 1));
    }

    [Fact]
    public void EachFurtherConsecutiveFailure_MultipliesTheWait()
    {
        var backoff = ModbusRtuReadBackoff.Default; // multiplier 2

        Assert.Equal(1_000, backoff.DelayMsFor(10, 1_000, 1));
        Assert.Equal(2_000, backoff.DelayMsFor(10, 1_000, 2));
        Assert.Equal(4_000, backoff.DelayMsFor(10, 1_000, 3));
        Assert.Equal(8_000, backoff.DelayMsFor(10, 1_000, 4));

        // A different multiplier really is the thing that drives it — asserted against a value this test did
        // NOT also supply as the answer, so a hard-coded doubling would fail here.
        var gentle = new ModbusRtuReadBackoff(Multiplier: 1.5, MaxIntervalMs: 60_000);
        Assert.Equal(1_000, gentle.DelayMsFor(10, 1_000, 1));
        Assert.Equal(1_500, gentle.DelayMsFor(10, 1_000, 2));
        Assert.Equal(2_250, gentle.DelayMsFor(10, 1_000, 3));
    }

    /// <summary>
    /// 🔴 <b>The ceiling, and the reason it is not merely tidiness: a device that has been dead for hours must
    /// still be retried, or a repaired one would never be noticed.</b> Asserted at a failure count far past the
    /// point where the un-clamped product overflows every integer type in the language — which is the arithmetic
    /// this type's own remarks name, and an overflowed NEGATIVE delay would make a dead device poll in a tight
    /// loop, i.e. the exact opposite of what the mechanism is for, produced by the mechanism itself.
    /// </summary>
    [Fact]
    public void TheWaitIsCapped_AndCannotOverflowIntoATightLoop()
    {
        var backoff = ModbusRtuReadBackoff.Default;

        Assert.Equal(60_000, backoff.DelayMsFor(10, 1_000, 7));

        foreach (var failures in new[] { 40, 60, 200, 10_000, int.MaxValue })
        {
            var delay = backoff.DelayMsFor(10, worstCaseBusHoldMs: 60_000, consecutiveFailures: failures);
            Assert.Equal(60_000, delay);
        }
    }

    /// <summary>A backoff may never make a device poll FASTER than its map declares — the one direction that
    /// would turn a mitigation into a new way to flood a shared line. Reachable whenever the ceiling is below
    /// the declared cadence, which a slow-cadence device (a 5-minute poll) configured with a one-minute ceiling
    /// produces immediately.</summary>
    [Fact]
    public void TheDeclaredCadenceIsAFloor_EvenWhenTheCeilingIsLower()
    {
        var backoff = ModbusRtuReadBackoff.Default; // ceiling 60 000

        Assert.Equal(300_000, backoff.DelayMsFor(pollIntervalMs: 300_000, worstCaseBusHoldMs: 1_000, consecutiveFailures: 1));
        Assert.Equal(300_000, backoff.DelayMsFor(pollIntervalMs: 300_000, worstCaseBusHoldMs: 1_000, consecutiveFailures: 30));
    }

    /// <summary>Either field on its own being meaningless disables the whole thing — stated as behaviour rather
    /// than left for a caller to discover that <c>MaxIntervalMs: 0</c> silently clamps every growth back to the
    /// poll interval anyway.</summary>
    [Theory]
    [InlineData(1.0, 60_000)]
    [InlineData(0.5, 60_000)]
    [InlineData(2.0, 0)]
    [InlineData(2.0, -1)]
    public void AMeaninglessMultiplierOrCeiling_IsTheSameAsOff(double multiplier, int maxIntervalMs)
    {
        var backoff = new ModbusRtuReadBackoff(multiplier, maxIntervalMs);

        Assert.False(backoff.IsEnabled);
        Assert.Equal(50, backoff.DelayMsFor(50, worstCaseBusHoldMs: 9_000, consecutiveFailures: 4));
    }
}
