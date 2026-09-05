using System.Text.Json;
using St4i.EngineApi.HmiModel;
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.EngineApi.Tests.HmiModel;

/// <summary>
/// Session 2 (HMI-3) — <see cref="ScreenGenerator"/>, the pure compiler from a declared component tree to
/// an editable screen document.
///
/// <para><b>WHAT THIS FILE DOES NOT MEASURE, said out loud rather than left to be discovered.</b> It does
/// NOT measure that a generated binding reads a value — it cannot: no <c>TagValueSource</c> in this
/// repository answers a composed path (see <see cref="ScreenGenerator"/>'s own doc comment, which cites the
/// file and line). That question is measured in a DIFFERENT language, by
/// <c>web/runtime-tests/screenGenerator.test.mjs</c>, which counts how many generated bindings resolve to
/// <c>undefined</c> against the real adapter. Neither file can substitute for the other, and a green run
/// here is not evidence a generated screen shows anything on a kiosk.</para>
///
/// <para>It does NOT measure the HTTP surface — <c>HmiScreenEndpointsTests</c> owns the route, including
/// the one property this generator's whole premise rests on: that generating stores nothing, so the id the
/// document names still answers 404.</para>
/// </summary>
public sealed class ScreenGeneratorTests
{
    // ─────────────────────────────────────────────────────────────────────────────────────────────
    // Fixtures. The repository's own screwdrive cell, spelled in C# rather than read off disk, so a
    // test can PERTURB one field and watch the property that depends on it move — which reading the
    // JSON would not allow without editing a shipped fixture.
    // ─────────────────────────────────────────────────────────────────────────────────────────────

    private static ComponentTagDef Tag(
        string name, string role, string dataType, IReadOnlyList<string>? enumValues = null,
        string? unit = null, double? min = null, double? max = null, string? policyAction = null) =>
        new(name, role, dataType, enumValues, unit, min, max, policyAction);

    /// <summary>The fixture's <c>st4i.motor.spindle</c> type, tag for tag — including
    /// <c>torque-target</c>, the one that carries <c>role=setpoint</c> AND a hard band AND a policy action
    /// simultaneously, which is the whole reason <c>Role</c> has to be the outer discriminator.</summary>
    private static ComponentTypeDef SpindleType() => new(
        "st4i.motor.spindle", "Trục vít / Spindle",
        new[]
        {
            Tag("running", "in", "bool"),
            Tag("state", "in", "enum", enumValues: new[] { "stopped", "running", "faulted" }),
            Tag("torque", "in", "float", unit: "Nm", min: 0, max: 20),
            Tag("torque-target", "setpoint", "float", unit: "Nm", min: 5, max: 15, policyAction: "machine.setpoint"),
            Tag("reset", "command", "bool", policyAction: "machine.command"),
        },
        new[]
        {
            new ComponentStateDef("running", "running == true", "run"),
            new ComponentStateDef("stopped", "running == false", "idle"),
        },
        "fp.motor.spindle");

    private static ComponentTypeDef TempType() => new(
        "st4i.sensor.temp", "Cảm biến nhiệt / Temperature sensor",
        new[] { Tag("value", "in", "float", unit: "°C", min: -10, max: 80) },
        new[]
        {
            new ComponentStateDef("ok", "value < 70", "run"),
            new ComponentStateDef("hot", "value >= 70", "warn"),
        },
        "fp.sensor.analog");

    private static ComponentModelDocument ScrewdriveCell() => new(
        1, "SCRW-01",
        new[]
        {
            new ComponentNode("spindle", "st4i.motor.spindle", "Trục vít chính", null, "SCRW-01/spindle"),
            new ComponentNode("ambient", "st4i.sensor.temp", "Nhiệt độ buồng máy", null, "SCRW-01/ambient"),
        },
        new[] { SpindleType(), TempType() });

