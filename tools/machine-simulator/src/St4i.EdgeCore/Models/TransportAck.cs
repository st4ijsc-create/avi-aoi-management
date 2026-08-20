namespace St4i.EdgeCore.Models;

/// <summary>
/// What one send RESULTED IN, flattened from three different ecosystem endpoints (process-result,
/// inspection, telemetry) into one shape so the pipeline, the fleet's live state, the API trace and the
/// historian can all read it without knowing which endpoint ran. Because it is a union of three replies,
/// several members are populated on only one of the three paths and sit at their defaults on the others —
/// each says which below, and a default here therefore never means "the server said zero".
///
/// <para>Three consumers read it and they read different members: <c>EdgePipeline</c> copies
/// <paramref name="HttpStatus"/>, <paramref name="LatencyMs"/>, <paramref name="Duplicate"/> and
/// <paramref name="Error"/> into the API trace event; <c>MachineState</c> collapses
/// <paramref name="Success"/>/<paramref name="Queued"/>/<paramref name="Duplicate"/> into one of four
/// operator-visible words; and <see cref="St4i.EdgeCore.Historian.HistorianResultRecord.From"/> persists
/// exactly three of the booleans and discards everything else, so the durable record of a send is coarser
/// than this object.</para>
/// </summary>
/// <param name="Success">Whether the send was ACCEPTED, which is not the same as delivered — see
/// <paramref name="Queued"/>. A duplicate that the server refused to store again is a success. False is
/// produced for a network failure, a permanent rejection, and a client that has no machine key configured
/// at all, and this member does not distinguish those three; the pair
/// (<paramref name="Success"/>, <paramref name="Queued"/>) does.</param>
/// <param name="Id">The row the ecosystem server created, if it created one: the process-result id on a
/// process-result send, the inspection id on an inspection send. Always <see langword="null"/> for
/// telemetry — that endpoint answers with a count, not an identity — and always null on every failure path.
/// On a <paramref name="Duplicate"/> ack it is the id from the FIRST submission, which is what makes an
/// idempotent retry checkable: the two acks carry the same value.</param>
/// <param name="Duplicate">The server recognised the reading's idempotency key and returned the existing
/// row instead of writing a second one. It is a normal outcome of a retry, not an error, and it travels all
/// the way to the historian's <c>ack_duplicate</c> column, where it is the record that this reading was
/// counted once even though it was sent more than once.</param>
/// <param name="Queued">The reading did not go over the wire on this call and was taken by a
/// store-and-forward queue for later replay. It is ORTHOGONAL to <paramref name="Success"/>, and the two
/// combinations mean different things to the operator: <c>Success=false, Queued=true</c> is this machine's
/// own local buffer taking a send that failed (shown as <c>buffered</c>), while
/// <c>Success=true, Queued=true</c> is an accepted-but-not-yet-forwarded write (shown as <c>queued</c>).
/// Only the first, and only with a non-null <paramref name="Error"/>, is what <c>AutoTransport</c> treats as
/// the signal to fall back from live to demo.</param>
/// <param name="Accepted">How many telemetry SAMPLES the server took. Non-zero only on a telemetry send;
/// the process-result and inspection paths never set it, so 0 on those is "not applicable" rather than
/// "none accepted". It counts samples, not readings — one telemetry send carries many.</param>
/// <param name="HttpStatus">🔴 Not the observed status code on the success path. Both transports write a
/// FIXED value there — 201 for a process result or an inspection, 202 for telemetry — regardless of what
/// the server actually returned, so a 200 and a 201 are indistinguishable here. It carries a real,
/// server-reported code only when a permanent rejection was caught, and 0 means no HTTP round trip is being
/// claimed at all (a local queue accepted it, or the failure happened before any request). It is what the
/// UI's API-trace row shows as its status, which is why the distinction matters.</param>
/// <param name="LatencyMs">Milliseconds measured by the transport's own stopwatch around the whole SDK
/// call, in whole milliseconds. It therefore includes the SDK's internal retries and its local queue write,
/// and it is NOT the server's processing time; on a queued or failed send it is how long the attempt took
/// before giving up, not how long a delivery took.</param>
/// <param name="RawBody">🔴 Despite the name this never holds a response body. The live transport puts the
/// SDK's own submission identifier here on a process-result ack and the server's machine identifier on a
/// telemetry ack; every other path, including every failure and everything the demo transport produces,
/// leaves it <see langword="null"/>. No code in this repository reads it — it is carried, not
/// consumed.</param>
/// <param name="Error">The caught exception's message, verbatim and unwrapped, in whatever language and
/// shape the SDK or the server produced it. <see langword="null"/> on every path that did not throw. It is
/// part of <c>AutoTransport</c>'s fallback test — a non-null value is required there, so an ack that is
/// unsuccessful and queued but carries no message does NOT trigger a fallback.</param>
public record TransportAck(
    bool Success,
    long? Id = null,
    bool Duplicate = false,
    bool Queued = false,
    int Accepted = 0,
    int HttpStatus = 0,
    long LatencyMs = 0,
    string? RawBody = null,
    string? Error = null);

