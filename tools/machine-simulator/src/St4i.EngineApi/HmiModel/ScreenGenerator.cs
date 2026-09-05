using System.Text;
using System.Text.Json;
using St4i.Hmi.Contracts;

namespace St4i.EngineApi.HmiModel;

/// <summary>
/// Session 2 (HMI-3) — compiles a declared <see cref="ComponentModelDocument"/> into an
/// <see cref="HmiScreenDocument"/> an engineer can open, edit and publish, so that a machine with a
/// component model but no authored screen stops opening onto a blank canvas.
///
/// <para>Pure and static, with <see cref="TagNamespaceBuilder"/> next door as the precedent: no store, no
/// DI, no clock, no I/O. <b>It stores nothing.</b> <c>GET /v1/screens/generate?machine={code}</c> hands the
/// document back over the wire and that is the end of it — a screen nobody authored still answers 404 at
/// <c>GET /v1/screens/{id}</c>, which is <c>HmiScreenEndpoints</c>' existing ruling ("there is no such thing
/// as a valid EMPTY screen") and is not softened here. <c>ScreenGeneratorTests.Generating_a_screen_stores_
/// nothing_so_the_id_it_names_still_answers_404</c> proves it against the real engine rather than asserting
/// it.</para>
///
/// <para>═══════════════════════════════════════════════════════════════════════════════════════════</para>
/// <para>🔴 <b>THE MEASUREMENT THIS TYPE MUST NOT BE READ WITHOUT — THE BINDINGS IT WRITES MOSTLY NAME
/// PATHS THAT DO NOT EXIST.</b> This is a measurement, not a caveat, and it is stated here because a
/// generated screen renders EMPTY on a real kiosk with every mechanical signal green — the exact defect
/// shape <see cref="TagNamespaceBuilder"/>'s own doc comment takes as its lesson.</para>
///
/// <para><b>What was measured</b>, on this repository's own fixture pair
/// (<c>contracts/fixtures/valid/components-screwdrive-cell.json</c> paired with
/// <c>contracts/fixtures/valid/tags-screwdrive-full.json</c>):</para>
/// <code>
///     real tag paths declared : 5
///     bindings generated      : 6
///     naming no declared path : 3   (SCRW-01/spindle/running, SCRW-01/spindle/reset,
///                                    SCRW-01/ambient/value)
/// </code>
/// <para>Both documents are valid and integrity-clean while that is true, and the two reasons are
/// structural rather than accidental:</para>
/// <list type="number">
/// <item><description><c>ModelIntegrity.cs:133-141</c> requires <see cref="ComponentNode.TagPrefix"/> to be
/// a path-segment prefix of AT LEAST ONE declared tag path (<c>ModelIntegrity.cs:154-159</c>'s
/// <c>IsPathPrefix</c>). It does NOT require that <c>tagPrefix + "/" + tagName</c> exists. So a component
/// whose prefix matches one real tag passes integrity while every other tag its TYPE declares composes into
/// a path nothing declared.</description></item>
/// <item><description><c>web/src/hmi-runtime/TagValueSource.ts:158-182</c>'s <c>readPath</c> answers exactly
/// seven path shapes — <c>cycles</c>, <c>passRate</c>, <c>statusText</c>, <c>driftState</c>,
/// <c>keyMetric</c>, <c>code</c>, and the <c>telemetry/{name}</c> prefix. None of them is a composed
/// <c>{machine}/{component}/{tag}</c> path, so even a binding naming a path the namespace DOES declare
/// resolves to <see langword="undefined"/> against the only <c>TagValueSource</c> that exists
/// today.</description></item>
/// </list>
/// <para><b>The ruling this type follows</b>: the tag namespace is ADVISORY here, not a source of decision.
/// This generator does not consult it, does not gate on it, and makes no claim that a binding it writes
/// will read. Three things carry the honesty instead of a comment alone: this paragraph; the editor's own
/// note at the moment of generation (<c>web/src/editor/EditorRoute.tsx</c>, rendered beside the button,
/// the same way <c>TagPicker</c>'s <c>componentNote</c> already states its own limit); and
/// <c>web/runtime-tests/screenGenerator.test.mjs</c>, which generates from the fixture pair and COUNTS how
/// many bindings resolve to <see langword="undefined"/> against the real <c>createMachineDetailSource</c>.
/// That count is near-total today. It is the honest measure of the gap, and it falls on its own the day an
/// adapter that answers composed paths lands — without anyone editing the test to say so.</para>
/// <para><b>Fixing that adapter is out of scope for this session</b> and nothing here pretends
/// otherwise.</para>
/// <para>═══════════════════════════════════════════════════════════════════════════════════════════</para>
///
/// <para>── <b>MAPPING: <see cref="ComponentTagDef.Role"/> IS THE OUTER DISCRIMINATOR</b> ──────────────</para>
/// <para>Four values, first match wins: <c>setpoint</c> and <c>command</c> are decided BEFORE
/// <see cref="ComponentTagDef.DataType"/>, <see cref="ComponentTagDef.Min"/>/<see cref="ComponentTagDef.Max"/>
/// or <see cref="ComponentTagDef.EnumValues"/> are looked at at all. That order is load-bearing and was
/// measured, not chosen for tidiness: <c>torque-target</c> in this repository's own fixture carries
/// <c>role=setpoint, min=5, max=15, policyAction=machine.setpoint</c> — it satisfies a "has min/max ⇒ gauge"
/// rule and a "has policyAction ⇒ write widget" rule SIMULTANEOUSLY, and
/// <c>ContractInvariants.cs:790-792</c> makes that overlap the NORM rather than an oddity by requiring every
/// <c>setpoint</c> to carry a hard band. Any ordering that tests Min/Max first turns every setpoint into a
/// gauge, and no write widget is ever generated at all.</para>
///
/// <para>── <b>WITHIN THE READ ROLES, DATATYPE IS CHECKED AGAINST WHAT THE WIDGET CAN CONSUME</b> ─────</para>
/// <para>Which is a property of the fifteen <c>.tsx</c> files, not of the contract. Measured:
/// <c>state-badge.tsx:28</c> and <c>status-lamp.tsx:22</c> both read <c>typeof value === "string"</c>;
/// <c>gauge.tsx:25</c> reads <c>"number"</c>. The two string widgets then differ in how they FAIL: a
/// non-string reaching <c>state-badge</c> renders <c>"—"</c> and says nothing (<c>state-badge.tsx:40</c>),
/// while <c>status-lamp</c> falls back to <c>idle</c> and writes <c>unrecognized state "…"</c> into its
/// visible sub-line (<c>status-lamp.tsx:26-31</c>). <b>Named degradation is preferred over silent
/// degradation</b> wherever both are available, which is why a <c>bool</c> goes to <c>status-lamp</c> and
/// never to <c>state-badge</c>.</para>
///
/// <para>── <b>A TAG MATCHING NOTHING BECOMES A LABEL NAMING WHAT WAS NOT UNDERSTOOD</b> ──────────────</para>
/// <para>Never dropped — an engineer who declared a tag and finds it absent from the generated screen has
/// no way to tell "the generator did not understand this" from "the generator forgot". And never a
/// sixteenth kind: <see cref="ContractInvariants.KnownWidgetKinds"/> is the frozen enum and this type
/// invents nothing.</para>
///
/// <para>── <b>WRITE WIDGETS ARE EMITTED, AND THIS TYPE MAKES NO AUTHORISATION CLAIM</b> ──────────────</para>
/// <para><see cref="ComponentTagDef.PolicyAction"/> is copied VERBATIM. Session 1 already made write
/// widgets fail closed with a visible reason (<c>widgets/shared.ts</c>'s <c>policyGate</c>, against the
/// engine's own per-session verdict), so a generated <c>setpoint-input</c> is disabled until the session
/// actually holds the authority — nothing here grants anything.</para>
/// <para><b>One exception, and it exists because the two write doors disagree.</b>
/// <see cref="ContractInvariants.Validate(ComponentModelDocument)"/> requires a <c>policyAction</c> on a
/// <c>setpoint</c>/<c>command</c> tag to be merely NON-EMPTY; the screen door
/// (<see cref="ContractInvariants.Validate(HmiScreenDocument)"/>, and the frozen schema's
/// <c>$defs.widget.properties.policyAction.enum</c>) requires MEMBERSHIP in
/// <see cref="ContractInvariants.KnownPolicyActions"/>. So a component model can legally declare
/// <c>policyAction: "plant.override"</c>, and copying it verbatim into a widget would produce a document
/// <c>PUT /v1/screens/{id}</c> answers 400 for — a generator whose output the product's own write door
/// refuses. When the declared action is not a member, the label fallback is emitted instead, NAMING the
/// unrecognised action. Fail-closed, and the engineer is told which action was not recognised rather than
/// left with a widget that vanished.</para>
///
/// <para>── <b>DETERMINISM: SAME INPUTS, BYTE-IDENTICAL OUTPUT</b> ────────────────────────────────────</para>
/// <para>Total orderings only, no dictionary iteration and no <c>GroupBy</c> ordering assumption.
/// Components are sorted by <see cref="ComponentNode.Id"/> with <see cref="StringComparer.Ordinal"/> (a
/// total order over distinct ids, and duplicates are resolved by FIRST OCCURRENCE before the sort, so even
/// a document with two nodes sharing an id has one deterministic answer). Within a component, tags are
/// taken in the DECLARATION ORDER of its type — the author's own order, which is information — with
/// duplicate tag names again resolved by first occurrence. Types are matched by a first-occurrence lookup
/// over <see cref="ComponentModelDocument.Types"/> for the same reason. Pinned by
/// <c>ScreenGeneratorTests.Two_generations_from_the_same_document_are_byte_identical</c> and by the
/// permuted-input control beside it.</para>
///
/// <para>── <b>LAYOUT GROWS, CLAMPS AT 48, AND SAYS SO RATHER THAN TRUNCATING</b> ─────────────────────</para>
/// <para>Rows grow to fit; <see cref="ContractInvariants.LayoutDimensionMax"/> is the ceiling the frozen
/// schema sets for both dimensions, so it is DERIVED from that constant rather than typed. When the content
/// cannot fit inside the largest legal grid, generation stops at the last widget that fits and emits a
/// FINAL LABEL saying how many tags were omitted. Silent truncation would produce a screen that looks
/// complete and is not — the same class of defect as a binding that renders empty with everything
/// green.</para>
///
/// <para>── <b>THEME <c>isa101</c>, AND NO COLOUR AT ALL</b> ──────────────────────────────────────────</para>
/// <para>A GENERATED screen takes <c>isa101</c>; <c>createBlankScreen</c> (the editor's other entry point)
/// keeps <c>blueprint</c>. Two entry points, two defaults, each with its own reason — and
/// <c>editorState.test.mjs</c> pins the blank screen's theme so this decision cannot leak sideways.
/// <b>Every tone entry emitted is <c>idle</c></b>: <see cref="ComponentStateDef.Expr"/> is an expression
/// language nothing in this repository evaluates, so any other tone would be a claim this type cannot
/// compute. ISA-101 reserves colour for the abnormal case; an uncomputed "abnormal" is not one.</para>
///
/// <para>── <b>WHY THE DEFAULT SCREEN ID IS NOT <c>machine-{code}</c></b> ─────────────────────────────</para>
/// <para>That namespace is the browser-side convention for a machine's SHIPPED operator panel
/// (<c>web/src/hmi-runtime/publishedScreen.ts</c>, and <c>web/src/editor/shadowedPanel.ts</c>'s whole
/// reason for existing). A generated document defaulting into it would arrive pre-aimed at a running
/// machine's panel, and the store has no DELETE. The default is <c>generated-{code}</c>; a caller that
/// genuinely wants another id passes one.</para>
/// </summary>
public static class ScreenGenerator
{
    /// <summary>The theme a GENERATED screen takes. <c>createBlankScreen</c>'s <c>blueprint</c> is the
    /// other entry point's default and is deliberately different — see the type's doc comment.</summary>
    public const string GeneratedTheme = "isa101";

