# ST4I Alarm Webhook Contract (reference for receiver authors)

Task C-3 of Đợt C. This is the wire contract of the alarm webhook channel — everything somebody needs to
write a receiver without reading our source. It is a **public interface**: the fields below will not be
removed or repurposed without a `specVersion` bump.

Implementation: `src/St4i.EngineApi/Alarms/WebhookNotification.cs` (contract + signer) and
`WebhookNotificationChannel.cs` (the sender). Configuration lives in `NotificationConfigStore`
(`notifications.db`).

---

## 1. The request

```
POST <the URL you configured>
Content-Type: application/json; charset=utf-8
User-Agent: st4i-machine-simulator-alarm-webhook/1
X-ST4I-Delivery: 9f0c4a1b2d3e4f5061728394a5b6c7d8      # idempotency key, stable across retries
X-ST4I-Event: Raised                                    # the edge kind, for routing without parsing
X-ST4I-Signature: v1=<64 lowercase hex chars>           # present only if a signing secret is configured
X-ST4I-Timestamp: 1785489322                            # unix SECONDS; present iff the signature is
<optional operator-configured auth header, e.g. Authorization or X-Api-Key>
```

- **Redirects are not followed.** A 3xx is treated as a permanent failure, because following it would send
  the signature and any auth token to a host the operator did not configure. Store the final URL.
- The sender **never reads your response body**. Only the status code and reason phrase are used, and only
  the status code and reason phrase are ever logged. (Deliberate: an echoing endpoint would otherwise
  reflect the auth header back into our log files.)

## 2. The body

```jsonc
{
  "text": "[HIGH] RAISED — DriverHealth/DOWN on MODBUS-01: Driver MODBUS-01 is unreachable (engine PLANT-01)",
  "specVersion": 1,
  "type": "st4i.alarm.edge",
  "deliveryId": "9f0c4a1b2d3e4f5061728394a5b6c7d8",
  "sentAtUtc": "2026-07-30T09:15:22.1234567Z",
  "source":  { "product": "st4i-machine-simulator", "host": "PLANT-01", "channelInstance": "default" },
  "edge":    { "kind": "Raised", "sequence": 42, "atUtc": "2026-07-30T09:15:22.1234567Z",
               "previousPriority": null, "actor": null },
  "alarm":   { "key": "DriverHealth|DOWN|MODBUS-01", "source": "DriverHealth", "code": "DOWN",
               "priority": "High", "state": "Active",
               "message": "Driver MODBUS-01 is unreachable", "runbook": "runbook://drivers/down",
               "targetId": "MODBUS-01", "clearOnAck": false, "count": 7,
               "firstRaisedUtc": "2026-07-30T09:00:00.0000000Z",
               "lastRaisedUtc":  "2026-07-30T09:15:00.0000000Z",
               "ackedUtc": null, "ackedBy": null }
}
```

Rules a receiver can rely on:

- **Nulls are present, never omitted.** `alarm.ackedBy` exists in every body. Your schema does not have to
  cope with fields appearing and disappearing per edge kind.
- **Ignore fields you do not recognise.** Additive fields do not bump `specVersion`.
- **Timestamps** are ISO-8601 UTC with an explicit `Z` and 7 fractional digits.
- **Enums** are the member names below, as strings. New members may be added.
- **Non-ASCII is `\uXXXX`-escaped** (strict JSON encoder — alarm text is operator-authored free text and is
  commonly rendered into HTML by receivers).

### `text` — why it is there

A Slack incoming webhook rejects a body with no `text` (or `blocks`) as `invalid_payload`; a legacy Teams
Office-365 connector behaves the same way. Both ignore top-level keys they do not recognise. So this one
field is what lets a single body post unmodified to Slack, to Teams, and to a custom MES/Zabbix receiver.

**Its wording is not part of the contract and will change.** A structured consumer must read `alarm` and
`edge`.

### `edge.kind`

| Kind | Meaning |
|---|---|
| `Raised` | An alarm key that was not active is now active. The primary edge. |
| `Escalated` | An already-active alarm got strictly more severe. `edge.previousPriority` says from what. |
| `Acked` | An operator acknowledged a still-active CONDITION alarm — ISA-18.2 "silence the horn". The alarm is still on. `edge.actor` is the username. |
| `Cleared` | The alarm left the active set: the condition ended (`actor` null), or an operator acked an EVENT alarm (`actor` set). |
| `Restored` | 🔴 **This alarm was already standing when the engine restarted.** It is not a new condition. A receiver that pages on this will page on every restart — filter it if you only care about new events. |

The sender fires on **edges**, never on state. A condition that stays true for an hour produces one
`Raised`, not 720 messages. So: do not treat every message as "an alarm is happening".

### Identity and ordering

- `alarm.key` (source + code + target) is the **stable** identity. Correlate a `Cleared` back to its
  `Raised` with it.
- `edge.sequence` is a per-process, strictly increasing ordinal — use it to order two messages about one
  alarm without trusting clocks. **It resets to 0 when the engine restarts**; for cross-restart identity use
  `source.host` + `edge.atUtc`.
