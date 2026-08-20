using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Models;

/// <summary>
/// One reading, already shaped for the wire. <see cref="St4i.EdgeCore.Mapping.Normalizer.Normalize"/> is
/// the only producer under <c>src/</c> — tests construct these directly — and one is produced once and
/// delivered TWICE from the same instance:
/// <c>EdgePipeline</c> hands it to <see cref="St4i.EdgeCore.Transport.ITransport.SendAsync"/> (the ST4I
/// HTTP ingest path) and, when a publisher is wired, to
/// <see cref="St4i.EdgeCore.Uns.IUnsPublisher.PublishReading"/> (the retained semantic mirror on the local
/// UNS spine, which <c>Site.UnsBridge</c> republishes off-box). Reuse of the same object is deliberate —
/// see <c>IUnsPublisher.PublishReading</c> — so the mirror can never drift from the envelope the
/// transport was handed. It is NOT a copy of the posted body: the live transport reads this record apart
/// and hands typed arguments to the SDK, which serializes its own shape.
///
/// <para>Nothing here is validated, by this type or by its producer. The guards that can reject a reading
/// are all downstream — the vendored SDK checks the enumerated string fields before sending, and the
/// ecosystem server checks the rest — so an envelope is a statement of what WILL be sent, never of what
/// will be accepted.</para>
///
/// <para>🔴 It is a <see langword="record"/>, so it has value equality — but
/// <paramref name="Payload"/> is a <see cref="Dictionary{TKey,TValue}"/>, which the generated
/// <c>Equals</c> compares by REFERENCE. Two envelopes built from the same reading are never equal to each
/// other. Use <paramref name="IdempotencyKey"/> to decide whether two envelopes are the same reading;
/// that is what both transports do.</para>
/// </summary>
/// <param name="Kind">Which of the three ingest shapes this is. It is the ONLY thing either transport
/// dispatches on — <c>LiveTransport.SendAsync</c> and <c>DemoTransport.SendAsync</c> both switch on it and
/// neither looks at <paramref name="Path"/> — and an unrecognised value is an
/// <see cref="ArgumentOutOfRangeException"/> out of both, not a dropped reading.</param>
/// <param name="MachineCode">The edge's own code for the machine that produced the reading, copied
/// verbatim from <c>DeviceReading.MachineCode</c>. It is duplicated inside <paramref name="Payload"/> on
/// the process-result and inspection shapes and absent from it on telemetry, where the per-sample
/// <c>deviceId</c> carries it instead; the live transport prefers the payload copy and falls back to this
/// one. It is also half of the demo transport's dedup key, so two machines can reuse one
/// <paramref name="IdempotencyKey"/> without colliding.</param>
/// <param name="Path">🔴 The ingest route as THIS repository spells it — and it never reaches the HTTP
/// wire. The live transport dispatches on <paramref name="Kind"/> into a typed SDK call, and the URL that
/// is actually requested is a literal inside the vendored SDK, so if this ever disagreed with the SDK's
/// route the request would still go to the right place. <c>StoreAndForwardRestartSurvivalTests</c> states
/// the same thing where it explains which of its assertions it cannot mutation-test.
///
/// <para>🔴 It is nevertheless published, on the OTHER path. <c>EdgePipeline</c> copies it into
/// <c>ApiTraceEvent.Path</c> for the operator's trace pane, and the UNS publisher serializes this whole
/// record as the retained semantic mirror, which puts this string on a retained MQTT topic
/// <c>Site.UnsBridge</c> forwards off-box. So a wrong value here misleads the trace pane AND ships to a
/// Site — it just cannot misdeliver an HTTP request.</para></param>
/// <param name="Payload">The request body, already in the wire's own spelling (camelCase keys, ISO-8601
/// timestamps, verdicts lowercased for process results and uppercased for inspections). It is untyped on
/// purpose because the three shapes have nothing in common, and the price is paid immediately after:
/// <c>LiveTransport</c> reads named keys back out of it to fill the SDK's typed parameters, so a key
/// renamed in <see cref="St4i.EdgeCore.Mapping.Normalizer"/> and not renamed there silently becomes an
/// empty string or a null rather than a compile error. On the process-result shape every NON-NULL key the
/// live transport does not recognise is forwarded as a genealogy field rather than dropped, which is how
/// <c>lineCode</c>/<c>lotCode</c>/<c>stationId</c> travel; a key whose value is null is dropped
/// silently.</param>
/// <param name="IdempotencyKey">The reading's identity for de-duplication, built by
/// <see cref="St4i.EdgeCore.Mapping.Normalizer.BuildIdempotencyKey"/>. It is also copied into
/// <paramref name="Payload"/> under <c>idempotencyKey</c> on the process-result and inspection shapes —
/// the live transport sends the payload copy and uses this member only as its fallback. On the TELEMETRY
/// shape there is no payload copy and the SDK's telemetry call takes no key at all, so a telemetry
/// reading's key reaches the ecosystem server nowhere — in-process it is still used, by the demo
/// transport, which keys both its fabricated ids and its deterministic "pretend this one queued" decision
/// on it. 🔴 It does leave the box by the other door for every kind including telemetry: the retained
/// semantic mirror is this whole record serialized, so the key is a field of a retained MQTT payload that
/// <c>Site.UnsBridge</c> forwards to a Site. <c>UnsPublisherIntegrationTests</c> asserts exactly
/// that.</param>
public record CanonicalEnvelope(ReadingKind Kind, string MachineCode, string Path, Dictionary<string, object> Payload, string IdempotencyKey);
