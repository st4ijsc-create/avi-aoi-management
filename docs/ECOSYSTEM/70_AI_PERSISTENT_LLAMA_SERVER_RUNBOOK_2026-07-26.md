# 70 — Persistent llama-server Runbook (deep model) + Thinking-tier honesty + Stream-copilot status
# + FIM/coder-model server (doc69 Wave 4 C2)

**doc69 Wave 1 (W1-5), 2026-07-26.** Scope: CODE + docs only — no live `llama-server`/GPU was started to
produce this doc. `LLAMA_SERVER_ENABLED` stays default **OFF**; everything below is opt-in for ops.

**§10 added by doc69 Wave 4 (C2), 2026-07-27.** Same scope discipline: CODE + docs only, no live
`llama-server`/GPU/model started. `generateFim` behaves EXACTLY as before C2 unless an operator
opts in — see §10.

---

## 1. What this solves

The deep generative model (RCA copilot, exec-summary, ops-chat — `GGUF_DEFAULT_MODEL`, ~30B) normally
loads **in-process** via `node-llama-cpp` inside the API process, where it competes with the always-resident
embedder for the single GPU's VRAM. Under contention the deep model can fail to load and generation
silently degrades to offline templates (doc 48 R5).

Running the deep model in a **separate, persistent `llama-server` process** (llama.cpp's own
OpenAI-compatible HTTP server) fixes this: it owns its own VRAM budget, stays warm (no per-request
cold-load), and the API process forwards deep-model text generation to it over HTTP instead of loading the
model itself.

**This is opt-in and OFF by default.** With `LLAMA_SERVER_ENABLED` unset (or anything other than `"true"`),
every code path in this doc is inert — the app behaves exactly as it does today (in-process only).

## 2. Two separate `llama-server` subsystems — do not confuse them

| | This doc (deep model) | Vision sidecar |
|---|---|---|
| Client | `server/services/aiLlamaServerClient.ts` | `server/services/llamaVisionSidecar.ts` |
| Who starts the process | **You, manually** (or your process manager) | The app itself, `spawn()`s it on demand |
| Relevant env | `LLAMA_SERVER_ENABLED`, `LLAMA_SERVER_URL`, `LLAMA_SERVER_MODEL`, `LLAMA_SERVER_API_KEY`, `LLAMA_SERVER_TIMEOUT_MS`, `LLAMA_SERVER_HEALTH_TIMEOUT_MS`, `LLAMA_SERVER_STRICT`, `LLAMA_FIM_SERVER_URL` (§10, optional — FIM only) | `LLAMA_SERVER_BIN`, `GGUF_VISION_MODEL`, `GGUF_VISION_MMPROJ`, `LLAMA_VISION_*` |
| Model served | `GGUF_DEFAULT_MODEL` (text, or `LLAMA_SERVER_MODEL` override) / `GGUF_CODE_MODEL`+`GGUF_FIM_MODEL` (FIM, §10) | `GGUF_VISION_MODEL` (multimodal, `--mmproj`) |

`LLAMA_SERVER_BIN` is **not** read by `aiLlamaServerClient.ts` — it's the vision sidecar's own launcher
binary path. The deep-model client only ever *connects* (HTTP) to a server you already have running at
`LLAMA_SERVER_URL`; it never spawns a process. Both subsystems can point at the same `llama-server` binary
(you invoke it manually here; the app invokes it itself there), just for different models/ports. FIM
(doc69 C2, §10) is a THIRD use of this same client — same `aiLlamaServerClient.ts` file, same manual
process-management model, either sharing the text server's URL or (optionally) a dedicated one.

## 3. Launch the persistent `llama-server` for the deep model

Same `llama-server` binary the vision sidecar uses (llama.cpp, built with CUDA/Vulkan support), pointed at
`GGUF_DEFAULT_MODEL` instead of the vision model. Example (Windows, adjust paths for your host):

