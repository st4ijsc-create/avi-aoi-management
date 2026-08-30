using St4i.Hmi.Contracts;

namespace St4i.EngineApi.HmiModel;

/// <summary>
/// WS-HMI-0a Task 4 — referential integrity between a <see cref="ComponentModelDocument"/> and an optional
/// <see cref="TagNamespaceDocument"/>: the four measurements the Milestone 0 round-trip tests
/// (<c>ComponentModelRoundTripTests</c>) state, in their own doc comment, that they deliberately do not make.
///
/// <b>This is a PURE function on two already-deserialized documents.</b> It reads no disk, opens no
/// connection, and is not a write door — <see cref="ComponentModelStore.PutAsync"/> and
/// <see cref="TagNamespaceStore.PutAsync"/> deliberately do NOT call it. That omission is not something to
/// "fix" by wiring it in: a component tree can legitimately be declared before any connector has loaded a
/// tag namespace for the same machine (see point 4 below), and a tag namespace can legitimately be declared
/// before any component tree references it. Requiring the two documents to agree at either write door would
/// turn declaration order into a constraint neither direction can honestly claim — an engineer would have
/// to know, in advance, which document to author first. Who calls <see cref="Check"/>, and when in a
/// request's lifecycle, is left to whichever later workstream owns the endpoint that needs both documents
/// loaded at once (WS-HMI-0b at the earliest).
///
/// <para>The four checks:
/// <list type="number">
///   <item><description>Every non-null <see cref="ComponentNode.ParentId"/> must name the <see cref="ComponentNode.Id"/>
///   of some node in the SAME document.</description></item>
///   <item><description>The component tree must contain no cycle. Walked ITERATIVELY with an explicit
///   visited/in-progress marker per node — never naive recursion — because a cycle in a naive recursive walk
///   does not fail, it recurses forever and hangs the process. See <see cref="FindCycles"/>.</description></item>
///   <item><description>Every <see cref="ComponentNode.TypeId"/> must name the <see cref="ComponentTypeDef.TypeId"/>
///   of some entry in <see cref="ComponentModelDocument.Types"/>.</description></item>
///   <item><description>Only when <paramref name="ns"/> — see <see cref="Check"/> — is non-null: every
///   <see cref="ComponentNode.TagPrefix"/> must be a path-segment prefix of at least one
///   <see cref="TagDescriptor.Path"/> in the namespace.</description></item>
///   <item><description>🔴 <b>FIFTH, added 2026-08-30 (whole-branch review, Minor 5):</b> no
///   <see cref="ComponentNode.Id"/> and no <see cref="ComponentTypeDef.TypeId"/> may be declared twice in
///   one document.</description></item>
/// </list></para>
///
/// <para>🔴 <b>Why the fifth check exists, and what it replaces.</b> The <c>byId</c> dictionary is built
/// with <c>GroupBy(…).First()</c> and the type-id set with <c>ToHashSet</c>: both ABSORB a duplicate
/// silently. Two nodes with <c>id: "spindle"</c> therefore reported CLEAN from a function whose entire job
/// is referential integrity — and worse than clean, because §3.3's indirect binding resolves
/// <c>{component}</c> through that id, so a duplicate makes the binding AMBIGUOUS at runtime while the
/// integrity check says nothing. <c>First()</c> is retained rather than replaced: once the duplicate is
/// REPORTED, picking a deterministic representative is the right way to keep checks 1–4 running and
/// produce every violation in one pass instead of stopping at the first. Absorbing silently was the
/// defect; absorbing loudly is the fix.</para>
///
/// <para><b>What the fifth check does NOT do:</b> it does not compare against any other document, so two
/// MACHINES declaring the same component id remain a different question this pure function cannot see —
/// the same boundary <see cref="ContractInvariants.Validate(TagNamespaceDocument)"/>'s duplicate-path rule
/// states for itself. And it says nothing about duplicate <see cref="ComponentTagDef.Name"/> inside one
/// <see cref="ComponentTypeDef"/>, which is neither a binding key nor a store key today.</para>
///
/// <para><b><c>ns == null</c> means "not loaded yet", not "loaded and empty" — and silence on <c>null</c> is
/// the deliberate behaviour, not a missing branch.</b> The same reasoning that keeps the stores from calling
/// this function at all applies one level down: a component tree declared before any connector has loaded
/// tags for that machine is a VALID product state, so check 4 is skipped entirely rather than run against an
/// empty tag list (which would report every declared component as orphaned). Passing an actually-empty
/// <see cref="TagNamespaceDocument"/> (<c>Tags.Count == 0</c>) is a DIFFERENT state — "loaded, and nothing was
/// declared" — and check 4 runs against it normally, reporting every <c>tagPrefix</c> as unmatched.</para>
///
/// <para><see cref="Check"/> returns EVERY violation found, never just the first — same contract as
/// <see cref="ContractInvariants.Validate(ComponentModelDocument)"/> and
/// <see cref="ContractInvariants.Validate(TagNamespaceDocument)"/> in this codebase: a truncated list would
/// force a caller to re-run the check once per problem to see them all.</para>
/// </summary>
public static class ModelIntegrity
{
    /// <summary>Runs all four checks and returns every violation found (empty if the pair is clean).
    /// <paramref name="ns"/> may be <see langword="null"/> — see this class's doc comment for why that
    /// deliberately silences check 4 rather than treating an unloaded namespace as an empty one.</summary>
    public static IReadOnlyList<string> Check(ComponentModelDocument model, TagNamespaceDocument? ns)
    {
        var violations = new List<string>();

        var groupedById = model.Components.GroupBy(n => n.Id, StringComparer.Ordinal).ToList();

        // 5. 🔴 Duplicates are REPORTED before they are absorbed. `First()` below keeps checks 1–4 running
        // over a deterministic representative — that is what makes this a full pass rather than a
        // stop-at-first — but the absorption itself is now a violation instead of a silence. See this
        // class's doc comment for why a duplicate id is worse than merely untidy: it makes §3.3's
        // `{component}` binding ambiguous at runtime.
        foreach (var g in groupedById)
        {
            var count = g.Count();
            if (count > 1)
            {
                violations.Add(
                    $"component id '{g.Key}': được khai {count} lần trong cùng tài liệu — id là khoá mà " +
                    "binding gián tiếp {component} phân giải qua, nên bản thứ hai làm phép phân giải ấy nhập nhằng");
            }
        }

        foreach (var g in model.Types.GroupBy(t => t.TypeId, StringComparer.Ordinal))
        {
            var count = g.Count();
            if (count > 1)
            {
                violations.Add(
                    $"componentType typeId '{g.Key}': được khai {count} lần trong cùng tài liệu — kiểu nào " +
                    "thắng là không xác định, nên tags/states/faceplate mà một linh kiện nhận được cũng vậy");
            }
        }

        var byId = groupedById.ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);