/// <summary>What a liveness ping to the ecosystem server came back with. Sent on a timer independently of
/// readings, so it is the product's answer to "is the link up" during a machine that is producing
/// nothing.</summary>
/// <param name="Success">Whether the server answered the ping AND said so in its own body — the live
/// transport reads a <c>success</c> field out of the reply rather than treating a 2xx as sufficient. False
/// is returned identically for a network failure, a server rejection and a client with no machine key
/// configured, which is deliberate at this layer: <c>AutoTransport</c> treats any false as its fallback
/// trigger and does not need the three told apart.</param>
/// <param name="MachineId">The ecosystem server's own numeric identity for this machine, as reported in the
/// heartbeat reply — a different namespace from <see cref="MachineDescriptor.Code"/>, which is the identity
/// this edge chose. <see langword="null"/> on any failure. The demo transport fabricates a value derived
/// from the machine code so that repeated heartbeats in one demo session stay consistent; it is not a
/// registry lookup and it does not correspond to anything on a real server.</param>
/// <param name="KeyStatus">The server's own word for the state of the machine key, passed through
/// unparsed and uncompared — this codebase never branches on it, it is displayed. <see langword="null"/> on
/// any failure; the demo transport answers <c>active</c>.</param>
/// <param name="KeyExpiresInDays">Days until the machine key expires, as the server counts them.
/// <see langword="null"/> means either that the call failed or that the reply omitted the field, and those
/// two are not distinguished here — so null must never be read as "does not expire". The demo transport
/// answers 365.</param>
public record HeartbeatResult(bool Success, long? MachineId, string? KeyStatus, int? KeyExpiresInDays);

/// <summary>The outcome of a config VERSION CHECK against the ecosystem server. This transport-level
/// operation deliberately does not download or apply anything — it compares one version string with the one
/// the caller says it already has — so every member below describes a comparison, never a config
/// change.</summary>
/// <param name="Changed">The server's version string differs from the <c>cachedVersion</c> the caller
/// passed in, compared with ordinal string equality. It is not a content diff and it is not a direction: a
/// server that has been rolled BACK to an older version reads as changed, and so does a caller that passed
/// no cached version at all.</param>
/// <param name="Version">The version the server reports. On every failure path this is the caller's own
/// <c>cachedVersion</c> handed straight back, so a non-null value here is NOT evidence that the server was
/// reached — check <paramref name="Applied"/> or <paramref name="DriftState"/> for that.</param>
/// <param name="DriftState">A status word, not an enum: this codebase produces exactly <c>synced</c>,
/// <c>none</c> and <c>error</c>, and <c>error</c> is the literal <c>AutoTransport</c> matches on to decide
/// that the live side is unusable. The declared type admits <see langword="null"/> and the fleet's own
/// display path has a branch for it, although no producer here emits one.</param>
/// <param name="Applied">Whether this check ran to completion — true on the success path, false on every
/// caught failure. 🔴 It does not mean new configuration is in force: nothing is fetched or applied by this
/// call, so <c>Changed=true, Applied=true</c> says "the versions differ and the check itself worked", and
/// the fetch-and-apply is somebody else's later step.</param>
public record ConfigSyncResult(bool Changed, string? Version, string? DriftState, bool Applied = true);