    /// <summary>The breakpoint a generated screen declares. <c>panel</c> is the kiosk breakpoint and the
    /// one every shipped screen in this repository uses.</summary>
    public const string GeneratedBreakpoint = "panel";

    /// <summary>Columns in the generated grid. Twelve, matching <c>createBlankScreen</c> and every shipped
    /// document, so a generated screen and a hand-started one place widgets on the same lattice.</summary>
    public const int GridCols = 12;

    /// <summary>Grid columns one widget spans. Three across twelve gives four widgets per row.</summary>
    public const int WidgetColSpan = 3;

    /// <summary>Grid rows one widget spans.</summary>
    public const int WidgetRowSpan = 1;

    /// <summary>Widgets placed per row — derived from the two spans above rather than typed, so a change to
    /// either cannot leave this number stale.</summary>
    public const int WidgetsPerRow = GridCols / WidgetColSpan;

    /// <summary>Screen-id prefix for a generated document. NOT <c>machine-</c>: that namespace shadows a
    /// machine's shipped operator panel — see the type's doc comment.</summary>
    public const string GeneratedScreenIdPrefix = "generated-";

    /// <summary>
    /// Generates a screen for <paramref name="model"/>. Pure: no store, no clock, no I/O, and nothing is
    /// persisted — see the type's doc comment on why <c>GET /v1/screens/{id}</c> must still answer 404 for
    /// the id this document names.
    /// </summary>
    /// <param name="model">The declared component tree. A model with no components yields a screen with a
    /// single explanatory label rather than a zero-widget document, because a zero-widget screen is
    /// indistinguishable from a generator that silently failed.</param>
    /// <param name="screenId">The id the document declares. <see langword="null"/>/blank derives
    /// <c>generated-{machineCode}</c>, lowercased and reduced to the frozen
    /// <c>^[a-z0-9-]+$</c> alphabet so the write door can accept it.</param>
    public static HmiScreenDocument Generate(ComponentModelDocument model, string? screenId = null)
    {
        ArgumentNullException.ThrowIfNull(model);

        var machineCode = model.MachineCode ?? string.Empty;
        // 🔴 REVIEW L-1 FOUND A REAL DEFECT HERE, and it is recorded rather than quietly patched.
        //
        // This read `IsNullOrWhiteSpace(screenId) ? DefaultScreenId(...) : SanitiseId(screenId)`, which is
        // wrong for a supplied id that sanitises to NOTHING (`"--@@--"`, `"###"`): `SanitiseId` returns
        // `""`, and this method then produced a document with `screenId: ""` — which
        // `ContractInvariants.Validate` REFUSES ("screenId: thiếu trường bắt buộc"). So the read-only
        // generate route would have answered 200 with a document its own product's write door rejects,
        // and the caller would learn only at publish. The three-line doc-comment version of this rule was
        // written before the check that would have caught it; writing the check is what found it.
        //
        // A blank or absent id derives; a supplied id that survives sanitisation is honoured; a supplied
        // id that sanitises away falls back to the derived id, because an EMPTY identity is strictly worse
        // than an unexpected one — the unexpected one is still publishable, and the route writes nothing
        // either way. Pinned, with the legal-id control beside it, by
        // `ScreenGeneratorTests.A_supplied_screen_id_is_rewritten_into_the_frozen_alphabet_never_refused`.
        var supplied = string.IsNullOrWhiteSpace(screenId) ? string.Empty : SanitiseId(screenId);
        var id = supplied.Length > 0 ? supplied : DefaultScreenId(machineCode);

        var widgets = new List<ScreenWidget>();
        var usedIds = new HashSet<string>(StringComparer.Ordinal);

        // FIRST-OCCURRENCE type lookup, built by hand rather than with ToDictionary: a document may
        // legally declare two types with the same typeId (nothing rejects it), and ToDictionary would
        // THROW on the second. Throwing on a read-only generate route would turn a merely odd document
        // into a 500.
        var typesById = new Dictionary<string, ComponentTypeDef>(StringComparer.Ordinal);
        foreach (var type in model.Types ?? Array.Empty<ComponentTypeDef>())
        {
            if (type is null || string.IsNullOrWhiteSpace(type.TypeId)) continue;
            if (!typesById.ContainsKey(type.TypeId)) typesById[type.TypeId] = type;
        }

        // Duplicate component ids resolved by FIRST occurrence, THEN ordinal-sorted — a total order over
        // what is left, so the same document always produces the same sequence regardless of how the
        // JSON happened to be ordered. `OrderBy` is documented-stable in .NET, but the de-duplication
        // above means it never has to be: the keys are distinct.
        var seenComponentIds = new HashSet<string>(StringComparer.Ordinal);
        var components = new List<ComponentNode>();
        foreach (var node in model.Components ?? Array.Empty<ComponentNode>())
        {
            if (node is null || string.IsNullOrWhiteSpace(node.Id)) continue;
            if (seenComponentIds.Add(node.Id)) components.Add(node);
        }
        components.Sort((a, b) => string.CompareOrdinal(a.Id, b.Id));

        // The ceiling is DERIVED from the frozen schema's own layout maximum, not typed: 48 rows of
        // WidgetsPerRow. One slot is held back unconditionally for the omission label, so the "N omitted"
        // sentence can always be placed — a truncation notice that itself gets truncated is worse than
        // no notice.
        var capacity = ContractInvariants.LayoutDimensionMax * WidgetsPerRow;
        var budget = capacity - 1;
        var omitted = 0;

        foreach (var node in components)
        {
            if (!typesById.TryGetValue(node.TypeId ?? string.Empty, out var type))
            {
                // A component naming a type the document does not declare is not dropped. It is the
                // clearest possible authoring mistake and the label says exactly that.
                if (widgets.Count < budget)
                {
                    widgets.Add(LabelWidget(
                        usedIds, node.Id, "type",
                        $"{node.Label ?? node.Id}: kiểu linh kiện '{node.TypeId}' không được khai trong tài liệu này " +
                        $"/ component type '{node.TypeId}' is not declared in this document"));
                }
                else omitted++;
                continue;
            }

            // DECLARATION ORDER within the type — the author's own order carries information a sort would
            // destroy. Duplicate tag NAMES resolved by first occurrence for the same reason component ids
            // are: one deterministic answer for a document that declares the same thing twice.
            var seenTagNames = new HashSet<string>(StringComparer.Ordinal);
            foreach (var tag in type.Tags ?? Array.Empty<ComponentTagDef>())
            {
                if (tag is null || string.IsNullOrWhiteSpace(tag.Name)) continue;
                if (!seenTagNames.Add(tag.Name)) continue;

                if (widgets.Count >= budget) { omitted++; continue; }
                widgets.Add(WidgetFor(usedIds, node, tag));
            }
        }

        if (widgets.Count == 0 && omitted == 0)
        {
            // §5-bis's shape: "this machine has declared nothing" is a real product state. But a
            // zero-widget screen is indistinguishable from a generator that silently failed, so the state
            // is NAMED on the canvas instead of implied by emptiness.
            widgets.Add(LabelWidget(
                usedIds, "empty", "model",
                $"Máy {machineCode} chưa khai linh kiện nào, nên chưa sinh được widget nào " +
                $"/ machine {machineCode} declares no components, so no widget could be generated"));
        }

        if (omitted > 0)
        {
            // NEVER a silent truncation. The count is the whole point of the sentence.
            widgets.Add(LabelWidget(
                usedIds, "omitted", "overflow",
                $"{omitted} tag không đặt được: màn hình đã đầy lưới lớn nhất hợp đồng cho phép " +
                $"({ContractInvariants.LayoutDimensionMax}×{ContractInvariants.LayoutDimensionMax}) " +
                $"/ {omitted} tag(s) omitted: the screen filled the largest grid the contract allows"));
        }

        // Placement is positional and therefore deterministic by construction — index i lands at
        // (i % WidgetsPerRow, i / WidgetsPerRow) with no lookup and no state.
        var placed = new List<ScreenWidget>(widgets.Count);
        for (var i = 0; i < widgets.Count; i++)
        {
            var rect = new WidgetRect(
                (i % WidgetsPerRow) * WidgetColSpan,
                i / WidgetsPerRow,
                WidgetColSpan,
                WidgetRowSpan);
            placed.Add(widgets[i] with { Rect = rect });
        }

        var rows = Math.Clamp(
            (placed.Count + WidgetsPerRow - 1) / WidgetsPerRow,
            ContractInvariants.LayoutDimensionMin,
            ContractInvariants.LayoutDimensionMax);

        return new HmiScreenDocument(
            ContractInvariants.SchemaVersionConst,
            id,
            $"{machineCode} — sinh tự động",
            $"{machineCode} — generated",
            GeneratedTheme,
            new ScreenLayout(GridCols, rows, GeneratedBreakpoint),
            placed);
    }