```bat
"D:\bin\llama-server.exe" ^
  -m "D:\SOURCES\16.AI\Qwen3-30B-A3B-Instruct-Q4_K_M.gguf" ^
  --host 127.0.0.1 --port 8090 ^
  -ngl 999 -c 8192 --jinja ^
  --api-key "change-me"
```

- `-m` — same file `GGUF_DEFAULT_MODEL`/`GGUF_MODELS_DIR` point at (keep them in sync — see §4).
- `--host`/`--port` — bind to loopback unless the API process runs on a different host.
- `-ngl 999` — full GPU offload (drop/lower if VRAM-constrained; llama-server logs the actual layers used).
- `--jinja` — apply the model's chat template server-side (the client sends `messages`, not a raw prompt).
- `--api-key` — optional; only needed if you set `LLAMA_SERVER_API_KEY` to match (see §4).

Run it under whatever keeps it alive across restarts on your platform (Windows service / `nssm` / `pm2` /
a `systemd` unit on Linux) — the app does **not** manage this process's lifecycle.

## 4. Environment variables (aiLlamaServerClient.ts)

| Var | Default | Effect |
|---|---|---|
| `LLAMA_SERVER_ENABLED` | unset (OFF) | Must be exactly `"true"` **and** `LLAMA_SERVER_URL` non-empty for the client to route anything. Either one missing → fully inert, in-process unchanged. |
| `LLAMA_SERVER_URL` | unset | Base URL of the running server, e.g. `http://127.0.0.1:8090`. |
| `LLAMA_SERVER_MODEL` | falls back to `GGUF_DEFAULT_MODEL` | Basename of the model the server serves. A generation request is only routed to the server when the requested model's basename **matches** this — a code/fast/vision request never gets silently answered by the wrong weights. |
| `LLAMA_SERVER_API_KEY` | unset | Sent as `Authorization: Bearer …` if set; match `--api-key` on the server. |
| `LLAMA_SERVER_TIMEOUT_MS` | `120000` (120s) | Timeout for the actual generation POST (`/v1/chat/completions`) — generous, deep-model completions can be slow. |
| `LLAMA_SERVER_HEALTH_TIMEOUT_MS` | `2000` (2s) | **Short** timeout for the pre-generation preflight probe (§6) — deliberately much shorter than the generation timeout so a down/hung server is detected in ~2s, not 120s. |
| `LLAMA_SERVER_STRICT` | unset (OFF) | `"true"` → a server failure (preflight or generation) **throws** instead of falling back in-process, so the caller's honest-degrade/offline-template path kicks in rather than a silent in-process detour. Leave OFF unless you specifically want "server or nothing." |

To enable: set `LLAMA_SERVER_ENABLED=true` + `LLAMA_SERVER_URL=http://127.0.0.1:8090` (matching §3's
`--port`) in the API process's environment and restart it.

## 5. Verify it's serving

```bash
curl http://127.0.0.1:8090/health
curl http://127.0.0.1:8090/v1/models
curl http://127.0.0.1:8090/v1/chat/completions -H "content-type: application/json" -d '{
  "model": "Qwen3-30B-A3B-Instruct-Q4_K_M",
  "messages": [{"role":"user","content":"ping"}],
  "max_tokens": 8
}'
```

From the app side, `aiGgufRouter.health` (tRPC, `GET`-equivalent query) returns `getEngineHealth()`, which
now (doc69 G2-6) includes an `llamaServer` field:

```jsonc
{
  "llamaServer": { "enabled": true, "strict": false, "healthy": true }
}
```

`healthy` is only probed (one `/health` network call) when `enabled` is `true` — with the default OFF
setting this stays `null` and costs nothing per poll.

## 6. Fallback behavior (fail-safe, doc69 G2-6)

Both `aiGgufEngine.generateText()` and `.generateJSON()` follow the same sequence when
`shouldUseServerForText(modelId)` is true (server enabled + this request's model matches what the server
serves):