- `source.host` is which machine *sent* this. `alarm.targetId` is which machine the alarm is *about*
  (or `fleet`). One engine runs a whole fleet.
- There is deliberately **no numeric alarm id**. The internal one is a SQLite rowid, which SQLite reuses
  after a delete; a receiver keying on it would silently merge two unrelated alarms.

### Enumerations

- `alarm.source`: `Policy` | `DriverHealth` | `NgRate` | `Identity`
- `alarm.priority`: `Critical` | `High` | `Medium` | `Low` (only `Critical` and `High` occur today)
- `alarm.state`: `Active` | `Acked` | `Cleared`

---

## 3. 🔴 Verifying the signature

Given the **raw request body bytes** (before any JSON parsing — a re-serialised body will not verify), the
`X-ST4I-Timestamp` header and the `X-ST4I-Signature` header:

```
1. Reject if X-ST4I-Signature is absent or does not start with "v1=".
2. Reject if |now - X-ST4I-Timestamp| > 300 seconds.
3. signedMaterial = utf8(X-ST4I-Timestamp) || utf8(".") || rawBodyBytes
4. expected = "v1=" + lowercase_hex(HMAC_SHA256(key = utf8(sharedSecret), message = signedMaterial))
5. Accept iff constant_time_equals(expected, X-ST4I-Signature).
6. Drop the message if body.deliveryId has been seen before.
```

Python:

```python
import hashlib, hmac, time

def verify(raw_body: bytes, headers, secret: str) -> bool:
    signature = headers.get("X-ST4I-Signature", "")
    timestamp = headers.get("X-ST4I-Timestamp", "")
    if not signature.startswith("v1=") or not timestamp.isdigit():
        return False
    if abs(time.time() - int(timestamp)) > 300:
        return False
    material = timestamp.encode() + b"." + raw_body
    expected = "v1=" + hmac.new(secret.encode(), material, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
```

Notes that matter:

- **The timestamp is inside the signed material**, so a captured request cannot be re-stamped to slip past
  step 2. A scheme that merely sent a timestamp alongside the body would protect nothing.
- **Step 6 is not optional.** Within the 300-second tolerance a captured request replays perfectly — that
  is inherent to every timestamp-bounded scheme. `deliveryId` is what closes it, and the same record
  gives you correct dedup of the sender's own retries (see §4).
- The `.` separator is there so that timestamp `1234` + body `5{…}` and timestamp `12345` + body `{…}`
  cannot produce identical signed material.
- **No secret configured means no signature and no timestamp header at all** — never a blank one, so
  "is the header present" is a sound check. This is legitimate: a Slack or Teams incoming-webhook URL *is*
  the credential and those services verify nothing. If *your* receiver requires signatures, reject unsigned
  requests yourself; the sender cannot know it should have signed.

## 4. Retries, duplicates and losses

- **Retried:** a transport failure (refused/DNS/TLS/reset), an attempt timeout, and HTTP
  `408, 429, 500, 502, 503, 504`.
- **Not retried:** everything else. A 400 means these exact bytes were rejected and a retry sends the same
  bytes; 401/403 means the credential is wrong and hammering it locks accounts out; **404/410 is what Slack
  returns for a revoked incoming webhook**.
- **Bounds:** at most **3 attempts**, per-attempt timeout **5 s**, and a hard **10 s** total per
  notification per destination, backoff 250 ms then 500 ms. `Retry-After` is honoured up to that budget and
  **abandoned beyond it** — the sender will not park its notification loop for a `Retry-After: 300`.
- **`deliveryId` is stable across retries** and unique per (notification, destination). A retry after a
  timeout can genuinely duplicate a POST you already processed. **Record `deliveryId` and drop repeats.**
- 🔴 **There is no delivery guarantee and no queue.** If all attempts fail, that notification is gone; the
  alarm's edge is not re-emitted. The sender counts and logs every such loss, but it will not arrive later.

## 5. Authenticating to a receiver that is not Slack or Teams

Set an **auth header name** on the webhook configuration (non-secret; visible in the config API) and store
the token under the secret name `webhook.auth_token` (DPAPI-encrypted at rest).

🔴 **The stored token is the complete header value, verbatim.** For a bearer token store
`Bearer eyJhb…` *including the scheme word*; for `X-Api-Key` store the key alone. Nothing is prepended and
nothing is inferred.

The channel refuses to store a header name it sets itself (`X-ST4I-Signature`, `X-ST4I-Timestamp`,
`X-ST4I-Delivery`, `X-ST4I-Event`, `Content-Type`, `User-Agent`, `Host`, …) or one that is not an RFC 9110
token. If an auth header is configured but no token is stored, the notification is **not sent** and is
counted as lost — rather than arriving unauthenticated and looking like a wrong credential.

Use `https://`. Over plain HTTP the token crosses the network in clear text on every alarm, and the
destination URL — which for Slack/Teams-style receivers *is* the credential — is visible in the request
line. The engine warns about this at startup when a token is configured on an `http://` endpoint. The HMAC
signature proves who sent the request; it does not hide it.
