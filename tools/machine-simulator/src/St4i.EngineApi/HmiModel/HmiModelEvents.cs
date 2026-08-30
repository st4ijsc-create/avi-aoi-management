namespace St4i.EngineApi.HmiModel;

/// <summary>
/// WS-HMI-0b Task 3 — one change announcement on the HMI lane (<c>WS /v1/hmi/changes</c>).
///
/// <para>🔴 <b>WHY THIS IS ITS OWN SHAPE, AND NOT A FIELD ON <c>ApiTraceEvent</c>.</b> The plan said to
/// extend the running <c>WS /v1/inspector/stream</c> rather than build a second realtime channel. The
/// second half of that is honoured — this is a WebSocket, so the web branch still speaks ONE realtime
/// dialect, at one more URL — but the first half rested on a premise measurement refuted:
/// <c>/v1/inspector/stream</c> is not a general API-event channel. <c>EventBus.Publish</c> has exactly one
/// caller in <c>src/</c> (<c>EdgePipeline.cs</c>, the OUTBOUND ingest path), so its frames mean "we sent a
/// reading for machine X and got status S in L ms". An HMI model change is not more of that, it has no
/// truthful <c>ReadingKind</c>, and <see cref="TagCount"/> has nowhere to live on that record — carrying it
/// would have meant a new field on <c>ApiTraceEvent</c>, changing the frame on all three surfaces the
/// ruling at <c>InspectorStream.cs:217-219</c> froze (the WS frame and both Export files). That ruling is
/// NOT lifted; this routes around it, which is what such a ruling exists to make people do. The codebase
/// had already answered the same question once: <c>InspectorBodiesResponse</c> took a new route rather than
/// widen the frame.</para>
///
/// <para>🔴 <b>WHAT THIS LANE COMMITS TO, AND WHAT IT DOES NOT — written for this lane rather than
/// inherited from the older ruling's wording, so the next person is not left guessing which promise
/// applies.</b>
/// <list type="bullet">
///   <item><description><b>Committed:</b> the four property names below and their meanings;
///   <see cref="MachineCode"/> is always the CANONICAL spelling, the same name <c>GET</c>, the machine list
///   and the <c>PUT</c> echo report; an event is published only AFTER the store has accepted the write.</description></item>
///   <item><description><b>Committed:</b> <see cref="Change"/> is the discriminator, and it is an OPEN set
///   of strings. A consumer must treat an unrecognised value as "something changed for this machine, and I
///   do not know what" and re-read, never as an error. That is the deliberate opposite of the inspector
///   frame's <c>kind</c>, whose client-side union is CLOSED and therefore had to be edited in two published
///   web mirrors before a member could be added — the cost this lane is designed not to inherit.</description></item>
///   <item><description><b>NOT committed:</b> delivery order between two different machines, timing, or
///   coalescing. Two writes may produce two events or, in a future revision, one; a consumer that re-reads
///   current state on any event is correct under every such change, and one that counts events is
///   not.</description></item>
///   <item><description><b>NOT committed, and deliberately absent:</b> any replay. See
///   <see cref="HmiChangeBus"/> for the backfill rule and why this lane has no ring at all.</description></item>
/// </list></para>
/// </summary>
/// <param name="At">Wall-clock time the change was announced. A real timestamp because it records something
/// that already happened, not simulation state — the same reasoning <c>ApiTraceEvent.At</c> carries.</param>
/// <param name="Change">Which document changed: <see cref="HmiModelEvents.ComponentModelChangeKind"/> or
/// <see cref="HmiModelEvents.TagNamespaceChangeKind"/>. An OPEN set — see this type's own remarks.</param>
/// <param name="MachineCode">The CANONICAL machine code. Never the spelling the caller's route happened to
/// use: an event announcing <c>find-01</c> for a machine every read surface calls <c>FIND-01</c> would send
/// a subscriber to a name that reads back as the §5-bis empty document, i.e. "nothing here" — the very
/// "heard changed, re-read, found nothing" failure this lane exists to avoid.</param>
/// <param name="TagCount">How many tags the namespace now declares, for
/// <see cref="HmiModelEvents.TagNamespaceChangeKind"/> only; <see langword="null"/> for every other change.
/// A flat union keyed on <paramref name="Change"/>, the same shape <c>TagSource</c> uses in the frozen
/// contracts — chosen over two record types so the lane carries ONE frame a consumer can parse before it
/// knows what it is.</param>
public sealed record HmiModelChangedEvent(
    DateTimeOffset At,
    string Change,
    string MachineCode,
    int? TagCount);

