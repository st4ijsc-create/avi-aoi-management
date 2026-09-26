# 73 — Local Video Transcription Ingest Runbook (ffmpeg + whisper.cpp)

**doc69 Giai đoạn 5 / Wave E3, task E3-4, 2026-07-27.** Scope: **CODE + RUNBOOK**. No live
ffmpeg/whisper.cpp transcription was run to produce this doc — `child_process` is fully **mocked**
in the test suite (command construction, shell-injection safety, and every fail-safe path are
verified without a real binary). Actually installing the two binaries + a model and running a real
transcription is the **ops step**, documented below (§3-§5).

## 1. What this is

The third Knowledge & Training Studio ingest source (after E3-1 document upload and E3-3 URL
ingest): an operator hands the platform a **video file**, and it becomes searchable text in a
corpus — 100% locally, no cloud STT API, no egress.

```
video (buffer/path) ──ffmpeg──▶ 16kHz mono wav ──whisper.cpp──▶ plain-text transcript
                                                                         │
                                                                         ▼
                                                      kbIngestService.ingestDocument
                                                      (sourceType:"video" — parse[pass-through]
                                                       → chunk → embed → store, table
                                                       kb_studio_chunks, same pipeline as E3-1/E3-3)
```

Both `ffmpeg` and `whisper.cpp` are **external binaries** spawned locally (never over a shell
string — see §6), reading model weights from disk. Neither performs any network I/O of its own;
this file (`server/services/kbVideoTranscriber.ts`) contains no `fetch`/`http`/`https` import at
all — there is no code path here that can reach the network, cloud or otherwise.

## 2. Files

| File | Role |
|---|---|
| `server/services/kbVideoTranscriber.ts` | `transcribeVideo` (ffmpeg extract → whisper.cpp transcribe) + `ingestVideo` (wires the transcript into E3-1's `ingestDocument`). |
| `server/services/kbVideoTranscriber.test.ts` | Command construction, shell-injection safety, fail-safe (unset config / ENOENT / non-zero exit / timeout) + temp-file cleanup, gating, wiring — all with `child_process` mocked. |
| `server/services/kbDocParser.ts` | `"video"` source-type case added (pass-through, mirrors `"url"` from E3-3) — the transcript is already plain text by the time it reaches this file. |
| `server/routers/kbIngestRouter.ts` | `ingestVideo` mutation (base64 payload, admin/engineer + 2FA, `VIDEO_INGEST_ENABLED` + `KB_STUDIO_ENABLED` gated) + `status` query fields `videoIngestEnabled`/`maxVideoUploadBytes`. |

## 3. Install the two binaries + a model (the ops step)

### ffmpeg

Any recent ffmpeg build works (only used for `-i <in> -t <cap> -vn -ac 1 -ar 16000 -f wav <out>`
— container demux + audio resample, no video decode needed beyond that).

- **Windows:** download a static build from https://www.gyan.dev/ffmpeg/builds/ (or
  `winget install Gyan.FFmpeg` / `choco install ffmpeg`), note the path to `ffmpeg.exe`.
- **Linux:** `apt-get install ffmpeg` / `dnf install ffmpeg`, then `which ffmpeg`.
- **macOS:** `brew install ffmpeg`, then `which ffmpeg`.

### whisper.cpp

Build from source (fastest local inference, no Python dependency):

```bash
git clone https://github.com/ggml-org/whisper.cpp
cd whisper.cpp
cmake -B build
cmake --build build --config Release
# The CLI binary lands at build/bin/whisper-cli (recent whisper.cpp) or build/bin/main
# (older checkouts before the examples were renamed) — either works, WHISPER_BIN just needs
# to point at whichever one your checkout produced.
```

On a machine with an NVIDIA GPU, add `-DGGML_CUDA=ON` to the `cmake -B build` step for CUDA
acceleration (mirrors the GPU stack already used by the platform's other local-LLM sidecars —
see doc 70). CPU-only works too, just slower.

### A whisper model (GGUF/ggml)