    /// <summary>
    /// The one mapping decision, with <see cref="ComponentTagDef.Role"/> as the OUTER discriminator and
    /// first match winning. See the type's doc comment for the measurement that forced this order.
    /// </summary>
    private static ScreenWidget WidgetFor(HashSet<string> usedIds, ComponentNode node, ComponentTagDef tag)
    {
        var role = tag.Role ?? string.Empty;
        var binding = "{component}/" + tag.Name;
        var label = $"{node.Label ?? node.Id} · {tag.Name}";

        switch (role)
        {
            // ── WRITE ROLES, DECIDED FIRST ────────────────────────────────────────────────────────
            case "setpoint":
            case "command":
            {
                // The screen door checks MEMBERSHIP where the component-model door checked only
                // non-empty — see the type's doc comment. Copying an unrecognised action verbatim would
                // build a document PUT answers 400 for, so the label fallback is emitted instead and it
                // NAMES the action that was not recognised.
                var action = tag.PolicyAction;
                if (string.IsNullOrWhiteSpace(action) || !ContractInvariants.KnownPolicyActions.Contains(action))
                {
                    return LabelWidget(
                        usedIds, node.Id, tag.Name,
                        $"{label}: policyAction '{action ?? "(vắng/absent)"}' không thuộc từ vựng hợp đồng, " +
                        "nên không sinh widget ghi / not in the contract's vocabulary, so no write widget was generated");
                }

                var kind = role == "setpoint" ? "setpoint-input" : "command-button";
                var props = new Dictionary<string, JsonElement>(StringComparer.Ordinal)
                {
                    ["label"] = JsonValue(label),
                };
                if (!string.IsNullOrWhiteSpace(tag.Unit)) props["unit"] = JsonValue(tag.Unit!);
                if (role == "setpoint")
                {
                    if (tag.Min is { } lo) props["min"] = JsonValue(lo);
                    if (tag.Max is { } hi) props["max"] = JsonValue(hi);
                }

                // `policyAction` copied VERBATIM (having passed the membership check). No authorisation
                // claim is made here — Session 1's `policyGate` decides that, per session, at render.
                return new ScreenWidget(
                    WidgetId(usedIds, node.Id, tag.Name), kind, PlaceholderRect,
                    Component: node.Id,
                    Bindings: new Dictionary<string, string>(StringComparer.Ordinal) { ["value"] = binding },
                    Props: props,
                    PolicyAction: action);
            }

            // ── READ ROLES: NOW DataType DECIDES, AGAINST WHAT THE WIDGET CAN CONSUME ─────────────
            case "in":
            case "out":
                return ReadWidget(usedIds, node, tag, binding, label);

            // A role outside the contract's four. Not dropped, not invented into a kind.
            default:
                return LabelWidget(
                    usedIds, node.Id, tag.Name,
                    $"{label}: role '{role}' không thuộc bốn vai trò hợp đồng khai (in/out/setpoint/command) " +
                    "/ is not one of the four roles the contract declares");
        }
    }

