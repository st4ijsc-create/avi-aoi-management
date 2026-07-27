using St4i.EdgeCore.Uns.Sparkplug;
using Xunit;

namespace St4i.EdgeCore.Tests.Uns.Sparkplug;

/// <summary>G2-2 — <see cref="SparkplugSeqTracker"/>: monotonic 0-255 wraparound + NBIRTH reset.</summary>
public sealed class SparkplugSeqTrackerTests
{
    [Fact]
    public void Next_FirstCall_ReturnsZero()
    {
        var tracker = new SparkplugSeqTracker();

        Assert.Equal(0, tracker.Next());
    }

    [Fact]
    public void Next_SuccessiveCalls_IncrementByOne()
    {
        var tracker = new SparkplugSeqTracker();

        Assert.Equal(0, tracker.Next());
        Assert.Equal(1, tracker.Next());
        Assert.Equal(2, tracker.Next());
    }

    [Fact]
    public void Next_Wraps255BackToZero()
    {
        var tracker = new SparkplugSeqTracker();

        byte last = 0;
        for (var i = 0; i < 256; i++)
        {
            last = tracker.Next();
        }

        Assert.Equal(255, last); // the 256th call (index 255) reaches the max before wrapping
        Assert.Equal(0, tracker.Next()); // the 257th call wraps back to 0
        Assert.Equal(1, tracker.Next());
    }

    [Fact]
    public void ResetOnBirth_MakesTheNextCallReturnZeroAgain()
    {
        var tracker = new SparkplugSeqTracker();
        tracker.Next();
        tracker.Next();
        tracker.Next();

        tracker.ResetOnBirth();

        Assert.Equal(0, tracker.Next());
        Assert.Equal(1, tracker.Next());
    }
}
