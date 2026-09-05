using St4i.EngineApi.Auth;
using St4i.EngineApi.Policy;
using St4i.EngineApi.Policy.Rules;
using St4i.EngineApi.Safety;
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.EngineApi.Tests.Policy;

/// <summary>
/// 🔴 Session S1 (S-6) — pins <see cref="MachineWriteGate.ActionForPolicyAction"/>, the ONE translation
/// between the screen contract's <c>policyAction</c> vocabulary and this engine's action ids.
///
/// <para>Both vocabularies are reached THROUGH their owners here and never retyped:
/// <see cref="ContractInvariants.KnownPolicyActions"/> for the screen half (itself pinned two-way against
/// all three <c>contracts/*.schema.json</c> enums by <c>SchemaEnumGuardPinTests</c>) and
/// <see cref="MachineWriteGate.SetpointAction"/>/<see cref="MachineWriteGate.CommandAction"/> for the
/// engine half. A test that wrote either word down again would be a third copy of the thing this mapping
/// exists to stop being copied.</para>
///
/// <para>Four properties, per the S1 survey's acceptance condition: TOTAL over the screen vocabulary,
/// INJECTIVE ONTO exactly the two engine actions, NULL for everything else (the negative controls), and
/// every action in the image RECOGNISED by <see cref="RoleObligationRule"/> — the last being what stops
/// the mapping drifting into an action the engine default-denies for the wrong reason.</para>
/// </summary>
public sealed class MachineWriteGateActionMappingTests
{
    /// <summary>TOTAL. Every member of the frozen screen vocabulary maps to SOME engine action. This is
    /// the direction that matters: a screen action with no engine action is a control the gate can never
    /// answer for, and it would fail closed forever with no one told why. A third action added to
    /// <c>hmi-screen.schema.json</c> reddens HERE, by name, rather than in production.</summary>
    [Fact]
    public void EveryKnownScreenPolicyAction_MapsToAnEngineAction()
    {
        Assert.NotEmpty(ContractInvariants.KnownPolicyActions);

        foreach (var screenAction in ContractInvariants.KnownPolicyActions)
        {
            var engineAction = MachineWriteGate.ActionForPolicyAction(screenAction);

            Assert.False(
                string.IsNullOrWhiteSpace(engineAction),
                $"screen policyAction '{screenAction}' is in the frozen contract vocabulary but " +
                "ActionForPolicyAction has no engine action for it — the write-permissions endpoint " +
                "could never answer for a widget declaring it.");
        }
    }

    /// <summary>INJECTIVE, and its IMAGE IS EXACTLY the two <see cref="MachineWriteGate"/> consts —
    /// reached through the consts, never retyped, so renaming either one reddens this. Injectivity is
    /// asserted as "distinct inputs, distinct outputs": collapsing both screen words onto
    /// <see cref="MachineWriteGate.SetpointAction"/> would silently answer the Admin-tier command
    /// question with the Engineer-tier setpoint verdict — a permissive failure, which is precisely the
    /// direction S1 exists to prevent.</summary>
    [Fact]
    public void Image_IsExactlyTheTwoEngineActions_AndTheMappingIsInjective()
    {
        var mapped = ContractInvariants.KnownPolicyActions
            .ToDictionary(screenAction => screenAction, MachineWriteGate.ActionForPolicyAction);

        // Every value is non-null by the totality test above; asserted again here so the cast below is
        // earned rather than assumed, and so this test fails on ITS OWN terms if totality regresses.
        Assert.All(mapped, entry => Assert.NotNull(entry.Value));

        var image = mapped.Values.Select(value => value!).ToHashSet(StringComparer.Ordinal);

        Assert.Equal(
            new HashSet<string>(StringComparer.Ordinal)
            {
                MachineWriteGate.SetpointAction,
                MachineWriteGate.CommandAction,
            },
            image);

        // Injective: as many distinct outputs as distinct inputs.
        Assert.Equal(mapped.Count, image.Count);

        // And the two specific edges, named, so a SWAP (setpoint→command, command→setpoint) — which
        // preserves both the image and the cardinality above — still reddens.
        Assert.Equal(MachineWriteGate.SetpointAction, MachineWriteGate.ActionForPolicyAction("machine.setpoint"));
        Assert.Equal(MachineWriteGate.CommandAction, MachineWriteGate.ActionForPolicyAction("machine.command"));
    }