Download a ggml model from the whisper.cpp project (Hugging Face
`ggerganov/whisper.cpp` repo, or the repo's `models/download-ggml-model.sh` script):

```bash
./models/download-ggml-model.sh base    # good default: fast, decent accuracy
# or: small / medium / large-v3 for better accuracy at more compute cost
# multilingual models (no ".en" suffix) are REQUIRED for language:"auto" or non-English audio —
# an ".en"-suffixed model (e.g. "base.en") only transcribes English and ignores -l entirely.
```

This writes e.g. `models/ggml-base.bin` — that path is `WHISPER_MODEL`.

## 4. Env vars — nothing is hardcoded

| Var | Required | Default | Meaning |
|---|---|---|---|
| `WHISPER_BIN` | **yes** | — (unset ⇒ feature inert) | Absolute path to the whisper.cpp CLI binary (`whisper-cli` or `main`). |
| `WHISPER_MODEL` | **yes** | — (unset ⇒ feature inert) | Absolute path to a ggml/GGUF whisper model file. |
| `FFMPEG_BIN` | **yes** | — (unset ⇒ feature inert) | Absolute path to the `ffmpeg` binary. |
| `VIDEO_INGEST_ENABLED` | no | `false` | Master feature flag — mirrors E3-3's `WEB_INGEST_ENABLED`. Must be `true`/`1` for `ingestVideo` to do anything. |
| `KB_STUDIO_ENABLED` | no | `false` | Also required (shared with E3-1/E3-3) — both flags are checked before any sidecar work. |
| `VIDEO_INGEST_MAX_BYTES` | no | `524288000` (500MB) | Hard cap on the input video size (buffer length or on-disk file size), checked BEFORE writing any temp file or spawning ffmpeg. |
| `VIDEO_INGEST_MAX_DURATION_SEC` | no | `3600` (1h) | Passed to ffmpeg as `-t <sec>` — bounds the EXTRACTED audio duration regardless of the source video's real length (defense-in-depth against a huge/looping file that slipped past the byte cap). |
| `VIDEO_INGEST_FFMPEG_TIMEOUT_MS` | no | `300000` (5min) | Wall-clock timeout for the ffmpeg extraction step. |
| `VIDEO_INGEST_WHISPER_TIMEOUT_MS` | no | `1800000` (30min) | Wall-clock timeout for the whisper.cpp transcription step (CPU-only hosts can be slow). |
| `VIDEO_INGEST_MAX_TEXT_CHARS` | no | `2000000` | Bound on the transcript text length, mirrors `KB_PARSE_MAX_CHARS`/`WEB_INGEST_MAX_CHARS`. |
| `KB_INGEST_MAX_VIDEO_UPLOAD_BYTES` | no | `314572800` (300MB) | Router-layer cap on the DECODED base64 video payload (`kbIngestRouter.ingestVideo`) — independent knob from `VIDEO_INGEST_MAX_BYTES` (defense-in-depth, same layering as `KB_INGEST_MAX_UPLOAD_BYTES` for documents). |

All three of `WHISPER_BIN`/`WHISPER_MODEL`/`FFMPEG_BIN` must be set for the feature to work at
all — if any is missing, `transcribeVideo` throws `SttUnavailableError("local STT not configured
— set WHISPER_BIN/FFMPEG_BIN + WHISPER_MODEL")` before touching any sidecar. The SAME error is
thrown if a configured binary path doesn't actually exist (the spawn attempt fails with ENOENT) —
to the caller, "not configured" and "configured but missing" look identical, which is the honest
signal an operator needs either way.

## 5. Expected wav format + the live-run ops step

whisper.cpp expects **16kHz, mono, 16-bit PCM WAV** input — this is exactly what
`transcribeVideo`'s ffmpeg invocation produces (`-ac 1 -ar 16000 -f wav`), so no manual
conversion is needed when going through the platform. To sanity-check the two binaries manually
before flipping the flags on:

```bash
# 1) Extract audio (mirrors the exact args transcribeVideo builds):
ffmpeg -y -i sample-video.mp4 -t 3600 -vn -ac 1 -ar 16000 -f wav sample.wav

# 2) Transcribe (mirrors transcribeVideo's whisper.cpp args):
whisper-cli -m models/ggml-base.bin -f sample.wav -l auto -otxt -of sample -nt
cat sample.txt   # the transcript
```

If both commands work from a shell, set `FFMPEG_BIN`/`WHISPER_BIN`/`WHISPER_MODEL` to the
absolute paths used above, set `VIDEO_INGEST_ENABLED=true` and `KB_STUDIO_ENABLED=true`, restart
the server, and call the endpoint (admin/engineer session with 2FA):

```ts
await trpc.kbIngest.ingestVideo.mutate({
  corpus: "vendor-x-training",
  filename: "onboarding.mp4",
  base64: fs.readFileSync("onboarding.mp4").toString("base64"),
  language: "auto", // or e.g. "vi", "en"
});
```

Check `trpc.kbIngest.status.query()` first — it reports `videoIngestEnabled` and
`maxVideoUploadBytes` alongside the existing `enabled`/`webIngestEnabled` fields, so you can
confirm the flags actually took effect without guessing.

## 6. Shell-injection safety (why this is safe to expose to an operator-supplied filename)

Every sidecar call goes through `execFile` (Node's `child_process.execFile`, promisified) with an
**argument ARRAY** — never `exec` with a concatenated shell string, and `shell:true` is never
set anywhere in `kbVideoTranscriber.ts`. That means an argv element can contain `; rm -rf /`,
`` `touch pwned` ``, `$(id)`, spaces, or unicode and it is handed to the OS as ONE opaque
argument — there is no shell metacharacter parsing step for it to escape through.

Two specific defenses beyond "use execFile with an array":

1. **The caller-supplied filename is never used to build a path.** Every temp file this module
   writes uses a `crypto.randomUUID()`-generated name; the filename only contributes a short,
   allow-listed (`[a-z0-9]{1,8}`, else falls back to `"bin"`) extension hint via
   `sanitizeExtension` — purely cosmetic help for ffmpeg's format probing, not something the
   temp path's safety depends on.
2. **Temp files live under a fixed repo directory** (`uploads/tmp/video-ingest/`, gitignored),
   never wherever a caller-influenced string might point.

Verified by `kbVideoTranscriber.test.ts`'s "shell-injection safety" suite: filenames like
`"; rm -rf / #.mp4"`, `"$(id).mov"`, `` "`touch pwned`.mp4" ``, and unicode names are fed through
`transcribeVideo`, and every resulting argv element is asserted to be either a fixed CLI flag, a
config value, or a `uuid-input.<ext>` generated path — the raw malicious string never appears.

## 7. Fail-safe error taxonomy

| Error | When | Router HTTP-ish code |
|---|---|---|
| `SttUnavailableError` | `WHISPER_BIN`/`WHISPER_MODEL`/`FFMPEG_BIN` unset, OR a configured binary can't be spawned (ENOENT). | `SERVICE_UNAVAILABLE` |
| `SttValidationError` | No buffer/path given, empty input, or input exceeds `VIDEO_INGEST_MAX_BYTES`. | `BAD_REQUEST` |
| `SttTranscribeError` | Non-zero exit code, a timeout, ffmpeg produced no/empty wav, or whisper.cpp produced no transcript file. | `INTERNAL_SERVER_ERROR` |
| `VideoIngestDisabledError` | `VIDEO_INGEST_ENABLED` and/or `KB_STUDIO_ENABLED` is off. | `FORBIDDEN` |

Every temp file this module writes (the buffer-sourced input copy, the extracted wav, the
transcript txt) is unlinked in a `finally` — on success, on validation failure, on a sidecar
failure, and on a timeout. A caller-supplied on-disk `path` (as opposed to a `buffer`) is never
deleted — that file is caller-owned.

## 8. No-cloud / no-egress guarantee

- `kbVideoTranscriber.ts` imports only `node:child_process`, `node:util`, `node:crypto`,
  `node:fs`, `node:path`, and the local `./kbIngestService` — no HTTP client, no cloud SDK.
- ffmpeg and whisper.cpp are spawned as local processes reading local files; neither is passed
  any network-facing flag by this integration.
- The transcript never leaves the process boundary until it reaches `ingestDocument`, which
  itself only touches the local embedding model (`aiGgufEngine`, already-local per doc 03/04)
  and the local Postgres/pgvector store (`kbVectorStore`).

This replaces the "cloud STT stub" the doc69 audit flagged — the old assumption that
transcription meant an external API call no longer holds for this ingest path.

## 9. What's code vs. what's the live ops step

**Built (this task):** the ffmpeg→whisper.cpp pipeline, shell-injection-safe command
construction, the fail-safe/bounds/cleanup discipline, the `VIDEO_INGEST_ENABLED`+
`KB_STUDIO_ENABLED`+admin/engineer+2FA gated `ingestVideo` endpoint, the `kbDocParser` "video"
pass-through case, and 37+16 unit tests with `child_process` fully mocked.

**Not done here (ops):** installing ffmpeg + whisper.cpp + a model on a target host, setting the
three required env vars, flipping the two flags on, and running a REAL transcription end-to-end
against a real video. §5 above is the exact command sequence to do that.