1. **Preflight** — `preflightHealthy()` probes `/health` (falling back to `/v1/models`) with the SHORT
   `LLAMA_SERVER_HEALTH_TIMEOUT_MS` (default 2s). Unhealthy/unreachable → **skip straight to in-process**
   (a `console.warn` is logged) instead of waiting out the long generation timeout on a hung connection.
2. **Generate** — if preflight passed, the actual `/v1/chat/completions` call runs (bounded by
   `LLAMA_SERVER_TIMEOUT_MS`, default 120s). A failure/timeout here **also falls back to in-process**
   (`console.warn`), covering the case where the server passed the health check but degrades mid-request.
3. **`LLAMA_SERVER_STRICT=true`** short-circuits both fallbacks into a throw instead — use only if you want
   "server or nothing" behavior for a specific deployment.

**In-process inference is never starved of a chance to answer** unless STRICT is explicitly set. With
`LLAMA_SERVER_ENABLED` off (the default for everyone today), none of this runs — `shouldUseServerForText()`
returns `false` immediately and the code path is byte-identical to before doc69 G2-6.

Tests (mocked client, no live server): `server/services/aiLlamaServerClient.test.ts` (client unit tests —
health probe, short-timeout behavior, generate success/error mapping) and
`server/services/aiGgufEngine.llamaServerFallback.test.ts` (engine wiring — server-up/server-down/timeout/
STRICT/`LLAMA_SERVER_ENABLED`-off, all proving an answer is still returned except under STRICT).

## 7. Thinking-tier honesty (doc69 G2-6)