    private static ScreenWidget WidgetBoundTo(HmiScreenDocument doc, string componentId, string tagName)
    {
        var binding = "{component}/" + tagName;
        return doc.Widgets.Single(w =>
            w.Component == componentId && w.Bindings is not null && w.Bindings.Values.Contains(binding));
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════════
    // 1. ROLE IS THE OUTER DISCRIMINATOR — the correction the architect made, pinned WITH the negative
    //    control that shows the pin discriminates.
    // ═════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// 🔴 THE PROPERTY THE WHOLE MAPPING RULE EXISTS FOR. <c>torque-target</c> carries
    /// <c>role=setpoint, min=5, max=15, policyAction=machine.setpoint</c>: it satisfies a "min/max ⇒
    /// gauge" rule and a "policyAction ⇒ write widget" rule at the same time. Any ordering that reads
    /// Min/Max before Role turns it into a gauge — and because
    /// <c>ContractInvariants.Validate(ComponentModelDocument)</c> REQUIRES a hard band on every setpoint
    /// (<c>ContractInvariants.cs:790-792</c>), that ordering generates no write widget for ANY valid
    /// document, ever.
    /// </summary>
    [Fact]
    public void A_setpoint_that_also_carries_a_hard_band_becomes_a_write_widget_not_a_gauge()
    {
        var doc = ScreenGenerator.Generate(ScrewdriveCell());
        var w = WidgetBoundTo(doc, "spindle", "torque-target");

        Assert.Equal("setpoint-input", w.Kind);
        Assert.Equal("machine.setpoint", w.PolicyAction);
        Assert.DoesNotContain(doc.Widgets, x => x.Kind == "gauge" && x.Component == "spindle"
            && x.Bindings is not null && x.Bindings.Values.Contains("{component}/torque-target"));
    }

    /// <summary>
    /// 🔴 NEGATIVE CONTROL for the test above, and it is the one that makes it a measurement rather than
    /// a restatement. If Role were IGNORED and Min/Max decided instead, <c>torque-target</c> and
    /// <c>torque</c> would receive the SAME kind — both carry a band, both are floats, and they differ
    /// ONLY in <c>role</c>. This asserts they differ, and names the two kinds, so a generator that
    /// collapsed the distinction fails here even if the assertion above were somehow satisfied by a
    /// constant.
    /// </summary>
    [Fact]
    public void Two_float_tags_with_bands_differing_only_in_role_receive_different_kinds()
    {
        var doc = ScreenGenerator.Generate(ScrewdriveCell());

        Assert.Equal("gauge", WidgetBoundTo(doc, "spindle", "torque").Kind);
        Assert.Equal("setpoint-input", WidgetBoundTo(doc, "spindle", "torque-target").Kind);
    }

    /// <summary>A <c>command</c> role with a bool dataType becomes a command BUTTON, not a status lamp —
    /// the same precedence, on the other write role. The bool would go to <c>status-lamp</c> were Role
    /// read second, so this arm falsifies the ordering independently of the setpoint arm above.</summary>
    [Fact]
    public void A_command_role_beats_its_bool_dataType_and_becomes_a_command_button()
    {
        var doc = ScreenGenerator.Generate(ScrewdriveCell());
        var w = WidgetBoundTo(doc, "spindle", "reset");

        Assert.Equal("command-button", w.Kind);
        Assert.Equal("machine.command", w.PolicyAction);
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════════
    // 2. THE POLICY-ACTION EXCEPTION — the two write doors disagree, and copying verbatim would build a
    //    document PUT refuses. SAFETY-RELATED, so it carries a negative control.
    // ═════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// 🔴 The component-model door requires only that a setpoint's <c>policyAction</c> be NON-EMPTY; the
    /// screen door requires MEMBERSHIP in <see cref="ContractInvariants.KnownPolicyActions"/>. So this
    /// document is LEGAL as a component model and would produce a screen document the write door answers
    /// 400 for. The generator emits the label fallback instead — and the label NAMES the action, so the
    /// engineer learns which one was not recognised rather than finding a widget missing.
    /// </summary>
    [Fact]
    public void A_setpoint_whose_policyAction_is_outside_the_screen_contracts_vocabulary_becomes_a_naming_label()
    {
        var model = new ComponentModelDocument(
            1, "ODD-01",
            new[] { new ComponentNode("c", "t", "C", null, "ODD-01/c") },
            new[]
            {
                new ComponentTypeDef("t", "T",
                    new[] { Tag("sp", "setpoint", "float", min: 0, max: 1, policyAction: "plant.override") },
                    Array.Empty<ComponentStateDef>(), "fp"),
            });

        var doc = ScreenGenerator.Generate(model);
        var w = Assert.Single(doc.Widgets);

        Assert.Equal("label", w.Kind);
        Assert.Null(w.PolicyAction);
        Assert.Contains("plant.override", w.Props!["text"].GetString()!, StringComparison.Ordinal);
        // The whole point: this document survives the door that would have refused the other one.
        Assert.Empty(ContractInvariants.Validate(doc));
    }

    /// <summary>
    /// 🔴 NEGATIVE CONTROL for the rule above — and it is the control that matters, because a generator
    /// that refused EVERY write action would satisfy the test above perfectly while emitting no write
    /// widget at all, which is exactly the failure the architect's first correction described. Both
    /// members of the frozen vocabulary must still produce a write widget carrying that action verbatim.
    /// </summary>
    [Fact]
    public void Every_member_of_the_frozen_policy_vocabulary_still_produces_a_write_widget_carrying_it_verbatim()
    {
        foreach (var action in ContractInvariants.KnownPolicyActions.OrderBy(a => a, StringComparer.Ordinal))
        {
            var role = action == "machine.setpoint" ? "setpoint" : "command";
            var model = new ComponentModelDocument(
                1, "OK-01",
                new[] { new ComponentNode("c", "t", "C", null, "OK-01/c") },
                new[]
                {
                    new ComponentTypeDef("t", "T",
                        new[] { Tag("w", role, "float", min: 0, max: 1, policyAction: action) },
                        Array.Empty<ComponentStateDef>(), "fp"),
                });

            var w = Assert.Single(ScreenGenerator.Generate(model).Widgets);
            Assert.True(ContractInvariants.WritableWidgetKinds.Contains(w.Kind),
                $"action '{action}' produced kind '{w.Kind}', which is not a write kind");
            Assert.Equal(action, w.PolicyAction);
        }
    }

    /// <summary>A write role with NO <c>policyAction</c> at all takes the same label fallback. Reachable
    /// because <see cref="ScreenGenerator.Generate"/> is public and a hand-built model need not have
    /// passed the component-model door — fail-closed, never a write widget with a null action (which
    /// §5 forbids and the screen door refuses).</summary>
    [Fact]
    public void A_write_role_with_no_policyAction_becomes_a_label_and_never_an_ungated_write_widget()
    {
        var model = new ComponentModelDocument(
            1, "BARE-01",
            new[] { new ComponentNode("c", "t", "C", null, "BARE-01/c") },
            new[]
            {
                new ComponentTypeDef("t", "T",
                    new[] { Tag("cmd", "command", "bool") },
                    Array.Empty<ComponentStateDef>(), "fp"),
            });

        var w = Assert.Single(ScreenGenerator.Generate(model).Widgets);
        Assert.Equal("label", w.Kind);
        Assert.DoesNotContain(ScreenGenerator.Generate(model).Widgets,
            x => ContractInvariants.WritableWidgetKinds.Contains(x.Kind));
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════════
    // 3. DATATYPE AGAINST WHAT THE WIDGET CAN CONSUME — named degradation over silent.
    // ═════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// 🔴 A <c>bool</c> goes to <c>status-lamp</c>, never <c>state-badge</c>. Both read
    /// <c>typeof value === "string"</c> so neither can consume a bool, and they differ ONLY in how they
    /// fail: <c>state-badge.tsx:40</c> renders <c>"—"</c> and says nothing, while
    /// <c>status-lamp.tsx:26-31</c> falls back to <c>idle</c> AND writes <c>unrecognized state "…"</c>
    /// into its visible sub-line. Named degradation over silent.
    /// </summary>
    [Fact]
    public void A_bool_takes_status_lamp_which_names_its_degradation_never_state_badge_which_is_silent()
    {
        var doc = ScreenGenerator.Generate(ScrewdriveCell());
        var w = WidgetBoundTo(doc, "spindle", "running");

        Assert.Equal("status-lamp", w.Kind);
        Assert.NotEqual("state-badge", w.Kind);
        // The binding key is `state`, which is the key both widgets read (`status-lamp.tsx:22`) — a
        // widget bound under the wrong key renders nothing at all, silently.
        Assert.Equal("{component}/running", w.Bindings!["state"]);
    }

    /// <summary>An <c>enum</c> DOES take <c>state-badge</c> — it is a string, which that widget consumes,
    /// and its raw value shown verbatim is what an arbitrary enum needs. NEGATIVE CONTROL for the bool
    /// rule above: a generator that simply never emitted <c>state-badge</c> would pass that test and fail
    /// this one.</summary>
    [Fact]
    public void An_enum_takes_state_badge_whose_verbatim_raw_value_is_what_an_arbitrary_enum_needs()
    {
        var doc = ScreenGenerator.Generate(ScrewdriveCell());
        var w = WidgetBoundTo(doc, "spindle", "state");

        Assert.Equal("state-badge", w.Kind);
        Assert.Equal("{component}/state", w.Bindings!["state"]);
    }

    /// <summary>A float WITHOUT a band cannot draw a gauge arc (<c>gauge.tsx:19</c> would fall back to a
    /// fabricated 0..100 scale), so it takes a readout, which claims no scale it was not given. The gauge
    /// arm is pinned above; this is the other side of the same branch.</summary>
    [Fact]
    public void A_float_without_a_band_takes_a_readout_rather_than_a_gauge_with_a_fabricated_scale()
    {
        var model = new ComponentModelDocument(
            1, "NB-01",
            new[] { new ComponentNode("c", "t", "C", null, "NB-01/c") },
            new[]
            {
                new ComponentTypeDef("t", "T",
                    new[] { Tag("v", "in", "float", unit: "Nm") },
                    Array.Empty<ComponentStateDef>(), "fp"),
            });

        var w = Assert.Single(ScreenGenerator.Generate(model).Widgets);
        Assert.Equal("readout", w.Kind);
        Assert.False(w.Props!.ContainsKey("min"));
        Assert.False(w.Props!.ContainsKey("max"));
    }

    /// <summary>A dataType nothing consumes becomes a label NAMING the dataType — never dropped, and
    /// never a sixteenth kind. The two assertions are different questions: that it is a label, and that
    /// the label says WHICH type was not understood.</summary>
    [Fact]
    public void A_dataType_no_widget_consumes_becomes_a_label_naming_that_dataType()
    {
        var model = new ComponentModelDocument(
            1, "UNK-01",
            new[] { new ComponentNode("c", "t", "C", null, "UNK-01/c") },
            new[]
            {
                new ComponentTypeDef("t", "T",
                    new[] { Tag("v", "in", "matrix4x4") },
                    Array.Empty<ComponentStateDef>(), "fp"),
            });

        var w = Assert.Single(ScreenGenerator.Generate(model).Widgets);
        Assert.Equal("label", w.Kind);
        Assert.Contains("matrix4x4", w.Props!["text"].GetString()!, StringComparison.Ordinal);
    }

    /// <summary>A role outside the contract's four is a label too, naming the role. Same rule, the other
    /// discriminator.</summary>
    [Fact]
    public void A_role_outside_the_contracts_four_becomes_a_label_naming_that_role()
    {
        var model = new ComponentModelDocument(
            1, "UNK-02",
            new[] { new ComponentNode("c", "t", "C", null, "UNK-02/c") },
            new[]
            {
                new ComponentTypeDef("t", "T",
                    new[] { Tag("v", "diagnostic", "float") },
                    Array.Empty<ComponentStateDef>(), "fp"),
            });

        var w = Assert.Single(ScreenGenerator.Generate(model).Widgets);
        Assert.Equal("label", w.Kind);
        Assert.Contains("diagnostic", w.Props!["text"].GetString()!, StringComparison.Ordinal);
    }

    /// <summary>🔴 THE INVARIANT UNDERNEATH ALL OF THE ABOVE: every kind this generator emits is a member
    /// of the frozen fifteen. Read from <see cref="ContractInvariants.KnownWidgetKinds"/>, which
    /// <c>SchemaEnumGuardPinTests</c> separately holds equal to the schema file — so this cannot pass by
    /// agreeing with a stale copy.</summary>
    [Fact]
    public void Every_kind_the_generator_emits_is_a_member_of_the_frozen_fifteen()
    {
        var doc = ScreenGenerator.Generate(ScrewdriveCell());
        Assert.NotEmpty(doc.Widgets);
        foreach (var w in doc.Widgets)
            Assert.Contains(w.Kind, ContractInvariants.KnownWidgetKinds);
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════════
    // 4. NO COLOUR — every tone entry is `idle`.
    // ═════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// Nothing in this repository evaluates a <see cref="ComponentStateDef.Expr"/>, so any tone other than
    /// <c>idle</c> would be a claim the generator cannot compute. The fixture's spindle type declares a
    /// <c>run</c> state and its temp type declares a <c>warn</c> state — so a generator that copied
    /// declared tones would fail here, which is what makes this a measurement and not a tautology.
    /// </summary>
    [Fact]
    public void No_tone_the_generator_emits_is_ever_anything_but_idle_because_nothing_evaluates_an_expression()
    {
        var model = ScrewdriveCell();
        // Guard the premise: the input really does declare non-idle tones for this to discriminate.
        Assert.Contains(model.Types.SelectMany(t => t.States), s => s.Tone != "idle");

        var doc = ScreenGenerator.Generate(model);
        foreach (var w in doc.Widgets)
        {
            if (w.Props is null || !w.Props.TryGetValue("tones", out var tones)) continue;
            foreach (var entry in tones.EnumerateObject())
                Assert.Equal("idle", entry.Value.GetString());
        }
        // And it really did emit a tone map, so the loop above was not vacuous.
        Assert.Contains(doc.Widgets, w => w.Props is not null && w.Props.ContainsKey("tones"));
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════════
    // 5. THEME — two entry points, two defaults.
    // ═════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>A GENERATED screen takes <c>isa101</c>. The blank-screen counterpart (<c>blueprint</c>) is
    /// pinned on the web side by <c>editorState.test.mjs</c>, in the language it lives in.</summary>
    [Fact]
    public void A_generated_screen_takes_isa101()
    {
        Assert.Equal("isa101", ScreenGenerator.Generate(ScrewdriveCell()).Theme);
        Assert.Contains("isa101", ContractInvariants.KnownThemes);
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════════
    // 6. DETERMINISM — same inputs, byte-identical output. Total orderings only.
    // ═════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>Byte-identical, compared on the SERIALISED bytes rather than on a record equality that
    /// would not see ordering inside a list at all.</summary>
    [Fact]
    public void Two_generations_from_the_same_document_are_byte_identical()
    {
        var a = JsonSerializer.Serialize(ScreenGenerator.Generate(ScrewdriveCell()), HmiContractJson.Options);
        var b = JsonSerializer.Serialize(ScreenGenerator.Generate(ScrewdriveCell()), HmiContractJson.Options);
        Assert.Equal(a, b);
    }

    /// <summary>
    /// 🔴 THE ORDERING TEST THAT ACTUALLY DISCRIMINATES. Two documents differing ONLY in the order their
    /// components and types are listed must produce byte-identical output — that is what "no dictionary
    /// iteration order, no GroupBy ordering assumption" MEANS, and the test above cannot see it because
    /// its two inputs are identical.
    /// </summary>
    [Fact]
    public void Permuting_the_declaration_order_of_components_and_types_changes_nothing_in_the_output()
    {
        var forward = ScrewdriveCell();
        var reversed = new ComponentModelDocument(
            forward.SchemaVersion, forward.MachineCode,
            forward.Components.Reverse().ToList(),
            forward.Types.Reverse().ToList());

        Assert.Equal(
            JsonSerializer.Serialize(ScreenGenerator.Generate(forward), HmiContractJson.Options),
            JsonSerializer.Serialize(ScreenGenerator.Generate(reversed), HmiContractJson.Options));
    }

    /// <summary>
    /// 🔴 NEGATIVE CONTROL for both determinism tests. A generator that emitted a CONSTANT document —
    /// ignoring its input entirely — would pass both of them. Permuting the TAG order INSIDE a type must
    /// change the output, because declaration order within a type is deliberately preserved (the author's
    /// order is information). So determinism here is "a total order", not "a fixed answer".
    /// </summary>
    [Fact]
    public void Permuting_the_tag_order_inside_a_type_DOES_change_the_output_so_determinism_is_not_a_constant()
    {
        var forward = ScrewdriveCell();
        var tagsReversed = new ComponentModelDocument(
            forward.SchemaVersion, forward.MachineCode, forward.Components,
            forward.Types
                .Select(t => new ComponentTypeDef(t.TypeId, t.Label, t.Tags.Reverse().ToList(), t.States, t.DefaultFaceplate))
                .ToList());

        Assert.NotEqual(
            JsonSerializer.Serialize(ScreenGenerator.Generate(forward), HmiContractJson.Options),
            JsonSerializer.Serialize(ScreenGenerator.Generate(tagsReversed), HmiContractJson.Options));
    }

    /// <summary>Two components sharing an id, and two types sharing a typeId, are resolved by FIRST
    /// occurrence — one deterministic answer for a document that declares the same thing twice, rather
    /// than a throw from <c>ToDictionary</c> on a read-only route.</summary>
    [Fact]
    public void Duplicate_component_ids_and_type_ids_are_resolved_by_first_occurrence_and_never_throw()
    {
        var model = new ComponentModelDocument(
            1, "DUP-01",
            new[]
            {
                new ComponentNode("c", "t", "FIRST", null, "DUP-01/c"),
                new ComponentNode("c", "t", "SECOND", null, "DUP-01/c"),
            },
            new[]
            {
                new ComponentTypeDef("t", "T1", new[] { Tag("v", "in", "string") }, Array.Empty<ComponentStateDef>(), "fp"),
                new ComponentTypeDef("t", "T2", new[] { Tag("z", "in", "string") }, Array.Empty<ComponentStateDef>(), "fp"),
            });

        var doc = ScreenGenerator.Generate(model);
        var w = Assert.Single(doc.Widgets);
        Assert.Contains("FIRST", w.Props!["label"].GetString()!, StringComparison.Ordinal);
        Assert.Equal("{component}/v", w.Bindings!["value"]);
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════════
    // 7. WIDGET IDS — unique, because the write door refuses duplicates.
    // ═════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>Two tag names that SANITISE to the same id (<c>torque_target</c> and <c>torque-target</c>
    /// both reduce to <c>torque-target</c>) are a real collision, and the write door refuses duplicate
    /// widget ids. The suffix resolves it deterministically.</summary>
    [Fact]
    public void Tag_names_that_sanitise_to_the_same_id_still_produce_unique_widget_ids()
    {
        var model = new ComponentModelDocument(
            1, "COL-01",
            new[] { new ComponentNode("c", "t", "C", null, "COL-01/c") },
            new[]
            {
                new ComponentTypeDef("t", "T",
                    new[] { Tag("torque_target", "in", "string"), Tag("torque-target", "in", "string") },
                    Array.Empty<ComponentStateDef>(), "fp"),
            });

        var doc = ScreenGenerator.Generate(model);
        Assert.Equal(2, doc.Widgets.Count);
        Assert.Equal(2, doc.Widgets.Select(w => w.Id).Distinct(StringComparer.Ordinal).Count());
        Assert.Empty(ContractInvariants.Validate(doc));
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════════
    // 8. OVERFLOW — clamp at 48 rows, and SAY how many were omitted.
    // ═════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// 🔴 NEVER A SILENT TRUNCATION. A model with far more tags than the largest legal grid holds must
    /// produce a document that (a) still validates, (b) stays inside the frozen layout ceiling, and (c)
    /// ends with a label stating HOW MANY tags were omitted. A screen that looks complete and is not is
    /// the same class of defect as a binding that renders empty with everything green.
    /// </summary>
    [Fact]
    public void An_overlong_model_clamps_at_the_frozen_ceiling_and_the_final_widget_says_how_many_were_omitted()
    {
        var overCapacity = ContractInvariants.LayoutDimensionMax * ScreenGenerator.WidgetsPerRow + 40;
        var tags = Enumerable.Range(0, overCapacity)
            .Select(i => Tag($"t{i}", "in", "string"))
            .ToList();
        var model = new ComponentModelDocument(
            1, "BIG-01",
            new[] { new ComponentNode("c", "t", "C", null, "BIG-01/c") },
            new[] { new ComponentTypeDef("t", "T", tags, Array.Empty<ComponentStateDef>(), "fp") });

        var doc = ScreenGenerator.Generate(model);

        Assert.Empty(ContractInvariants.Validate(doc));
        Assert.True(doc.Layout.Rows <= ContractInvariants.LayoutDimensionMax);
        Assert.True(doc.Layout.Cols <= ContractInvariants.LayoutDimensionMax);
        Assert.True(doc.Widgets.Count <= ContractInvariants.MaxWidgetsPerScreen);

        var last = doc.Widgets[^1];
        Assert.Equal("label", last.Kind);
        var text = last.Props!["text"].GetString()!;
        // The COUNT, not merely the word "omitted": a sentence that says "some were omitted" is not a
        // measurement and a reader cannot act on it.
        Assert.Contains("41", text, StringComparison.Ordinal);
    }

    /// <summary>🔴 NEGATIVE CONTROL for the overflow rule: an ordinary model must NOT grow an omission
    /// label. A generator that appended one unconditionally would pass the test above and be lying on
    /// every screen it produced.</summary>
    [Fact]
    public void A_model_that_fits_grows_no_omission_label()
    {
        var doc = ScreenGenerator.Generate(ScrewdriveCell());
        Assert.DoesNotContain(doc.Widgets, w =>
            w.Props is not null && w.Props.TryGetValue("text", out var t)
            && (t.GetString() ?? "").Contains("omitted", StringComparison.Ordinal));
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════════
    // 9. THE OUTPUT PASSES THE .NET WRITE DOOR — the other half is web/contract-tests/validate.mjs,
    //    against the real schema file, in the language that owns it.
    // ═════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>Zero violations from <see cref="ContractInvariants.Validate(HmiScreenDocument)"/> — the
    /// door <c>HmiScreenStore.PutAsync</c> calls as its first statement, so this is the property "a
    /// generated screen is publishable" reduces to on this side. It is NOT the property "a generated
    /// screen is schema-valid": <see cref="ContractInvariants"/> says of itself that it is not a
    /// JSON-Schema validator, and <c>screenGenerator.test.mjs</c> owns that half.</summary>
    [Fact]
    public void The_generated_document_passes_the_dotnet_write_door_with_zero_violations()
    {
        Assert.Empty(ContractInvariants.Validate(ScreenGenerator.Generate(ScrewdriveCell())));
    }

    /// <summary>An EMPTY model still produces a valid document — and one carrying a label that says the
    /// machine declared nothing, never a zero-widget document indistinguishable from a silent
    /// failure.</summary>
    [Fact]
    public void An_empty_model_yields_a_valid_screen_that_says_so_rather_than_a_zero_widget_document()
    {
        var doc = ScreenGenerator.Generate(new ComponentModelDocument(
            1, "EMPTY-01", Array.Empty<ComponentNode>(), Array.Empty<ComponentTypeDef>()));

        Assert.Empty(ContractInvariants.Validate(doc));
        var w = Assert.Single(doc.Widgets);
        Assert.Equal("label", w.Kind);
        Assert.Contains("EMPTY-01", w.Props!["text"].GetString()!, StringComparison.Ordinal);
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════════
    // 10. SCREEN ID — never the `machine-` namespace by default.
    // ═════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// 🔴 The <c>machine-</c> prefix is the browser-side convention for a machine's SHIPPED operator panel
    /// (<c>web/src/hmi-runtime/publishedScreen.ts</c>, and <c>web/src/editor/shadowedPanel.ts</c>'s entire
    /// reason for existing). The store has no DELETE, so a generated document defaulting into that
    /// namespace would arrive pre-aimed at a running machine's panel with no way back.
    /// </summary>
    [Fact]
    public void The_default_screen_id_never_lands_in_the_machine_panel_namespace()
    {
        var id = ScreenGenerator.Generate(ScrewdriveCell()).ScreenId;
        Assert.StartsWith("generated-", id, StringComparison.Ordinal);
        Assert.DoesNotContain("machine-", id, StringComparison.Ordinal);
    }

    /// <summary>Whatever the machine code's spelling, the derived id matches the frozen
    /// <c>^[a-z0-9-]+$</c> pattern the write door enforces — otherwise the engineer learns at PUBLISH,
    /// from a 400, after a whole session's work.</summary>
    [Theory]
    [InlineData("SCRW-01")]
    [InlineData("Bad_Code Name")]
    [InlineData("---")]
    [InlineData("")]
    public void The_derived_screen_id_always_matches_the_pattern_the_write_door_enforces(string machineCode)
    {
        var doc = ScreenGenerator.Generate(new ComponentModelDocument(
            1, machineCode, Array.Empty<ComponentNode>(), Array.Empty<ComponentTypeDef>()));

        Assert.Empty(ContractInvariants.Validate(doc));
        Assert.Matches(ContractInvariants.LowercaseIdPatternSource, doc.ScreenId);
    }

    /// <summary>An explicitly supplied id is honoured — the editor passes the URL's own segment, so the
    /// generated draft carries the identity the route asked for and cannot trip <c>PUT</c>'s 409
    /// route-vs-body rule.</summary>
    [Fact]
    public void An_explicitly_supplied_screen_id_is_honoured()
    {
        Assert.Equal("my-screen", ScreenGenerator.Generate(ScrewdriveCell(), "my-screen").ScreenId);
    }

    /// <summary>
    /// 🔴 REVIEW L-1 — A SUPPLIED ID IS REWRITTEN, NOT REFUSED, and that is now pinned rather than only
    /// described. <c>GenerateAsync</c>'s doc comment states this behaviour for the next reader; a
    /// documented claim with no check is the shape this programme keeps paying for, so the claim and its
    /// measurement land together.
    ///
    /// <para>Three arms, each a different consequence of the same rule: an illegal id is silently
    /// rewritten into the frozen alphabet, an id that sanitises to NOTHING falls back to the derived id
    /// rather than producing an empty contract-invalid identity, and — the control — a legal id is passed
    /// through untouched, so the rewrite is the identity function on everything the editor can actually
    /// send. Every result is asserted VALID, because the point of rewriting instead of refusing is that
    /// the proposal stays publishable.</para>
    /// </summary>
    [Theory]
    [InlineData("Bad_Id", "bad-id")]              // uppercase and an underscore — both outside the pattern
    [InlineData("  spaced  out  ", "spaced-out")] // whitespace collapses, edges trimmed
    [InlineData("--@@--", "generated-scrw-01")]   // sanitises to nothing ⇒ falls back to the DERIVED id
    [InlineData("already-legal", "already-legal")] // CONTROL: untouched
    public void A_supplied_screen_id_is_rewritten_into_the_frozen_alphabet_never_refused(
        string supplied, string expected)
    {
        var doc = ScreenGenerator.Generate(ScrewdriveCell(), supplied);

        Assert.Equal(expected, doc.ScreenId);
        // The reason a rewrite is safe here at all: whatever comes out is something the write door can
        // still accept. A rewrite that produced an invalid id would be strictly worse than a refusal.
        Assert.Empty(ContractInvariants.Validate(doc));
        Assert.Matches(ContractInvariants.LowercaseIdPatternSource, doc.ScreenId);
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════════
    // 11. THE MEASUREMENT ITSELF, ON THIS SIDE — how many bindings name a path the namespace declares.
    // ═════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// 🔴 THE RISK THIS SESSION HAD TO STATE HONESTLY, measured in a test rather than asserted in a
    /// comment. Composing each generated binding against its component's <c>tagPrefix</c> — exactly what
    /// <c>hmi-runtime/bindings.ts</c> does at render — and checking the result against the paths the
    /// repository's own tag-namespace fixture declares, 3 of 6 name nothing.
    ///
    /// <para>This asserts the number is what it is TODAY rather than that it is acceptable. The
    /// web-side counterpart (<c>screenGenerator.test.mjs</c>) measures the harder question: whether a
    /// binding RESOLVES against the real adapter, which today none of them do.</para>
    /// </summary>
    [Fact]
    public void Three_of_the_six_bindings_generated_from_the_repos_own_fixture_pair_name_no_declared_path()
    {
        // The five paths tags-screwdrive-full.json declares, spelled here so this test measures the
        // namespace's CONTENT rather than re-reading a file the generator never consults.
        var declared = new HashSet<string>(StringComparer.Ordinal)
        {
            "SCRW-01/spindle/torque",
            "SCRW-01/spindle/torque-target",
            "SCRW-01/cell/reset",
            "SCRW-01/ambient/temp",
            "SCRW-01/spindle/state",
        };

        var model = ScrewdriveCell();
        var prefixes = model.Components.ToDictionary(c => c.Id, c => c.TagPrefix, StringComparer.Ordinal);
        var doc = ScreenGenerator.Generate(model);

        var composed = doc.Widgets
            .Where(w => w.Component is not null && w.Bindings is not null)
            .SelectMany(w => w.Bindings!.Values.Select(b => b.Replace("{component}", prefixes[w.Component!], StringComparison.Ordinal)))
            .ToList();

        Assert.Equal(6, composed.Count);
        var missing = composed.Where(p => !declared.Contains(p)).OrderBy(p => p, StringComparer.Ordinal).ToList();
        Assert.Equal(
            new[] { "SCRW-01/ambient/value", "SCRW-01/spindle/reset", "SCRW-01/spindle/running" },
            missing);
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════════
    // 12. THE CROSS-LANGUAGE SEAM. The web-side measurement runs under `node --test` and cannot invoke
    //     a C# generator, so it reads a COMMITTED ARTEFACT of this generator's real output. That
    //     artefact is only worth measuring while it is still this generator's output — which is what
    //     this pins.
    // ═════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// 🔴 <c>web/runtime-tests/fixtures/generated-scrw-01.json</c> is this generator's output for
    /// <c>contracts/fixtures/valid/components-screwdrive-cell.json</c>, committed so
    /// <c>web/runtime-tests/screenGenerator.test.mjs</c> can measure a REAL generated document without
    /// booting a .NET process. A committed artefact of a generator becomes a lie the moment the generator
    /// moves, and the web test would keep reporting a stale number with every mechanical signal green —
    /// the exact defect shape this session is about. So the artefact is regenerated here and compared.
    ///
    /// <para>Compared on the DESERIALISED document, not on bytes: the file is pretty-printed for a human
    /// reader while the wire is not, so a byte comparison would measure formatting rather than content.
    /// The determinism of the CONTENT is pinned separately, on bytes, by
    /// <see cref="Two_generations_from_the_same_document_are_byte_identical"/>.</para>
    ///
    /// <para>🔴 <b>EXACTLY WHAT IS COMPARED, stated so no sentence about this test is wider than the test
    /// — review M-1's second half.</b> Document level: <see cref="HmiScreenDocument.ScreenId"/>,
    /// <see cref="HmiScreenDocument.Theme"/>, <see cref="HmiScreenDocument.Layout"/> and the widget COUNT.
    /// Per widget, in order: <see cref="ScreenWidget.Id"/>, <see cref="ScreenWidget.Kind"/>,
    /// <see cref="ScreenWidget.Rect"/>, <see cref="ScreenWidget.Component"/>,
    /// <see cref="ScreenWidget.PolicyAction"/>, <see cref="ScreenWidget.Bindings"/> and — since review
    /// M-1 — <see cref="ScreenWidget.Props"/>, canonicalised. That is every field
    /// <see cref="ScreenWidget"/> declares.</para>
    ///
    /// <para><b>NOT compared, and named rather than left to be found:</b>
    /// <see cref="HmiScreenDocument.Title"/>, <see cref="HmiScreenDocument.TitleEn"/> and
    /// <see cref="HmiScreenDocument.SchemaVersion"/>. Nothing in
    /// <c>screenGenerator.test.mjs</c> reads them, so a drift there cannot make the web-side measurement
    /// report a stale number — which is the specific failure this test exists to prevent, not "the
    /// fixture is identical in every respect". A future web assertion on the title would have to add
    /// them here, and this paragraph is where that reader is told so.</para>
    /// </summary>
    [Fact]
    public void The_committed_web_fixture_is_still_exactly_what_this_generator_produces()
    {
        var repoRoot = new DirectoryInfo(AppContext.BaseDirectory);
        while (repoRoot is not null && !File.Exists(Path.Combine(repoRoot.FullName, "St4iMachineSimulator.sln")))
            repoRoot = repoRoot.Parent;
        Assert.NotNull(repoRoot);

        var modelPath = Path.Combine(
            repoRoot!.FullName, "contracts", "fixtures", "valid", "components-screwdrive-cell.json");
        var fixturePath = Path.Combine(
            repoRoot.FullName, "web", "runtime-tests", "fixtures", "generated-scrw-01.json");
        Assert.True(File.Exists(modelPath), modelPath);
        Assert.True(File.Exists(fixturePath),
            $"{fixturePath} is missing — the web-side binding measurement reads it and cannot run without it");

        var model = JsonSerializer.Deserialize<ComponentModelDocument>(
            File.ReadAllText(modelPath), HmiContractJson.Options)!;
        var expected = ScreenGenerator.Generate(model);
        var committed = JsonSerializer.Deserialize<HmiScreenDocument>(
            File.ReadAllText(fixturePath), HmiContractJson.Options)!;

        Assert.Equal(expected.ScreenId, committed.ScreenId);
        Assert.Equal(expected.Theme, committed.Theme);
        Assert.Equal(expected.Layout, committed.Layout);
        Assert.Equal(expected.Widgets.Count, committed.Widgets.Count);
        for (var i = 0; i < expected.Widgets.Count; i++)
        {
            var e = expected.Widgets[i];
            var c = committed.Widgets[i];
            Assert.Equal(e.Id, c.Id);
            Assert.Equal(e.Kind, c.Kind);
            Assert.Equal(e.Rect, c.Rect);
            Assert.Equal(e.Component, c.Component);
            Assert.Equal(e.PolicyAction, c.PolicyAction);
            Assert.Equal(
                e.Bindings?.OrderBy(kv => kv.Key, StringComparer.Ordinal).ToList(),
                c.Bindings?.OrderBy(kv => kv.Key, StringComparer.Ordinal).ToList());

            // 🔴 REVIEW M-1 — `Props` IS COMPARED, AND ITS ABSENCE WAS THE DEFECT.
            //
            // The six fields above were the whole comparison until this round, while
            // `screenGenerator.test.mjs` asserts on `props.tones` — so a generator that dropped a `unit`,
            // moved a `min`/`max`, or stopped emitting an all-`idle` tone map would leave THIS test green
            // while the web test went on reporting from a stale committed artefact. That is precisely the
            // "a committed artefact of a generator becomes a lie the moment the generator moves" failure
            // this test's own doc comment claims to prevent, which made the doc comment the defect rather
            // than the omission.
            //
            // Compared as CANONICAL JSON — keys ordinal-sorted before serialising — for two reasons.
            // `JsonElement` has no value equality (two elements holding the same number are not `Equal`),
            // and `IReadOnlyDictionary` iteration order is not part of the value being asserted, so a
            // naive comparison would be either always-true or flaky depending on which mistake was made.
            // Sorting first means the only thing that can move this assertion is the CONTENT.
            Assert.Equal(CanonicalProps(e.Props), CanonicalProps(c.Props));
        }
    }

    /// <summary>Review M-1's helper — a stable string for a widget's <c>props</c>: keys ordinal-sorted,
    /// then serialised. <see langword="null"/> and an EMPTY map are deliberately kept distinct (<c>null</c>
    /// vs <c>{}</c>), because the contract's rule is that absence IS null and an explicitly-written empty
    /// object is a different document.</summary>
    private static string CanonicalProps(IReadOnlyDictionary<string, JsonElement>? props) =>
        props is null
            ? "(null)"
            : JsonSerializer.Serialize(
                props.OrderBy(kv => kv.Key, StringComparer.Ordinal)
                     .ToDictionary(kv => kv.Key, kv => kv.Value, StringComparer.Ordinal),
                HmiContractJson.Options);
}