    /// <summary>
    /// The read half. <see cref="ComponentTagDef.DataType"/> is checked against what the widget can
    /// ACTUALLY consume — a property of the fifteen <c>.tsx</c> files, measured and cited in the type's
    /// doc comment — and where two widgets could take the value, the one that DEGRADES WITH A NAMED REASON
    /// is preferred over the one that degrades silently.
    /// </summary>
    private static ScreenWidget ReadWidget(
        HashSet<string> usedIds, ComponentNode node, ComponentTagDef tag, string binding, string label)
    {
        var bindings = new Dictionary<string, string>(StringComparer.Ordinal) { ["value"] = binding };
        var props = new Dictionary<string, JsonElement>(StringComparer.Ordinal) { ["label"] = JsonValue(label) };
        if (!string.IsNullOrWhiteSpace(tag.Unit)) props["unit"] = JsonValue(tag.Unit!);

        switch (tag.DataType)
        {
            // `gauge.tsx:25` reads `typeof tv?.value === "number"`, and it needs a band to draw an arc
            // against. With a band, a gauge; without one, a readout — which formats any value type and
            // claims no scale it was not given.
            case "float":
            case "int":
                if (tag.Min is { } lo && tag.Max is { } hi && hi > lo)
                {
                    props["min"] = JsonValue(lo);
                    props["max"] = JsonValue(hi);
                    return new ScreenWidget(
                        WidgetId(usedIds, node.Id, tag.Name), "gauge", PlaceholderRect,
                        Component: node.Id, Bindings: bindings, Props: props);
                }
                return new ScreenWidget(
                    WidgetId(usedIds, node.Id, tag.Name), "readout", PlaceholderRect,
                    Component: node.Id, Bindings: bindings, Props: props);

            // `state-badge.tsx:28` and `status-lamp.tsx:22` BOTH read `typeof value === "string"`, so
            // both can consume an enum. `state-badge` renders "—" and says nothing when the value is not
            // a string (`state-badge.tsx:40`); `status-lamp` falls back to `idle` AND writes
            // `unrecognized state "…"` into its visible sub-line (`status-lamp.tsx:26-31`). Named
            // degradation over silent — so an enum takes `state-badge` only because its raw value is
            // shown verbatim (which is what an arbitrary enum needs), and its tone map is emitted with
            // every entry `idle`, never a colour: nothing here evaluates `ComponentStateDef.Expr`, so
            // any other tone would be a claim this type cannot compute.
            case "enum":
            {
                bindings.Clear();
                bindings["state"] = binding;
                var tones = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
                foreach (var value in tag.EnumValues ?? Array.Empty<string>())
                {
                    if (string.IsNullOrWhiteSpace(value)) continue;
                    tones[value] = JsonValue("idle");
                }
                props.Remove("unit");
                if (tones.Count > 0) props["tones"] = JsonObject(tones);
                return new ScreenWidget(
                    WidgetId(usedIds, node.Id, tag.Name), "state-badge", PlaceholderRect,
                    Component: node.Id, Bindings: bindings, Props: props);
            }

            // A `bool` sent to `state-badge` renders "—" SILENTLY — it is not a string, and nothing on
            // screen says why. `status-lamp` takes the same binding name, degrades to `idle`, and NAMES
            // the reason in its sub-line. That difference is the whole rule.
            case "bool":
                bindings.Clear();
                bindings["state"] = binding;
                props.Remove("unit");
                return new ScreenWidget(
                    WidgetId(usedIds, node.Id, tag.Name), "status-lamp", PlaceholderRect,
                    Component: node.Id, Bindings: bindings, Props: props);

            case "string":
                return new ScreenWidget(
                    WidgetId(usedIds, node.Id, tag.Name), "readout", PlaceholderRect,
                    Component: node.Id, Bindings: bindings, Props: props);

            // Matched nothing. A label naming what was not understood — never dropped, never a
            // sixteenth kind.
            default:
                return LabelWidget(
                    usedIds, node.Id, tag.Name,
                    $"{label}: dataType '{tag.DataType}' chưa có widget nào tiêu thụ được " +
                    "/ no widget in the frozen set consumes this dataType");
        }
    }

