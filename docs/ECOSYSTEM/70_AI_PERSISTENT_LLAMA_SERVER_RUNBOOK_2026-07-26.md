# 70 — Persistent llama-server Runbook (deep model) + Thinking-tier honesty + Stream-copilot status

**doc69 Wave 1 (W1-5), 2026-07-26.** Scope: CODE + docs only — no live `llama-server`/GPU was started to
produce this doc. `LLAMA_SERVER_ENABLED` stays default **OFF**; everything below is opt-in for ops.

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
| Relevant env | `LLAMA_SERVER_ENABLED`, `LLAMA_SERVER_URL`, `LLAMA_SERVER_MODEL`, `LLAMA_SERVER_API_KEY`, `LLAMA_SERVER_TIMEOUT_MS`, `LLAMA_SERVER_HEALTH_TIMEOUT_MS`, `LLAMA_SERVER_STRICT` | `LLAMA_SERVER_BIN`, `GGUF_VISION_MODEL`, `GGUF_VISION_MMPROJ`, `LLAMA_VISION_*` |
| Model served | `GGUF_DEFAULT_MODEL` (or `LLAMA_SERVER_MODEL` override) | `GGUF_VISION_MODEL` (multimodal, `--mmproj`) |

`LLAMA_SERVER_BIN` is **not** read by `aiLlamaServerClient.ts` — it's the vision sidecar's own launcher
binary path. The deep-model client only ever *connects* (HTTP) to a server you already have running at
`LLAMA_SERVER_URL`; it never spawns a process. Both subsystems can point at the same `llama-server` binary
(you invoke it manually here; the app invokes it itself there), just for different models/ports.

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