        var typeIds = model.Types.Select(t => t.TypeId).ToHashSet(StringComparer.Ordinal);

        // 1. parentId must point at a real component.
        foreach (var node in model.Components)
        {
            if (node.ParentId is not null && !byId.ContainsKey(node.ParentId))
            {
                violations.Add(
                    $"component '{node.Id}': parentId '{node.ParentId}' không trỏ tới linh kiện nào tồn tại trong cùng tài liệu");
            }
        }

        // 2. no cycles — iterative, see FindCycles' own doc comment for why recursion is disqualified.
        violations.AddRange(FindCycles(model.Components, byId));

        // 3. typeId must name a declared ComponentTypeDef.
        foreach (var node in model.Components)
        {
            if (!typeIds.Contains(node.TypeId))
            {
                violations.Add($"component '{node.Id}': typeId '{node.TypeId}' chưa được khai trong Types");
            }
        }

        // 4. tagPrefix must match a real tag — but only once a namespace has actually been supplied.
        if (ns is not null)
        {
            foreach (var node in model.Components)
            {
                if (!ns.Tags.Any(t => IsPathPrefix(node.TagPrefix, t.Path)))
                {
                    violations.Add(
                        $"component '{node.Id}': tagPrefix '{node.TagPrefix}' không khớp tiền tố của bất kỳ tag nào trong namespace '{ns.MachineCode}'");
                }
            }
        }