    /// <summary>The fallback, and the ONLY kind this type emits for something it did not understand. Its
    /// text is <c>props.text</c> because <c>label.tsx:33</c> reads exactly that when no binding resolves —
    /// and no binding is given, deliberately: the point of this widget is to say something the generator
    /// knows, not to promise a reading it does not have.</summary>
    private static ScreenWidget LabelWidget(HashSet<string> usedIds, string scope, string leaf, string text) =>
        new(WidgetId(usedIds, scope, leaf), "label", PlaceholderRect,
            Props: new Dictionary<string, JsonElement>(StringComparer.Ordinal) { ["text"] = JsonValue(text) });

    /// <summary>Every widget is created with this rect and every one is rewritten with its real placement
    /// before the document is returned — placement is positional and is done in one pass at the end, so a
    /// widget cannot carry a stale position from an earlier decision.</summary>
    private static WidgetRect PlaceholderRect => new(0, 0, WidgetColSpan, WidgetRowSpan);

    /// <summary>
    /// A unique id in the frozen <c>^[a-z0-9-]+$</c> alphabet.
    ///
    /// <para>Uniqueness is not decoration: <see cref="ContractInvariants.Validate(HmiScreenDocument)"/>
    /// refuses duplicate widget ids (the renderer keys React children by id, so two widgets sharing one is
    /// undefined behaviour on a panel that repaints every second), so a generator that produced a
    /// collision would produce a document the write door rejects. Two different tag names CAN sanitise to
    /// the same string (<c>torque_target</c> and <c>torque-target</c> both become <c>torque-target</c>), so
    /// the collision is real and a numeric suffix — deterministic, because it depends only on what has
    /// already been emitted in this same deterministic pass — resolves it.</para>
    /// </summary>
    private static string WidgetId(HashSet<string> usedIds, string scope, string leaf)
    {
        var baseId = SanitiseId($"{scope}-{leaf}");
        if (baseId.Length == 0) baseId = "widget";
        var candidate = baseId;
        var n = 2;
        while (!usedIds.Add(candidate)) candidate = $"{baseId}-{n++}";
        return candidate;
    }

