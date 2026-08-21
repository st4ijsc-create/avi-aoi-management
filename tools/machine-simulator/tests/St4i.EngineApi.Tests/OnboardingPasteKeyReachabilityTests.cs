using St4i.EdgeCore.Infrastructure;
using St4i.EngineApi.Endpoints;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.Hubs;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// 🔴 AS-1, owner item 29. <b>EXACTLY ONE [Fact] IN THIS CLASS IS THE RED-ABLE WITNESS:</b>
/// <see cref="MismatchedCode_MessageNamesTheCodeTheEngineActuallyAuthenticatesAs"/>. Reverting
/// <see cref="OnboardingEndpoints.AnnotatePasteKeyReachability"/>'s body to <c>return result;</c> — the
/// BASE-commit behaviour — turns that one red and leaves EVERY OTHER FACT HERE GREEN, because the others
/// all assert that a message is left ALONE, which a do-nothing helper also satisfies. Saying so is the
/// point: a test green on both sides of a control measures nothing about the change, and this file would
/// be five-sixths self-congratulation if it were counted as six witnesses. The others earn their place a
/// different way, under a SECOND mutation — annotating unconditionally, i.e. deleting the equality and
/// emptiness checks — which turns <see cref="MatchingCode_MessageIsLeftExactlyAsPasteKeyWroteIt"/>,
/// <see cref="CaseDifferenceAloneIsNotAMismatch"/>, <see cref="ValidationFailure_IsLeftAlone"/> and
/// <see cref="UnknownActiveCode_SaysNothing"/> red. Both control runs were run whole and reverted; the
/// numbers are in <c>.superpowers/sdd/items-27-28-29/task-1-report.md</c>.
///
/// <b>WHAT THE ITEM GOT WRONG, AND WHY THAT DECIDED THE SHAPE OF THE FIX.</b> Item 29's headline calls
/// <c>POST /v1/onboarding/paste-key</c> "a route that returns 200 for something it does not do". Measured,
/// that is not the mechanism. <see cref="OnboardingService.PasteKey"/> calls
/// <c>CredentialStore.Save(machineCode, mkKey)</c>, which really does write a DPAPI blob under that code;
/// <c>"Pasted mk_ key stored for WELD-01"</c> is TRUE. The route does exactly what it claims. What is false
/// is what a reader concludes from it, because <c>FleetCore.UpdateSettings</c> reads
/// <c>CredentialStore.Load(_machineCode)</c> with a SINGULAR field, so any key stored under another code is
/// durable and unreachable. A 4xx would therefore have rejected a write that genuinely succeeds and would
/// have removed the one use the owner item itself names (staging a key before switching
/// <c>machineCode</c>). Correcting the sentence, not the status, is what the measurement supports.
///
/// <b>THE CEILING ON THE FIX, STATED RATHER THAN LEFT IMPLIED.</b> Four surfaces in this product paste an
/// <c>mk_</c> key. Two POST this route (<c>web/src/routes/Settings.tsx</c>, <c>Onboarding.tsx</c>'s
/// <c>PasteKeyCard</c>) and are covered. Two — <c>OnboardingViewModel.PasteKey</c> and
/// <c>SettingsViewModel</c>'s "Paste mk_" fast path, both in the WPF shell — call
/// <c>CredentialStore.Save</c> DIRECTLY and are NOT covered by anything here.
///
/// No <c>CredentialStore</c> call happens anywhere in this file: the helper is exercised at its own seam
/// (<c>internal</c> + <c>AssemblyInfo.cs</c>'s <c>InternalsVisibleTo</c>, the same seam
/// <see cref="OnboardingEndpointsResolveIsDemoTests"/> uses), so no test process can add a file to the
/// product's real credential store — see <c>tests/Shared/RealCredentialStoreLeakGuard.cs</c>.
/// </summary>
public sealed class OnboardingPasteKeyReachabilityTests
{
    private const string ActiveCode = "ENGINE-API-01";

    private static OnboardingStepResult Pasted(string? machineCode) =>
        new("Claimed", machineCode, "mk_" + new string('a', 48), false, $"Pasted mk_ key stored for {machineCode}");

    /// <summary>The whole point: a key pasted for a sub-machine no longer reads as a key the fleet will
    /// use. Both codes must appear — the one the caller asked for AND the one that actually wins — because
    /// a message that named only one of them would still leave the reader to guess which.</summary>
    [Fact]
    public void MismatchedCode_MessageNamesTheCodeTheEngineActuallyAuthenticatesAs()
    {
        var annotated = OnboardingEndpoints.AnnotatePasteKeyReachability(Pasted("WELD-01"), ActiveCode);

        Assert.StartsWith("Pasted mk_ key stored for WELD-01", annotated.Message, StringComparison.Ordinal);
        Assert.Contains(ActiveCode, annotated.Message, StringComparison.Ordinal);
        Assert.Contains("NOT the one Live/Auto will use", annotated.Message, StringComparison.Ordinal);
        Assert.Contains("WELD-01", annotated.Message, StringComparison.Ordinal);
    }

