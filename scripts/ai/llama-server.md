# Persistent llama-server for the deep model (doc 48 R5)

**Goal:** run the deep generative model (exec-summary, ops-chat, RCA) in a
separate, always-warm `llama-server` process that owns its own VRAM, instead of
loading it in-process where it fights the resident embedder for the GPU. This
makes **live generation** work again (no more "offline template" degradation)
**without buying more VRAM** — the deep model + the small embedder are sized to
co-reside on the existing 32 GB card.

## Why

The API process keeps the embedder (`GGUF_EMBED_MODEL`, ~1–2 GB) resident for
RAG. Loading the ~17 GB deep model in the *same* process on demand routinely
loses the VRAM race → `getOrLoadModel` fails → exec-summary/chat fall back to the
honest offline template. Moving the deep model to a dedicated server that loads
it **once** and holds it removes the contention: the API only ever holds the
embedder; the deep model lives in llama-server.

```
┌────────────── API process (node) ─────────────┐        ┌──── llama-server ────┐
│  embedder (mxbai, in-process, ~1.5 GB VRAM)    │  HTTP  │  deep model (Qwen3,  │
│  aiGgufEngine.generateText/JSON  ───────────────┼──────▶│  ~17 GB, always warm)│
│    └─ routes deep model → server (this doc)    │ /v1/…  │  OpenAI-compatible   │
└────────────────────────────────────────────────┘        └──────────────────────┘
```

## 1. Build / get `llama-server` (llama.cpp, CUDA)

Use a CUDA build of llama.cpp so the model runs on the GPU. Either download a
CUDA release of llama.cpp or build it:

```bash
# build (needs CUDA toolkit + cmake)
git clone https://github.com/ggml-org/llama.cpp && cd llama.cpp
cmake -B build -DGGML_CUDA=ON
cmake --build build --config Release -j
# → build/bin/llama-server
```

## 2. Launch the server with the deep model

Point it at the SAME `.gguf` the app uses (`uploads/gguf-models/<GGUF_DEFAULT_MODEL>.gguf`).
`-ngl 999` offloads all layers to GPU; set `--ctx-size` to your deep context.
`--api-key` is optional but recommended (then set `LLAMA_SERVER_API_KEY`).

```bash
./llama-server \
  --model /path/to/uploads/gguf-models/<GGUF_DEFAULT_MODEL>.gguf \
  --host 127.0.0.1 --port 8080 \
  -ngl 999 --ctx-size 8192 \
  --parallel 2 --cont-batching \
  --api-key "$LLAMA_SERVER_API_KEY"      # optional
```

**VRAM budget (32 GB card):** deep model ~17 GB + KV cache for ctx 8192 ×
parallel 2 (~2–4 GB) + the API's resident embedder ~1.5 GB → comfortably < 32 GB.
If you raise `--ctx-size`/`--parallel` and approach the limit, lower them or drop
the embedder to a smaller GGUF. No second GPU required.

Run it under a supervisor so it stays up (systemd unit, `pm2 start`, a Windows
service, or a container with `restart: unless-stopped`).

## 3. Point the API at it

In the API process env (`.env`):

```ini
LLAMA_SERVER_ENABLED=true
LLAMA_SERVER_URL=http://127.0.0.1:8080
# LLAMA_SERVER_MODEL=            # defaults to GGUF_DEFAULT_MODEL basename
# LLAMA_SERVER_API_KEY=...       # only if you started the server with --api-key
# LLAMA_SERVER_STRICT=false      # true → no in-process fallback (honest offline template instead)
```

Only **text generation for the served model** is routed to the server. Embeddings,
vision, and the code/fast models stay in-process. With `LLAMA_SERVER_STRICT=false`
(default) a server outage silently falls back to the in-process path; with
`=true` the engine throws and the caller shows its honest offline template rather
than risk a slow/contended in-process load.

## 4. Verify

```bash
# server health
curl -s http://127.0.0.1:8080/health

# a direct generation
curl -s http://127.0.0.1:8080/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"Reply with OK"}],"max_tokens":8}'

# end-to-end wiring (routing/parse/strict/scope) — mock server, no GPU needed:
npx tsx scripts/verify/llama-server-proof.mts
```

When live, exec-summary / ops-chat produce real narratives instead of the offline
template, and the API's VRAM footprint stays flat (embedder only) because the deep
model no longer loads in-process.

## Notes

- **Streaming:** `generateText`/`generateJSON` (exec-summary, insight JSON, chat)
  route to the server. The token-streaming narrative path is unchanged in this
  wave (still in-process) — enable server streaming in a follow-up if needed.
- **Multiple tiers:** one llama-server serves ONE model. To also serve the
  code/fast/thinking tiers out-of-process, run additional servers and extend
  `LLAMA_SERVER_MODEL` routing — out of scope here.
- **Rollback:** unset `LLAMA_SERVER_ENABLED` → the engine reverts to the exact
  in-process behaviour, no redeploy needed.