/// <summary>Builds the two events this workstream announces. Factories rather than raw constructor calls at
/// the call sites, so canonicalisation happens in ONE place and cannot be forgotten at a third
/// endpoint.</summary>
public static class HmiModelEvents
{
    /// <summary>The <see cref="HmiModelChangedEvent.Change"/> value for a component-tree write.</summary>
    public const string ComponentModelChangeKind = "componentModel";

    /// <summary>The <see cref="HmiModelChangedEvent.Change"/> value for a tag-namespace write.</summary>
    public const string TagNamespaceChangeKind = "tagNamespace";

    /// <summary>A component tree was (re)declared for <paramref name="machineCode"/>.</summary>
    public static HmiModelChangedEvent ComponentModelChanged(string machineCode) =>
        new(DateTimeOffset.UtcNow, ComponentModelChangeKind,
            MachineCodeIdentity.Canonicalize(machineCode), TagCount: null);

    /// <summary>A tag namespace was (re)loaded for <paramref name="machineCode"/>, now declaring
    /// <paramref name="tagCount"/> tags.</summary>
    public static HmiModelChangedEvent TagNamespaceChanged(string machineCode, int tagCount) =>
        new(DateTimeOffset.UtcNow, TagNamespaceChangeKind,
            MachineCodeIdentity.Canonicalize(machineCode), tagCount);
}

/// <summary>Process-wide fan-out for <see cref="HmiModelChangedEvent"/>s. Deliberately NOT
/// <c>St4i.EdgeCore.Infrastructure.EventBus</c>: publishing there would put HMI rows in front of every
/// inspector subscriber and inside both Export files, which is the commitment this task refused to break
/// even though the frame's bytes would have been unchanged.</summary>
public interface IHmiChangeBus
{
    /// <summary>Fired for each published change. See <see cref="HmiChangeBus.Publish"/> for what happens to
    /// a subscriber that throws — it is a guarantee, not an accident.</summary>
    event Action<HmiModelChangedEvent>? Changed;

    void Publish(HmiModelChangedEvent e);
}

/// <inheritdoc cref="IHmiChangeBus"/>
public sealed class HmiChangeBus : IHmiChangeBus
{
    /// <inheritdoc/>
    public event Action<HmiModelChangedEvent>? Changed;

    /// <summary>
    /// 🔴 <b>TOTAL BY DESIGN, and here rather than at each call site, because a rule enforced structurally
    /// cannot be forgotten by the third endpoint that publishes.</b>
    ///
    /// <para>This is called between a store write that has ALREADY SUCCEEDED and the HTTP response. .NET
    /// multicast delegates invoke synchronously on the calling thread and stop at the first subscriber that
    /// throws, so without this an exploding subscriber would (a) return 500 for a change that really
    /// happened — telling the client nothing happened when something did, which is strictly worse than the
    /// "announced a change that did not happen" failure this lane exists to prevent, because the record on
    /// disk and the client's belief now disagree in the direction nothing can correct — and (b) silence the
    /// lane for every OTHER subscriber behind it in the invocation list, so one bad browser tab would stop
    /// the others being told anything.</para>
    ///
    /// <para>So each subscriber is invoked independently and every failure is swallowed. <b>Including
    /// cancellation</b>, which differs deliberately from
    /// <c>HmiTagEndpoints.DescribeClaimedPathsAsync</c>, where <see cref="OperationCanceledException"/> is
    /// rethrown: there the diagnosis decorates an ERROR response and a vanished caller should not be told a
    /// conflict happened; here the write has already landed, and the response is the only record the caller
    /// will get of it. Announcing must never be able to unmake a write that succeeded.</para>
    ///
    /// <para><b>The cost, stated:</b> a subscriber that throws is dropped silently for that event. There is
    /// no dead-letter and no log here, because this type has no logger and taking one would give a fan-out
    /// primitive a dependency it does not otherwise need; a subscriber that cares about its own failures
    /// must catch them itself. Pinned by
    /// <c>HmiModelEventsTests.A_subscriber_that_throws_cannot_turn_a_successful_write_into_a_failure</c>,
    /// which asserts BOTH halves — the write still answers 200, and a well-behaved subscriber behind the
    /// exploding one is still delivered to.</para>
    /// </summary>
    public void Publish(HmiModelChangedEvent e)
    {
        var handlers = Changed;
        if (handlers is null) return;

        foreach (var handler in handlers.GetInvocationList())
        {
            try
            {
                ((Action<HmiModelChangedEvent>)handler)(e);
            }
            catch (Exception)
            {
                // Deliberately total — see this method's own doc comment. Announcing a change must never be
                // able to fail the write it is announcing, or silence the lane for anyone else.
            }
        }
    }
}
