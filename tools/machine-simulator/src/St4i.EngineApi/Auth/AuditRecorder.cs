using System.Security.Claims;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using St4i.EngineApi;

namespace St4i.EngineApi.Auth;

/// <summary>
/// WS-D-D3 — the one call site every mutating handler will eventually use (wiring THAT is D4 — see the
/// brief; this task only needs the helper itself to exist and work) to append one row to the audit
/// chain, without every call site having to re-derive "who is this", "what role were they acting as",
/// "what's this request's correlation id" itself. Pulls all of that straight off <see cref="HttpContext"/>:
/// <list type="bullet">
/// <item><description>actor = <c>ctx.User.Identity?.Name</c>, or the literal string <c>"(anonymous)"</c>
/// if somehow unauthenticated (should not happen behind the default-deny fallback policy, but this
/// helper must never throw over a missing identity).</description></item>
/// <item><description>role = the <see cref="ClaimTypes.Role"/> claim, or <c>"(none)"</c> if absent.</description></item>
/// <item><description>correlationId = <see cref="HttpContext.TraceIdentifier"/> — already unique per
/// request, already threaded through ASP.NET's own logging, so reusing it here means an audit row can be
/// cross-referenced against the request's other logs for free.</description></item>
/// <item><description>clientIp = <see cref="HttpContext.Connection"/>'s <c>RemoteIpAddress</c> — advisory
/// only (see <see cref="SqliteAuditStore"/>'s doc comment for why it's excluded from the hash).</description></item>
/// </list>
/// <see cref="oldValue"/>/<see cref="newValue"/> are serialized via the SAME <c>System.Text.Json</c>
/// options (<see cref="ApiJson.Options"/>, "web" camelCase defaults) every other JSON response in this
/// host already uses — NOT a second, independently-configured serializer — so an audit row's JSON reads
/// identically to the API's own request/response bodies. Callers are the ones who decide what "old"/"new"
/// mean for their own mutation and MUST pass already-redacted values — this helper does no secret
/// scrubbing of its own (the brief: "NEVER include secrets — callers pass already-redacted values (D4's
/// concern)").
///
/// WS-D-D4 (the D3-flagged failure-policy decision) — <see cref="RecordAsync"/> NEVER throws into the
/// calling handler: <see cref="IAuditStore.AppendAsync"/> is wrapped in its own try/catch, and a failure
/// there is logged (<see cref="ILogger{TCategoryName}"/>, category <see cref="AuditRecorder"/>) and
/// swallowed. Principle "never stop production for a support subsystem" — an audit log is a support/
/// compliance concern, not a safety interlock; a local SQLite hiccup writing <c>security.db</c> must never
/// itself become the reason a real mutation (an E-STOP, a settings change, a recipe upsert) fails to
/// commit or reports a false failure to the caller. Every mutating handler therefore just
/// <c>await recorder.RecordAsync(ctx, ...)</c> with NO try/catch of its own — this method is the ONE place
/// that decision is implemented, so every call site gets it for free.
/// </summary>
public sealed class AuditRecorder
{
    private readonly IAuditStore _store;
    private readonly ILogger<AuditRecorder> _logger;

    public AuditRecorder(IAuditStore store, ILogger<AuditRecorder> logger)
    {
        _store = store;
        _logger = logger;
    }

    public async Task RecordAsync(
        HttpContext ctx, string action, string? targetType = null, string? targetId = null,
        object? oldValue = null, object? newValue = null, CancellationToken ct = default)
    {
        var actor = ctx.User.Identity?.Name ?? "(anonymous)";
        var role = ctx.User.FindFirstValue(ClaimTypes.Role) ?? "(none)";
        var correlationId = ctx.TraceIdentifier;
        var clientIp = ctx.Connection.RemoteIpAddress?.ToString();

        var oldJson = oldValue is null ? null : JsonSerializer.Serialize(oldValue, ApiJson.Options);
        var newJson = newValue is null ? null : JsonSerializer.Serialize(newValue, ApiJson.Options);

        var entry = new AuditAppend(
            actor, role, action, targetType, targetId, oldJson, newJson, correlationId, clientIp,
            DateTimeOffset.UtcNow);

        try
        {
            await _store.AppendAsync(entry, ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            // Deliberately NOT rethrown — see this class's doc comment. The mutation this row was meant
            // to record has ALREADY committed by the time a caller reaches this call (ordering: record
            // AFTER the mutation succeeds), so the only thing at stake here is the audit row itself.
            _logger.LogError(
                ex,
                "Audit append failed for action {Action} (actor={Actor}, target={TargetType}/{TargetId}) — " +
                "the triggering mutation already committed and is NOT affected; this audit row was lost.",
                action, actor, targetType, targetId);
        }
    }
}
