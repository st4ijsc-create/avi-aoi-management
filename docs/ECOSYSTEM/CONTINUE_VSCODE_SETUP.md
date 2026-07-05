# VS Code + Continue — ST4I Local Automation-Programming Copilot (doc 34 P3)

Connect VS Code (via the **Continue** extension) to the local AI so engineers get inline
autocomplete, in-editor chat/edit, and codebase-aware answers — all served by the app's
**OpenAI-compatible gateway** (`server/routes/openaiGateway.ts`), fully offline on the RTX 5090.

Validated live 2026-07-05 (`scripts/ai-bench/smoke-gateway.ts`, 5/5): `/v1/models`,
`/v1/chat/completions`, `/v1/completions` (FIM), `/v1/embeddings`, bearer-auth 401.

## 1. Enable the gateway (app side)
In the app `.env`:
```
OPENAI_GATEWAY_ENABLED=true
OPENAI_GATEWAY_API_KEY=<pick-a-secret>       # required; the gateway refuses to mount if empty
# OPENAI_GATEWAY_PATH=/v1                      # default
```
Restart the app. The gateway is served at `http://<app-host>:3000/v1` (the app's PORT, default 3000).
It is bearer-auth'd and intended for **localhost / trusted-LAN** engineer use only — do not expose it publicly.

## 2. Configure Continue (engineer side)
1. Install the **Continue** extension in VS Code.
2. Copy [`.continue/config.json`](../../.continue/config.json) to `~/.continue/config.json`
   (or use it as the workspace config).
3. Replace `REPLACE_WITH_OPENAI_GATEWAY_API_KEY` with the `OPENAI_GATEWAY_API_KEY` you set.
4. If the app runs elsewhere, change `apiBase` (`http://localhost:3000/v1`) accordingly.

Logical models exposed by `/v1/models`:
| Continue slot | `model` | Backs to | Use |
|---|---|---|---|
| chat / edit | `code` | Qwen3-30B-A3B (or `GGUF_CODE_MODEL`) | generate / edit / explain code |
| — | `fast` | Qwen3-4B | quick tasks |
| tabAutocomplete | `fim` | `GGUF_FIM_MODEL` else Qwen3-4B | inline completion |
| embeddings | `embed` | Qwen3-Embedding-0.6B (1024-d) | @codebase indexing |

## 3. Verify
- `curl -s http://localhost:3000/v1/models -H "Authorization: Bearer <key>"` → lists models.
- In VS Code, open Continue chat → ask "Write an IEC 61131-3 ST moving-average function block".
- Start typing ST/URScript → inline autocomplete suggestions appear.

## 4. Notes & limits
- **Autocomplete quality:** until a real fill-in-middle GGUF is set (`GGUF_FIM_MODEL`, e.g.
  Qwen2.5-Coder-1.5B), the `fim` slot falls back to the 4B model wrapped as chat — functional
  but not true FIM. Downloading a coder-FIM model (doc 34 D2 / P4) sharpens it.
- **First request is slow** (~8-40s) while the 30B loads on the GPU; subsequent calls are fast
  (30B ~212-246 tok/s, 4B ~264-276 tok/s — see `scripts/ai-bench/baselines/`).
- **Safety:** the gateway's system message forbids AI-authored safety functions; regardless,
  every generated PLC/robot/Zmotion program MUST be engineer-reviewed and simulated before
  running on real equipment. The in-app copilot additionally routes generated code through
  `programmingAdapter.validate` (see doc 34 §Nhật ký thực thi P2).
- **Manual RAG:** in-editor Continue chat is general; for vendor-manual-grounded answers with
  page citations (Mitsubishi/Delta/Omron/Fanuc/UR/Zmotion), use the in-app Programming Copilot
  (`programming.copilotGenerate`) which is wired to the programming knowledge base.