    /// <summary>NEGATIVE CONTROL. Case, whitespace, the engine's OWN words fed back in, and an unknown
    /// word all map to <see langword="null"/>.
    ///
    /// <para>The engine words are the subtle member of this list: <c>machine.command.invoke</c> is a real,
    /// recognised action id — just not a SCREEN word. Accepting it would mean a screen document could name
    /// an engine action directly, bypassing the frozen screen enum that is the only thing keeping the two
    /// vocabularies from merging by accident.</para>
    ///
    /// <para>Each case here corresponds to a mutation that would produce it: an
    /// <see cref="StringComparer.OrdinalIgnoreCase"/> dictionary (case), a <c>Trim()</c> before lookup
    /// (whitespace), a union of both vocabularies (the engine words), and a <c>default:</c> arm returning
    /// <see cref="MachineWriteGate.SetpointAction"/> (all of them at once).</para></summary>
    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\t")]
    [InlineData("MACHINE.COMMAND")]
    [InlineData("Machine.Setpoint")]
    [InlineData(" machine.command")]
    [InlineData("machine.command ")]
    [InlineData("machine.command.invoke")]
    [InlineData("machine.setpoint.write")]
    [InlineData("xyzzy")]
    [InlineData(null)]
    public void UnrecognisedPolicyAction_MapsToNull(string? policyAction)
    {
        Assert.Null(MachineWriteGate.ActionForPolicyAction(policyAction));
    }

    /// <summary>The engine's own action ids are NOT screen policy actions — stated against the consts
    /// rather than the string literals in the theory above, so renaming a const cannot leave that theory
    /// silently testing a word nothing uses any more.</summary>
    [Fact]
    public void EngineActionIds_AreNotThemselvesScreenPolicyActions()
    {
        Assert.Null(MachineWriteGate.ActionForPolicyAction(MachineWriteGate.SetpointAction));
        Assert.Null(MachineWriteGate.ActionForPolicyAction(MachineWriteGate.CommandAction));

        Assert.DoesNotContain(MachineWriteGate.SetpointAction, ContractInvariants.KnownPolicyActions);
        Assert.DoesNotContain(MachineWriteGate.CommandAction, ContractInvariants.KnownPolicyActions);
    }

    /// <summary>Every action the mapping can RETURN is an action <see cref="RoleObligationRule"/> actually
    /// recognises. Without this, the mapping could drift onto an action id the rule has no obligation for —
    /// which default-denies with <see cref="PolicyReasonCode.Unsupported"/>, i.e. the endpoint would report
    /// "not permitted" to an Admin for the WRONG REASON, and the screen would show a plausible but false
    /// explanation.</summary>
    [Fact]
    public void EveryMappedAction_IsRecognisedByRoleObligationRule()
    {
        var rule = new RoleObligationRule();

        foreach (var screenAction in ContractInvariants.KnownPolicyActions)
        {
            var engineAction = MachineWriteGate.ActionForPolicyAction(screenAction);
            Assert.NotNull(engineAction);

            var decision = rule.Evaluate(new PolicyRequest(
                engineAction!, Roles.Admin, "tester", new SafetySnapshot(EstopEngaged: false, IsRunning: false)));

            Assert.NotNull(decision);
            Assert.NotEqual(PolicyReasonCode.Unsupported, decision!.Reason);
            Assert.True(
                decision.IsPermitted,
                $"'{screenAction}' maps to engine action '{engineAction}', which RoleObligationRule does " +
                $"not permit even for {Roles.Admin} — reason {decision.Reason}: {decision.Message}");
        }
    }

    /// <summary>NEGATIVE CONTROL for the test directly above: the rule it leans on genuinely DOES return
    /// <see cref="PolicyReasonCode.Unsupported"/> for an action outside its table. Without this, an
    /// <see cref="RoleObligationRule"/> that permitted everything would make the previous test pass while
    /// measuring nothing.</summary>
    [Fact]
    public void RoleObligationRule_ReturnsUnsupported_ForAnActionOutsideItsTable()
    {
        var decision = new RoleObligationRule().Evaluate(new PolicyRequest(
            "machine.setpoint", Roles.Admin, "tester", new SafetySnapshot(EstopEngaged: false, IsRunning: false)));

        Assert.NotNull(decision);
        Assert.False(decision!.IsPermitted);
        Assert.Equal(PolicyReasonCode.Unsupported, decision.Reason);
    }
}