    /// <summary>The matching case is the one that was never wrong, so it must stay byte-identical — an
    /// annotation bolted onto every response would be the "ceiling stated too small" failure in reverse:
    /// noise on the branch that is already honest.</summary>
    [Fact]
    public void MatchingCode_MessageIsLeftExactlyAsPasteKeyWroteIt()
    {
        var original = Pasted(ActiveCode);

        var annotated = OnboardingEndpoints.AnnotatePasteKeyReachability(original, ActiveCode);

        Assert.Equal(original.Message, annotated.Message);
    }

    /// <summary>Machine codes are compared case-insensitively, matching <c>CredentialStore</c>'s own
    /// file-name-keyed lookup on Windows: a key pasted as <c>engine-api-01</c> IS the key
    /// <c>CredentialStore.Load("ENGINE-API-01")</c> returns, so warning about it would be a false
    /// alarm.</summary>
    [Fact]
    public void CaseDifferenceAloneIsNotAMismatch()
    {
        var original = Pasted("engine-api-01");

        var annotated = OnboardingEndpoints.AnnotatePasteKeyReachability(original, ActiveCode);

        Assert.Equal(original.Message, annotated.Message);
    }

    /// <summary>A validation failure stored nothing at all, so there is no reachability to report and the
    /// "Idle" message must not be padded with a clause about a key that does not exist.</summary>
    [Fact]
    public void ValidationFailure_IsLeftAlone()
    {
        var idle = new OnboardingStepResult("Idle", null, null, false, "Both machineCode and mkKey are required.");

        var annotated = OnboardingEndpoints.AnnotatePasteKeyReachability(idle, ActiveCode);

        Assert.Equal(idle.Message, annotated.Message);
    }

    /// <summary>🔴 The file's own rule, applied to the fix: a statement about something this layer cannot
    /// measure is not a measurement. With no active machine code to compare against, the helper says
    /// nothing rather than guessing which code wins.</summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void UnknownActiveCode_SaysNothing(string? activeCode)
    {
        var original = Pasted("WELD-01");

        var annotated = OnboardingEndpoints.AnnotatePasteKeyReachability(original, activeCode);

        Assert.Equal(original.Message, annotated.Message);
    }

    /// <summary>🔴 THIS ONE IS NOT A WITNESS — it is green on both sides of the control pair, deliberately,
    /// and it is the assertion that holds the claim "no published payload changed shape". It says the
    /// annotated result is the same record with the same four non-message members and the same
    /// <c>Step</c> the web branches on (<c>step != "Idle"</c> in both <c>Onboarding.tsx</c> and
    /// <c>Settings.tsx</c>). If a later edit turns this fix into a shape change, this fails.</summary>
    [Fact]
    public void AnnotatedResult_KeepsEveryOtherMember()
    {
        var original = Pasted("WELD-01");

        var annotated = OnboardingEndpoints.AnnotatePasteKeyReachability(original, ActiveCode);

        Assert.Equal(original.Step, annotated.Step);
        Assert.Equal("Claimed", annotated.Step);
        Assert.Equal(original.MachineCode, annotated.MachineCode);
        Assert.Equal(original.MkKey, annotated.MkKey);
        Assert.Equal(original.IsApproved, annotated.IsApproved);
    }
}

/// <summary>
/// 🔴 AS-1, owner item 28 — <b>A CEILING GUARD, NOT A WITNESS.</b> Both facts below are green on BOTH sides
/// of any control pair that leaves <see cref="InspectorStreamEndpoint.BackfillEventCount"/> at 200, so they
/// measure nothing about this task's change; they are labelled that way rather than counted as evidence,
/// following the precedent the previous task set. What they DO is stop the WS backfill cap from drifting
/// away from the two facts the API Inspector's own copy now states out loud to an operator, and from
/// exceeding the ring it reads from.
///
/// Item 28 listed three caps on API-trace history. Measured, there are FOUR:
/// <list type="number">
/// <item><c>EventBus.DefaultCapacity</c> = 500 — the engine's ring, the whole history the engine holds.</item>
/// <item><see cref="InspectorStreamEndpoint.BackfillEventCount"/> = 200 — WS on-connect replay. Until this
/// task it was a bare literal, the only one of the four with no name to point at, and it is the cap that
/// binds FIRST for anyone who just opened or reloaded the pane.</item>
/// <item><c>RING_CAPACITY</c> = 1000 in <c>web/src/lib/inspector.ts</c> — the browser tab's own ring.</item>
/// <item><c>InspectorViewModel.MaxEvents</c> (= <c>EventBus.DefaultCapacity</c>, 500) — the WPF pane's own
/// ring. This is the fourth, and item 28 does not list it.</item>
/// </list>
/// </summary>
public sealed class InspectorStreamBackfillCapTests
{
    [Fact]
    public void BackfillCount_IsTwoHundred() =>
        Assert.Equal(200, InspectorStreamEndpoint.BackfillEventCount);

    /// <summary>A backfill deeper than the ring it reads from would be a promise the ring cannot keep:
    /// <c>EventBus.Recent(n)</c> silently returns fewer than <c>n</c>, so the gap would be invisible.</summary>
    [Fact]
    public void BackfillCount_NeverExceedsTheRingItReadsFrom() =>
        Assert.True(InspectorStreamEndpoint.BackfillEventCount <= EventBus.DefaultCapacity);
}