        return violations;
    }

    /// <summary><paramref name="prefix"/> is a PATH-SEGMENT prefix of <paramref name="path"/> — either an
    /// exact match, or <paramref name="path"/> continues with a '/' right after <paramref name="prefix"/>.
    /// Plain <see cref="string.StartsWith(string, StringComparison)"/> would let <c>"M1/a"</c> falsely match
    /// <c>"M1/ab/x"</c>; requiring the boundary keeps the prefix meaning what §3.3's indirect binding means
    /// by it — a directory-like ancestor, not a character run.</summary>
    private static bool IsPathPrefix(string prefix, string path) =>
        path.Length == prefix.Length
            ? string.Equals(path, prefix, StringComparison.Ordinal)
            : path.Length > prefix.Length
              && path.StartsWith(prefix, StringComparison.Ordinal)
              && path[prefix.Length] == '/';

    /// <summary>Detects every cycle reachable through <see cref="ComponentNode.ParentId"/> links, reporting
    /// one violation per distinct cycle rather than one per node inside it.
    ///
    /// <para><b>Iterative by construction — this is the check the brief's own cycle test exists to catch a
    /// naive implementation of.</b> A recursive "walk to the parent, recurse" implementation does not fail
    /// fast on a cycle: it recurses forever (until the stack overflows the process, which for a two-node
    /// cycle like <c>a→b→a</c> can take a very long time to hit, reading as a HANG rather than a failure).
    /// This walk instead tracks, per node, one of three states — unvisited, IN-PROGRESS-on-the-current-walk,
    /// or DONE — using an explicit <c>while</c> loop and a per-walk <c>path</c> list. Re-encountering a node
    /// already marked in-progress on the SAME walk is the cycle signal; re-encountering a node already marked
    /// DONE (from an earlier walk that proved it acyclic, or that already reported its own cycle) ends the
    /// walk immediately without re-deriving anything. Every node is visited at most once across all walks
    /// combined, so this is linear in the number of components — not just terminating, but terminating
    /// fast.</para></summary>
    private static IEnumerable<string> FindCycles(
        IReadOnlyList<ComponentNode> components, IReadOnlyDictionary<string, ComponentNode> byId)
    {
        var violations = new List<string>();
        var state = new Dictionary<string, byte>(StringComparer.Ordinal); // 0 absent/unvisited, 1 in-progress, 2 done

        foreach (var start in components)
        {
            if (state.TryGetValue(start.Id, out var startState) && startState == 2) continue;

            var path = new List<string>();
            var current = start.Id;

            while (true)
            {
                if (!byId.TryGetValue(current, out var node))
                {
                    // Dangling parent — check 1 already reports this; not this check's concern, and not a
                    // cycle (a chain that runs off the edge of the document cannot loop back).
                    break;
                }

                if (state.TryGetValue(current, out var currentState))
                {
                    if (currentState == 2) break; // walked into a node already proven safe — done, no cycle here
                    if (currentState == 1)
                    {
                        // `current` is already on THIS walk's path: everything from its first occurrence
                        // onward, plus this repeat, is the cycle.
                        var cycleStartIndex = path.IndexOf(current);
                        var cycle = path.Skip(cycleStartIndex).Append(current);
                        violations.Add($"chu trình linh kiện: {string.Join(" → ", cycle)}");
                        break;
                    }
                }

                state[current] = 1; // in-progress on this walk
                path.Add(current);

                if (node.ParentId is null) break; // reached a root — no cycle on this path
                current = node.ParentId;
            }

            foreach (var id in path) state[id] = 2; // this walk is finished; nothing on it needs revisiting
        }

        return violations;
    }
}