**The drift the audit flagged:** `AI_THINKING_TIER_ENABLED=true` with `GGUF_THINKING_MODEL` unset (or its
file missing) used to fall back to the default deep model **silently** — an operator could believe the
tier was live when every hard `rca`/`report` request was quietly answered by the ordinary Instruct model.
The safe fallback itself was already correct (never routes to a model that can't load); what was missing
was operators being told about it.

Fixed via `server/services/aiModelRouter.ts`:

- `getThinkingTierStatus()` — pure status snapshot: `{ enabled, modelConfigured, fileExists, active, reason }`.
  `active` is `true` only when the flag is on **and** `GGUF_THINKING_MODEL` is set **and** the `.gguf` file
  actually exists under `GGUF_MODELS_DIR`. Same function now backs `getEngineHealth().thinkingTier`
  (§5-style tRPC health surface) and the router's own internal routing decision — one source of truth.
- `reportThinkingTierStatus()` — call this **once at server startup** (already wired into
  `server/_core/index.ts`, right next to `reportAiModelAvailability`). Logs one clear
  `[aiModelRouter] Thinking tier INACTIVE at startup: …` warning if the flag is on but inactive; silent if
  the tier is off (default) or genuinely active.
- The router's own per-request warning (`deepModelFor` → `warnThinkingInactive`) still fires the first time
  a hard `rca`/`report` request actually hits the misconfigured tier, independent of the startup check.

Routing behavior is **unchanged** — thinking→deep is still the safe fallback; this only makes it visible.
Tests: `server/services/aiModelRouter.thinking.test.ts` (`"thinking-tier HONESTY"` describe block).

To actually activate the tier: set `AI_THINKING_TIER_ENABLED=true` and `GGUF_THINKING_MODEL=<basename>`
(file must exist under `GGUF_MODELS_DIR`); only the hardest `rca`/`report` requests (difficulty `"hard"`)
escalate to it.

## 8. Stream-copilot — verified MOOT, no code change

The doc69 audit flagged "`aiChatAssistant` chưa stream" (main copilot not yet streaming). STEP 0 verification
for this task found that finding is **stale**:

- `aiChatAssistant.ts`'s `processChat()` carries an explicit `@deprecated` header (doc 11, P1, 2026-06-29):
  "NO-RAG backend... NO LONGER wired into production." Repo-wide search confirms the only caller of
  `processChat` is its own pinning test (`aiChatAssistant.ws-g3.test.ts`) — zero production call sites.
- The actual production chat path (`server/routers/aiChatRouter.ts`) calls `answerQuestion()` from
  `aiLocalKnowledgeService.ts` — **the same RAG + tool-registry pipeline** `streamAnswer()` uses.
- `streamAnswer()` (a real async generator, `aiLocalKnowledgeService.ts:1891`) is wired to a real SSE
  endpoint: `POST /api/ai/local-kb/stream` (`server/routes/aiLocalKnowledgeApi.ts:372`, sets
  `Content-Type: text/event-stream` and iterates `for await (const evt of streamAnswer(...))`).

**Conclusion: no code change made.** The production copilot already streams; `aiChatAssistant.processChat`
is dead code on a path already marked for Wave-5 deletion. Streaming it would be effort spent on a path
nothing serves through.

## 9. Rollback

Unset `LLAMA_SERVER_ENABLED` (or set to anything other than `"true"`) and restart the API process — every
call reverts to in-process immediately, no other cleanup needed. `AI_THINKING_TIER_ENABLED`/
`GGUF_THINKING_MODEL` are independent flags; unset either to fully disable the thinking tier.
`LLAMA_FIM_SERVER_URL` (§10) is likewise independent — unset it alone to stop routing FIM to a
dedicated server while leaving text generation on the shared server untouched, or unset
`LLAMA_SERVER_ENABLED` to kill both at once.

## 10. FIM / coder-model server (doc69 Wave 4 C2)

**What this adds:** sub-second in-editor inline completion (fill-in-middle ghost text, wired in
C1 to `aiGgufEngine.generateFim`) over the SAME persistent-server infrastructure §1-§9 describe,
instead of a per-request in-process model load. The win is the same as for text: the coder/FIM
model stays resident (no per-keystroke cold-load) and llama.cpp's server-side prefix cache reuses
KV state across the prefix an engineer is typing into.

**Client:** `server/services/aiLlamaServerClient.ts` — `shouldUseServerForFim(modelId?)`,
`preflightHealthyForFim()`, `generateFimViaServer(prefix, suffix, options)`. **Engine call site:**
`aiGgufEngine.generateFim()`, which runs the exact same preflight → generate → fall-back-in-process
(or throw under `LLAMA_SERVER_STRICT`) sequence §6 describes for text, just for FIM. Default OFF
(`LLAMA_SERVER_ENABLED` unset) ⇒ `generateFim` is byte-identical to before C2 — the in-process
`generateFimNative` (native infill via node-llama-cpp's `LlamaCompletion`) / `generateFimChatFallback`
path, unchanged.

### 10.1 Why `/infill`, not `/v1/chat/completions`

llama.cpp's server exposes a **native, non-OpenAI `/infill` endpoint**: `{ input_prefix,
input_suffix, n_predict, temperature, top_p, top_k, stop, stream }` in, `{ content,
tokens_predicted, tokens_evaluated, … }` out. This is the endpoint chosen over faking FIM through
the OpenAI-compatible chat path, because it performs TRUE special-token infill decoding straight
from the raw prefix/suffix — no chat template involved. That's the server-side equivalent of what
the in-process fallback already does via `LlamaCompletion.generateInfillCompletion` (see
`generateFimNative` in `aiGgufEngine.ts`), and avoids the sentinel-prompt-through-chat-template
degradation `generateFimChatFallback` uses as ITS OWN fallback when native infill isn't available.
No `model` field is sent in the `/infill` body — like `/completion`, it's not multi-model; it
always answers with whatever single model the target server process has loaded.

### 10.2 Two deployment shapes

| | Shared server (default) | Dedicated FIM server |
|---|---|---|
| URL | `LLAMA_SERVER_URL` (same as text) | `LLAMA_FIM_SERVER_URL` (optional; falls back to `LLAMA_SERVER_URL` when unset) |
| Model | Whatever `LLAMA_SERVER_MODEL` says the ONE running process serves | A separate small coder/FIM-model process, started independently |
| Safety check | `shouldUseServerForFim` requires the requested FIM model's basename to MATCH `LLAMA_SERVER_MODEL` — identical to the text-path check in §4, so FIM is never silently answered by a resident deep-text model | None needed — a dedicated URL's entire purpose is "this process IS the FIM server" |
| When to use | You're fine repointing the one persistent server at the coder model (text generation then also serves the coder model, since one `llama-server` process = one model) | You want BOTH a resident deep-text model AND a resident coder/FIM model at the same time (two `llama-server` processes, two ports) |

To repurpose the SHARED server for FIM: point `-m` (§3) at the coder/FIM model instead of the deep
model, and set `LLAMA_SERVER_MODEL` to match. Text requests (`shouldUseServerForText`) then stop
matching (the deep default no longer equals the served model) and fall back in-process — this is
correct, not a bug, for a single process that can only hold one model.

To run a genuinely SEPARATE FIM server: launch a second `llama-server` instance on a different
port, pointed at the coder/FIM `.gguf` (see §3's example, swap `-m`/`--port`), and set
`LLAMA_FIM_SERVER_URL=http://127.0.0.1:<that port>`. `--api-key`/auth is shared with the text
server (`LLAMA_SERVER_API_KEY`) — there is deliberately no separate FIM auth/timeout env, to keep
the surface minimal.

llama.cpp server flags relevant to `/infill` + prefix-cache/slot reuse (in addition to §3's
baseline `-m`/`--host`/`--port`/`-ngl`/`--jinja`/`--api-key`): `--ctx-size` sized for the editor's
realistic prefix+suffix window (FIM prompts are short — the default `-c 8192` from §3 is already
generous), and the server's slot/prompt cache (`--parallel`/`-np` for concurrent slots, on by
default with 1 slot) is what gives repeat completions on the SAME file their latency win — no
extra flag is required to enable it, it's the server's normal KV-cache reuse behavior for requests
that share a prefix.