    /// <summary><c>generated-{code}</c>, never <c>machine-{code}</c> — see the type's doc comment. Falls
    /// back to a bare <c>generated</c> when the code sanitises to nothing, because a trailing hyphen is
    /// legal under the pattern but reads as a truncation.</summary>
    private static string DefaultScreenId(string machineCode)
    {
        var tail = SanitiseId(machineCode);
        return tail.Length == 0 ? "generated" : GeneratedScreenIdPrefix + tail;
    }

    /// <summary>Reduces <paramref name="value"/> to the frozen <c>^[a-z0-9-]+$</c> alphabet
    /// (<see cref="ContractInvariants.LowercaseIdPatternSource"/>): ASCII letters lowercased, digits kept,
    /// everything else a hyphen, runs of hyphens collapsed, leading/trailing hyphens trimmed. Invariant
    /// lowercasing, never culture-sensitive: a Turkish culture maps 'I' to a dotless 'ı', which is outside
    /// the pattern, and an id that depends on the server's locale is not deterministic.</summary>
    private static string SanitiseId(string value)
    {
        var sb = new StringBuilder(value.Length);
        foreach (var ch in value)
        {
            if (ch is >= 'a' and <= 'z' || ch is >= '0' and <= '9') sb.Append(ch);
            else if (ch is >= 'A' and <= 'Z') sb.Append(char.ToLowerInvariant(ch));
            else if (sb.Length > 0 && sb[^1] != '-') sb.Append('-');
        }
        while (sb.Length > 0 && sb[^1] == '-') sb.Length--;
        return sb.ToString();
    }

    private static JsonElement JsonValue(string s) =>
        JsonSerializer.SerializeToElement(s, HmiContractJson.Options);

    private static JsonElement JsonValue(double d) =>
        JsonSerializer.SerializeToElement(d, HmiContractJson.Options);

    private static JsonElement JsonObject(IReadOnlyDictionary<string, JsonElement> map) =>
        JsonSerializer.SerializeToElement(map, HmiContractJson.Options);
}
