# HMI API CONTRACT — WS-HMI-0b

**What this is.** The complete HTTP + realtime surface the .NET branch opened over WS-HMI-0a's component-model
and tag-namespace stores, written for the web branch to build against without reading `src/`. It is the
sibling of `ALARM_WEBHOOK_CONTRACT.md` and `CONFIG_SYNC_SERVER_CONTRACT.md` and follows their shape: every
route, its policy, its exact success and failure answers, and the invariants a client may rely on.

**Why this file exists at all, said plainly.** The plan told Task 4 to describe these routes "in
`src/St4i.EngineApi/openapi/`". **That directory does not exist, and neither does any OpenAPI generator** —
there is no Swashbuckle, no NSwag, no `AddEndpointsApiExplorer` anywhere in `St4i.EngineApi`. Writing one
would have meant introducing a documentation mechanism this repository has never used, in the task whose job
is to close the books. What this repository actually does for "a contract another party builds against" is a
`docs/*_CONTRACT.md`, and there are two of them already in use. So this is that.

**Nine routes, not eight.** Every count in the plan says eight, which was true when it was written (five
from Task 1, three from Task 2) and stopped being true when Task 3 added the change lane. Counted from
source at `6ca5c729`, not from the plan.

**Version gate.** `GET /v1/capabilities` reports `hmiModelEnabled` (the stores exist — WS-HMI-0a) and
`hmiApiEnabled` (these routes are open — WS-HMI-0b). They are separate because there was a released state
where the first was true and the second false. The change lane has **no** flag of its own: it ships with the
API and cannot be absent while `hmiApiEnabled` is true.

---

## 1. Authentication — you need a session before any of this answers

**Every route below requires a logged-in session. None is anonymous.** Authentication is an
**encrypted HTTP cookie**, not a bearer token: there is no `Authorization` header, no API key and no query
token anywhere on this surface.

```http
POST /v1/auth/login        {"username":"…","password":"…"}   → 200 + Set-Cookie
GET  /v1/auth/me                                             → who am I / am I still valid
POST /v1/auth/logout
GET  /v1/capabilities                                        → anonymous, the one exception
```

From a browser this is automatic provided the request is same-origin or `credentials: "include"` is set;
the web client's `request()` in `web/src/lib/api.ts` already does this. **A cookie can be invalidated
server-side** by a password change, a role change or the account being disabled, so treat `401` on any
route as "log in again", not as a transport error.

| Status | Means |
|---|---|
| **`401 Unauthorized`** | no session, or the cookie was invalidated. Re-authenticate. |
| **`403 Forbidden`** | authenticated, but the wrong tier — e.g. an Operator attempting either `PUT`. Do not retry; it will never succeed for this user. |

### 🔴 Authenticating the WebSocket from a browser

**`new WebSocket(url)` cannot set headers** — the browser API exposes no way to add one, so the usual
"send a token" pattern is unavailable. This surface does not need it: the upgrade request is an ordinary
HTTP request and **the browser attaches the auth cookie automatically**, provided the socket URL is
**same-origin** with the page. So:

```ts
// Works — same origin, cookie rides along on the upgrade, no headers needed.
const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/v1/hmi/changes`)
```

**Consequences worth knowing before you debug this at 2am:**

- A **cross-origin** socket will not carry the cookie and the upgrade will be refused. Serve the web app
  from the engine's origin, or proxy `/v1` through the dev server (the existing Vite config already
  proxies `/v1`, which is why this works in development).
- A refused upgrade does **not** give you a readable status code — the browser surfaces a generic
  `error`/`close`. If a socket will not open, **call `GET /v1/capabilities` and then any Operator route**
  to find out whether the problem is the session (`401`) or the tier (`403`); the socket cannot tell you.
- The cookie can expire while a socket is open. The socket is not re-authenticated per frame, so it stays
  up until it drops for other reasons — **reconnect logic must handle a reconnect that is now refused.**

## 2. Authorisation

| Tier | Routes |
|---|---|
| `Policies.Operator` | all six reads, **and the change lane** |
| `Policies.Engineer` | the two writes |
| `Admin` | **never** — nothing in this workstream writes to a device |

Subscribing to changes is a read, and what it carries (a machine code, a tag count) is strictly less than
`GET /v1/tags?machine=` already returns at Operator, so gating the notification above the data it points at
would have been a difference with no reason behind it.

## 2-bis. The request and response bodies are FROZEN CONTRACTS — read them there, not here

`ComponentModelDocument`, `TagNamespaceDocument`, `ComponentTypeDef` and `TagDescriptor` are **not defined
in this document, deliberately.** They are frozen artefacts with a single definition per language and a
two-way pin between them, and restating their fields here would create a third copy free to drift — which
is the defect this whole branch has spent its rounds removing.

| What you need | Where it lives |
|---|---|
| **The authority** — JSON Schema, both languages pin to it | `contracts/tag-namespace.schema.json`, `contracts/component-model.schema.json`, `contracts/hmi-screen.schema.json` |
| **TypeScript types** — import these, do not hand-write | `web/src/contracts/` |
| **C# records** | `src/St4i.Hmi.Contracts/` |
| **Valid + invalid example payloads** | `contracts/fixtures/valid/`, `contracts/fixtures/invalid/` |
| **The gate that keeps both sides honest** | `node scripts/check-contracts.mjs` |

The `invalid/` fixtures are worth reading before you build a form: each one is named for the single rule it
violates, and those rules are the `400`s you will get.

## 3. HTTP — component model (5)

| Route | Policy | Answers |
|---|---|---|
| `GET /v1/components` | Operator | `200` `string[]` — every machine code with a declared tree, canonical spelling, de-duplicated |
| `GET /v1/components/{machineCode}` | Operator | `200 ComponentModelDocument`. **An undeclared machine is `200` with an EMPTY document, never `404`** |
| `PUT /v1/components/{machineCode}` | Engineer | `200 PutModelResultDto` · `400 ApiErrorDto` |
| `GET /v1/components/{machineCode}/integrity` | Operator | `200 IntegrityReportDto` |
| `GET /v1/component-types` | Operator | `200 ComponentTypeDef[]` — merged across machines, one entry per `typeId`. **"First declaration wins", where "first" is ordinal by canonical machine code** — the merge walks `GET /v1/components`, which is sorted that way, so the winner is deterministic and does not depend on write order or on disk layout. Two machines declaring the same `typeId` with different content is a real gap; reporting it is a later task, not this one. |

```jsonc
// PutModelResultDto
{ "machineCode": "AOI-01", "componentCount": 3, "warnings": ["component 'spindle': tagPrefix …"] }
// IntegrityReportDto — namespaceLoaded distinguishes "matched everything" from "nothing to match yet"
{ "machineCode": "AOI-01", "namespaceLoaded": true, "violations": [] }
```

## 4. HTTP — tag namespace (3)

| Route | Policy | Answers |
|---|---|---|
| `GET /v1/tags?machine={code}` | Operator | `200 TagNamespaceDocument` (empty if not loaded) · **`400` if `machine` is missing, empty or whitespace** |
| `GET /v1/tags/by-path/{**path}` | Operator | `200 TagDescriptor` · **`404` if no tag is declared at that path** |
| `PUT /v1/tags/{machineCode}` | Engineer | `200 PutNamespaceResultDto` · `400 ApiErrorDto` · **`409 ApiErrorDto`** |

`{**path}` is a **catch-all**: a tag path contains `/`, so `SCRW-01/spindle/torque` is one path parameter,
not three segments.

`?machine=` is required and never optional. An endpoint that silently returns everything when its filter is
absent is how a UI accidentally drags down an entire site's namespace, and a namespace is hundreds to
thousands of flat tags per machine.

```jsonc
// PutNamespaceResultDto — backedByDriverCount is a COUNT OF A DECLARED FIELD in 0b, nothing more.
// It does not mean a driver has loaded these tags. WS-HMI-0c is where it becomes a measured proposition.
{ "machineCode": "AOI-01", "tagCount": 128, "backedByDriverCount": 96 }
```

### 🔴 `409` — a tag path is a GLOBAL key

`tag_index.path` is unique across **every** machine, not per machine. A `PUT` whose namespace claims a path
another machine already owns is refused `409` with the offending path named:

```json
{ "error": "tag path(s) already declared by another machine: plant/line3/temp. A tag path is a GLOBAL key across every machine, not a per-machine one — rename the path, or retire it from the machine that owns it first." }
```

Re-declaring a machine's **own** paths is the ordinary edit and never collides. If many paths collide the
message names up to ten and reports the exact total (`showing 10 of 27`).

## 5. Realtime — `WS /v1/hmi/changes` (1)

**This is the route no OpenAPI document could describe, and the reason this file exists rather than a
generated one.** WebSocket, `Policies.Operator`, server-push only.

```jsonc
// one JSON message per change
{ "at": "2026-08-31T09:12:44.7120000+00:00", "change": "tagNamespace",  "machineCode": "AOI-01", "tagCount": 128 }
{ "at": "2026-08-31T09:13:02.0040000+00:00", "change": "componentModel","machineCode": "AOI-01" }
```

| Field | Committed |
|---|---|
| `at` | wall-clock time the change was announced |
| `change` | discriminator. **OPEN SET** — treat an unrecognised value as "something changed for this machine, re-read", never as an error |
| `machineCode` | always the **canonical** spelling, identical to what `GET` and the `PUT` echo report |
| `tagCount` | present only for `"tagNamespace"`; **absent**, not `null`, otherwise |

**What it commits to.** An event is published only **after** the store accepted the write. A request that
does not return `2xx` publishes **nothing** — a client that hears "changed", re-reads and finds nothing
changed stops trusting the channel.

**What it does NOT commit to.** Ordering between different machines; timing; coalescing. Two writes may
produce two events or, in a future revision, one. **A consumer that re-reads current state on any event is
correct under every such change; a consumer that counts events is not.**

### 🔴 No backfill — read current state on connect

This lane replays **nothing**. There is no ring buffer behind it at all — the absence is structural, not a
capacity set to zero.

> **The rule:** you are told about changes that happen while you are subscribed, and nothing else. On
> connect **and on reconnect alike**, read current state.

A change event is an invalidation signal, not a record. A client that has just connected is about to read
current state anyway, and a bounded replay could never promise completeness to a client that was
disconnected for an unknown length of time — so a backfill would buy nothing anyone could rely on.

**Note the contrast with `WS /v1/inspector/stream`**, which is a *different lane for a different purpose*: it
backfills 200 events and skips that only when the client passes `?skipBackfill=1`, so it deliberately behaves
differently for a fresh pane than for a reconnecting one. Do not copy its client code and expect this lane to
behave the same way. `/v1/inspector/stream` carries `ApiTraceEvent` frames about **outbound device sends**
and is `Policies.Engineer`; it has nothing to do with HMI model changes and its frame is frozen.

## 6. Invariants worth building against

1. **§5-bis — undeclared is empty, not missing.** A machine that has declared nothing is a valid product
   state. `GET /v1/components/{code}` and `GET /v1/tags?machine=` both answer `200` with an empty document.
   **A specific tag that does not exist is `404`** — asking for one thing that is not there and asking for
   the contents of an empty collection are different questions and get different answers.
2. **A machine code is case-INSENSITIVE; a tag path is case-SENSITIVE.** Every route accepts any spelling of
   a machine code and reports the canonical (upper-case) one. Paths are ordinal.
   **A tag path is NOT derivable from a machine code — look one up, never compose one.** A namespace for
   `AOI-01` may legitimately declare `line3/camera/temp`.
3. **Losing integrity WARNS; losing safety REFUSES.** A `tagPrefix` matching no tag is `200` with
   `warnings`. A §5 violation (a writable tag with no `policyAction`, a `setpoint` with no `min`/`max`) is
   `400` carrying **every** violation, not the first.
4. **Declaration order is not a constraint.** A component tree may be declared before its namespace or after.
5. **A rejected write leaves no record.** Every `4xx` is checked at both read surfaces.
6. **Last-writer-wins.** The frozen contracts carry no concurrency token, so two engineers editing one
   machine concurrently silently lose an edit.
7. **`ApiErrorDto` is `{ "error": "…" }`** — one error type across this whole surface.