### 10.3 Environment variables (additive to §4)

| Var | Default | Effect |
|---|---|---|
| `LLAMA_FIM_SERVER_URL` | unset → falls back to `LLAMA_SERVER_URL` | Base URL of a DEDICATED FIM/coder-model server. When set, `shouldUseServerForFim` skips the served-model match (§10.2) — any healthy response from this URL is trusted for FIM. |
| `GGUF_CODE_MODEL` | falls back to `GGUF_DEFAULT_MODEL` | `codeModelBasename()` (`server/services/ai/modelResolver.ts`) — the coder model for the copilot's full-program generation tier (`aiProgrammingCopilot.generateProgram`). Point the persistent server's loaded model at this same file so `LLAMA_SERVER_MODEL` matches. |
| `GGUF_FIM_MODEL` | falls back to `GGUF_FAST_MODEL` → `GGUF_DEFAULT_MODEL` | `fimModelBasename()` — the model `generateFim()` resolves to when no explicit `modelId` is passed (this is what C1's in-editor ghost text uses). This is the basename `shouldUseServerForFim()` checks against `LLAMA_SERVER_MODEL` for the shared-server shape. |

No model is ever hardcoded — both env vars flow through the shared `modelResolver.ts` (doc69
G2-5b), the SAME resolver `codeModelBasename()`/`fimModelBasename()` in `aiGgufEngine.ts` delegate
to, so the server-routed and in-process paths always agree on which model an unqualified FIM
request means.

### 10.4 Fallback behavior (identical shape to §6, FIM-specific)

1. **Gate** — `shouldUseServerForFim(effectiveId)` (where `effectiveId = modelId ?? fimModelBasename()`,
   the SAME resolution `generateFim` itself does): `false` unless `LLAMA_SERVER_ENABLED=true` AND a
   FIM URL resolves AND (shared-server shape only) the requested model matches `LLAMA_SERVER_MODEL`.
2. **Preflight** — `preflightHealthyForFim()` probes the FIM URL's `/health` (→ `/v1/models` fallback)
   with the same short `LLAMA_SERVER_HEALTH_TIMEOUT_MS`. Unhealthy/unreachable → in-process
   (`generateFimNative`/`generateFimChatFallback`) runs instead, `console.warn` logged.
3. **Generate** — `generateFimViaServer` POSTs `/infill` (bounded by `LLAMA_SERVER_TIMEOUT_MS`). A
   failure here also falls back in-process, `console.warn` logged.
4. **`LLAMA_SERVER_STRICT=true`** throws instead of falling back, at either step — same safety valve
   as text.

Return shape is unchanged either way (`GgufGenerateResult`) — `programmingRouter.copilotComplete`
(C1's caller) never needs to know which path answered.

Tests (mocked client + node-llama-cpp, no live server/model):
`server/services/aiLlamaServerClient.fim.test.ts` (client unit tests — gate, preflight, `/infill`
request/response mapping, error handling) and `server/services/aiGgufEngine.fim.server.test.ts`
(engine wiring — server-up/server-down/generation-failure/STRICT/`LLAMA_SERVER_ENABLED`-off, all
proving `generateFim` still returns an answer except under STRICT).

### 10.5 OPS step — measure the lift (PROVEN-LIVE, not done by this task)

This task (C2) is CODE + docs only: no live server, GPU, or model was started, and no latency
number below has been measured yet. To actually prove the sub-second-FIM claim and record it as
PROVEN-LIVE, an operator with the GPU box needs to:

1. Launch a persistent `llama-server` for the coder/FIM model per §10.2 (either shape), and set
   `LLAMA_SERVER_ENABLED=true` + `LLAMA_SERVER_URL`/`LLAMA_FIM_SERVER_URL` + `LLAMA_SERVER_MODEL`
   (and `GGUF_CODE_MODEL`/`GGUF_FIM_MODEL` if not already set) in the API process's environment;
   restart it.
2. Verify routing is live: `curl <fim url>/health`, then a manual `/infill` smoke call (mirrors §5
   for text):
   ```bash
   curl http://127.0.0.1:8091/infill -H "content-type: application/json" -d '{
     "input_prefix": "function add(a, b) {\n  ",
     "input_suffix": "\n}",
     "n_predict": 32
   }'
   ```
   and confirm the API process logs the server-routed path being taken (no
   `falling back in-process` warnings) for an in-editor completion.
3. Run `scripts/ai-eval/eval-codegen.mjs` (the existing doc 34 P4 codegen eval harness — see
   `scripts/ai-eval/README.md` "Comparing runs" for the exact before/after pattern already
   established there) once with the server OFF and once with it ON, using distinct `--label`s, e.g.:
   ```bash
   # baseline: LLAMA_SERVER_ENABLED unset/false — in-process code-tier generation
   npx tsx scripts/ai-eval/eval-codegen.mjs --label c2-inprocess-baseline
   # after: LLAMA_SERVER_ENABLED=true, coder model resident on the persistent server
   npx tsx scripts/ai-eval/eval-codegen.mjs --label c2-persistent-server
   ```
   then diff `reports/codegen-c2-inprocess-baseline.json` vs. `reports/codegen-c2-persistent-server.json`
   — `avgLatencyMs` (overall + per-kind) is the headline lift metric; `validPassRate` should be
   unchanged (same model, same cases — this eval is a LATENCY comparison, not a quality one, unless
   the operator also swaps `GGUF_CODE_MODEL` to a genuinely different coder model in the same pass).
   Note: `eval-codegen.mjs` exercises `aiProgrammingCopilot.generateProgram()` (the full-program
   code-tier, not C1's raw ghost-text `generateFim` path directly) — it's the existing, only
   latency-measuring harness in the repo and shares the same resident-coder-model win, but it is
   NOT a literal keystroke-to-ghost-text timer. For that specific number, time a few real
   `programming.copilotComplete` (C1's tRPC procedure) calls manually against a warm server.
4. Record the measured `avgLatencyMs` delta (and the manual FIM-specific timing from step 3's last
   sentence) in this doc as PROVEN-LIVE, with the date and hardware used, once done.
