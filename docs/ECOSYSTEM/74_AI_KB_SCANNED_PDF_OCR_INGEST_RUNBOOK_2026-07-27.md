# 74 — Scanned-PDF OCR Ingest Runbook (pdftoppm + the existing ONNX OCR engine)

**doc69 Giai đoạn 5 / Wave E3, task E3-5, 2026-07-27.** Scope: **CODE + RUNBOOK**. No live
pdftoppm render or ONNX OCR inference was run to produce this doc — `child_process` (the
pdftoppm sidecar) AND `server/services/ai/ocrService.ts` (the OCR engine itself) are both fully
**mocked** in the test suite (command construction, shell-injection safety, density detection,
and every fail-safe path are verified without a real binary or model). Actually installing
poppler + the ONNX OCR models and running a real OCR pass is the **ops step**, documented below
(§3-§6).

## 1. What this is

`kbDocParser.parsePdf` (E3-1) extracts text from a PDF via `pdf-parse`, which returns **nothing**
(or near-nothing) for a **scanned/image-only PDF** — a PDF whose pages are just images, with no
text layer at all (e.g. a paper manual run through a photocopier/scanner and saved as PDF). E3-5
detects that case and OCRs the page images through the **already-existing**
`server/services/ai/ocrService.ts` engine (ONNX PaddleOCR/RapidOCR, built for doc44 W5-B2 §8.1
label/barcode checks) — **no new OCR engine was built for this task**.

```
PDF buffer ──pdf-parse──▶ text + pageCount
                             │
                             ▼
                  density = chars ÷ pageCount
                             │
                 ┌───────────┴───────────┐
          density ≥ threshold      density < threshold (scanned)
                 │                        │
        return pdf-parse text    KB_OCR_ENABLED AND OCR_ENGINE_ENABLED
        AS-IS (unchanged)        AND models available AND PDFTOPPM_BIN set?
                                          │
                                ┌─────────┴─────────┐
                               yes                   no / fails
                                │                     │
                    pdftoppm renders each      return the ORIGINAL
                    page → PNG (injection-     (possibly empty) pdf-parse
                    safe sidecar) → ocrService  text, meta.scannedNoOcr:true
                    .runOcr PER PAGE →          (honest — never fabricated)
                    concatenate → meta.ocrUsed:true
```

## 2. Files

| File | Role |
|---|---|
| `server/services/kbPdfOcr.ts` | `ocrScannedPdf` (render pages via pdftoppm → OCR each via the existing `ocrService.runOcr`) + `isKbOcrEnabled`/`isKbPdfOcrAvailable` (the double-gate). Does **not** reimplement OCR. |
| `server/services/kbPdfOcr.test.ts` | Command construction, shell-injection safety, fail-safe (disabled / models unavailable / `PDFTOPPM_BIN` unset / ENOENT / a page render-or-OCR failure), bounds (`KB_OCR_MAX_PAGES`, total timeout), and temp-file cleanup — `node:child_process` AND `./ai/ocrService` both mocked. |
| `server/services/kbDocParser.ts` | `parsePdf` extended: after `pdf-parse` extraction, computes text density and — only when it's below the threshold — calls `kbPdfOcr.ocrScannedPdf`. A normal (text-dense) PDF's code path is unchanged. |
| `server/services/kbDocParser.test.ts` | New "scanned-PDF OCR wiring" describe block: density detection routes correctly, meta flags (`ocrUsed`/`scannedNoOcr`/`ocrPagesProcessed`) are correct, normal-PDF path is unaffected. `./kbPdfOcr` is mocked here (its own internals are covered in kbPdfOcr.test.ts). |
| `server/services/ai/ocrService.ts` | **Unmodified** — the existing ONNX OCR engine (`isOcrEngineEnabled`/`ocrModelsAvailable`/`ocrModelPaths`/`runOcr`), reused as-is. |

## 3. Install poppler (pdftoppm) — the ops step

Any recent poppler-utils build works (`pdftoppm` renders one PDF page to a raster image; this
integration only uses `-png -r <dpi> -f <page> -l <page> -singlefile <in.pdf> <out-prefix>`).

- **Windows:** download a poppler-for-Windows release (e.g.
  https://github.com/oschwartz10612/poppler-windows/releases — ships `pdftoppm.exe` in `Library/bin`),
  or `choco install poppler`. Note the full path to `pdftoppm.exe`.
- **Linux:** `apt-get install poppler-utils` / `dnf install poppler-utils`, then `which pdftoppm`.
- **macOS:** `brew install poppler`, then `which pdftoppm`.

Sanity-check from a shell before wiring the env var:

```bash
pdftoppm -png -r 200 -f 1 -l 1 -singlefile sample-scanned.pdf /tmp/page1
ls /tmp/page1.png   # should exist
```

## 4. Install the ONNX OCR models — the ops step (same models `ocrService.ts` already expects)

This task does **not** introduce a new model requirement — it reuses whatever `OCR_ENGINE_ENABLED`
already needs for AOI vision label/barcode checks (doc44 W5-B2 §8.1, doc45 ADDENDUM 3). If OCR is
already enabled+working for AOI vision on this host, **skip this section** — KB OCR reuses the
exact same models.

If not yet installed: download a RapidOCR/PaddleOCR ONNX export (recognition model + character
dictionary; detection model is optional — `ocrService.ts` runs single-line recognition on the
whole page image when no detection model is present, which is adequate for a full scanned page
rendered at a reasonable DPI) from the RapidOCR GitHub releases
(https://github.com/RapidAI/RapidOCR), and place them at:

```
models/ocr/rec.onnx           # required — text-recognition model (CRNN-CTC)
models/ocr/ppocr_keys.txt     # required — character dictionary for CTC decode
models/ocr/det.onnx           # optional — text-detection model
```

(or point `OCR_MODEL_DIR`/`OCR_ONNX_REC_MODEL`/`OCR_ONNX_DICT`/`OCR_ONNX_DET_MODEL` at wherever
they actually live — nothing is hardcoded, see `ocrModelPaths()` in `ocrService.ts`).

## 5. Env vars — nothing is hardcoded

### Reused from `ocrService.ts` (already existed — E3-5 does not add or change these)

| Var | Default | Meaning |
|---|---|---|
| `OCR_ENGINE_ENABLED` | `false` | ocrService's own master flag. **Must be `true`** for KB OCR to run at all (see §6). |
| `OCR_MODEL_DIR` | `<cwd>/models/ocr` | Base dir for the default model file locations. |
| `OCR_ONNX_REC_MODEL` | `<OCR_MODEL_DIR>/rec.onnx` | Recognition model path. |
| `OCR_ONNX_DICT` | `<OCR_MODEL_DIR>/ppocr_keys.txt` | Character dictionary path. |
| `OCR_ONNX_DET_MODEL` | `<OCR_MODEL_DIR>/det.onnx` | Detection model path (optional — absent ⇒ single-line recognition on the whole image). |
| `OCR_REC_HEIGHT` | `48` | Recognition input height. |
| `OCR_BLANK_INDEX` | `0` | CTC blank class index. |

### New for E3-5

| Var | Required | Default | Meaning |
|---|---|---|---|
| `PDFTOPPM_BIN` | **yes** | — (unset ⇒ feature inert) | Absolute path to the `pdftoppm` binary (§3). |
| `KB_OCR_ENABLED` | no | `false` | KB-ingest-specific gate — mirrors E3-3/E3-4's `WEB_INGEST_ENABLED`/`VIDEO_INGEST_ENABLED`. **Both** this AND `OCR_ENGINE_ENABLED` must be `true`/`1` (see §6). |
| `KB_OCR_SCANNED_DENSITY_THRESHOLD` | no | `20` | chars ÷ pageCount below which a PDF is treated as scanned/image-only. A real text page is typically 1000+ chars, so 20 is a wide, safe margin — tune down if a real (unusually sparse, e.g. mostly-diagram) text PDF is ever mistakenly flagged as scanned, tune up to be more aggressive about routing borderline PDFs to OCR. |
| `KB_OCR_MAX_PAGES` | no | `30` | Hard cap on how many pages are ever rendered/OCR'd for one document, regardless of the PDF's actual page count. |
| `KB_OCR_RENDER_DPI` | no | `200` | Resolution passed to `pdftoppm -r`. Higher improves OCR accuracy on small text at the cost of render/inference time; 200-300 is a reasonable range for a scanned manual page. |
| `KB_OCR_RENDER_TIMEOUT_MS` | no | `30000` (30s) | Wall-clock timeout for a single `pdftoppm` render call. |
| `KB_OCR_PAGE_TIMEOUT_MS` | no | `45000` (45s) | Wall-clock timeout for a single page's `ocrService.runOcr` call. |
| `KB_OCR_TOTAL_TIMEOUT_MS` | no | `180000` (3min) | Overall wall-clock budget for the whole `ocrScannedPdf` call, checked between pages — the page already being processed always completes (best-effort), but no further pages start once the budget is exhausted. |

`KB_STUDIO_ENABLED` (shared with E3-1/E3-3/E3-4) must also be on for the ingest endpoint itself
to be reachable — E3-5 adds no new endpoint; it runs entirely inside the already-gated
`uploadDocument` → `ingestDocument` → `parseDocument` → `parsePdf` call chain.

## 6. The double-gate, and why

```
KB OCR runs  ⟺  OCR_ENGINE_ENABLED=true  AND  KB_OCR_ENABLED=true
                 AND ocrModelsAvailable()  AND  PDFTOPPM_BIN set (and spawnable)
```

`OCR_ENGINE_ENABLED` is the pre-existing master flag that also governs AOI vision label/barcode
checks (`aiAdvancedVision.ts`). If a site has already turned that on for production vision
inspection, E3-5 deliberately does **not** piggyback on it alone — `KB_OCR_ENABLED` is a
**separate, KB-ingest-specific** flag (default OFF) so enabling OCR for AOI vision never
*silently* starts OCRing every scanned PDF an operator uploads to the Knowledge & Training
Studio. Both must be explicitly turned on.

## 7. Density detection — why a normal text PDF is unaffected

`parsePdf` always runs `pdf-parse` first, exactly as before E3-5. It then computes
`density = extractedText.length / pageCount`. A normal text PDF (a vendor manual exported from
Word/InDesign, a datasheet, etc.) has thousands of characters per page — its density is always
far above `KB_OCR_SCANNED_DENSITY_THRESHOLD` (default 20), so the OCR branch — and every import
it would pull in (`kbPdfOcr.ts`, transitively `ocrService.ts`) — is **never reached** for it. The
pre-E3-5 code path (extract → bound → return) is byte-for-byte unchanged for every normal PDF.

Only a PDF whose pdf-parse extraction comes back empty or near-empty (a genuinely scanned/
image-only PDF, or a PDF pdf-parse simply fails to extract meaningfully from) crosses the
threshold and triggers the OCR attempt.

## 8. Fail-safe error taxonomy (kbPdfOcr.ts)

| Condition | Result |
|---|---|
| `KB_OCR_ENABLED` off (default) | `ocrScannedPdf` returns `{ text: "", ocrUsed: false, ... }` immediately — no `pdftoppm` spawn, no `ocrService` import. |
| `OCR_ENGINE_ENABLED` off | Same — `ocrService.isOcrEngineEnabled()` gates before any render. |
| ONNX models absent on disk | Same — `ocrService.ocrModelsAvailable()` gates before any render. |
| `PDFTOPPM_BIN` unset | Same — never even attempts a spawn. |
| `PDFTOPPM_BIN` set but the binary doesn't exist (ENOENT on spawn) | The FIRST page's render throws `KbOcrUnavailableError`; the loop stops immediately (every subsequent page would fail identically) — `ocrUsed:false`. |
| A specific page's render fails (non-zero exit) or `runOcr` throws/degrades for that page | Caught per-page (`KbOcrRenderError` or any other exception) — **best-effort**: the loop continues to the next page. If **every** page ends up failing, the overall result is still `ocrUsed:false`. |
| `KB_OCR_MAX_PAGES` / `KB_OCR_TOTAL_TIMEOUT_MS` reached | Stops early with whatever pages were already OCR'd (best-effort) — `ocrUsed:true` if at least one page produced text, else `false`. |

In every "not used" case, `kbDocParser.parsePdf` returns the **original pdf-parse text**
(possibly empty) with `meta.ocrUsed: false` and `meta.scannedNoOcr: true` — never a crash, never
fabricated text. Downstream, `kbIngestService.ingestDocument` already rejects a document that
produces **zero** extractable text (`KbIngestValidationError` — "produced no extractable text"),
which is the existing, correct behavior for a genuinely-empty scanned PDF with OCR unavailable:
the operator gets an honest error, not a silently-empty corpus entry.

## 9. Shell-injection safety

Every `pdftoppm` invocation goes through `execFile` (Node's `child_process.execFile`,
promisified) with an **argument ARRAY** — never `exec` with a concatenated shell string, and
`shell: true` is never set anywhere in `kbPdfOcr.ts` (mirrors E3-4's `kbVideoTranscriber.ts`
`runSidecar` exactly). Unlike the video-ingest path, there isn't even a caller-supplied
*filename* here — `ocrScannedPdf(pdfBuffer, pageCountHint, opts)` takes no filename parameter at
all. The **only** things that ever become argv elements are: fixed CLI flags (`-png`, `-r`,
`-f`, `-l`, `-singlefile`), small bounded numbers (the configured DPI, the current page index —
both always numeric and loop-bounded by `KB_OCR_MAX_PAGES`), and two paths built from a fixed
temp directory (`uploads/tmp/kb-ocr/`) plus a `crypto.randomUUID()` — never anything derived
from the PDF's bytes or any other caller-controlled string.

Verified by `kbPdfOcr.test.ts`'s "shell-injection safety" suite: a PDF buffer whose bytes
literally contain `; rm -rf / #`, `` $(id) ``, `` `touch pwned` ``, and unicode is fed through
`ocrScannedPdf`, and every resulting argv element is asserted to be either a fixed flag, a
numeric value, or a `<tempDir>/<uuid>-...` generated path — none of the malicious byte sequences
ever appear in argv, and the mocked `execFile` call is asserted to carry no `shell:true` option.

## 10. Bounds + cleanup

- `KB_OCR_MAX_PAGES` (default 30) caps the number of pages ever rendered/OCR'd for one document,
  independent of the PDF's actual page count.
- `KB_OCR_RENDER_TIMEOUT_MS` (default 30s) bounds each `pdftoppm` call via `execFile`'s native
  `timeout`; `KB_OCR_PAGE_TIMEOUT_MS` (default 45s) bounds each `ocrService.runOcr` call.
- `KB_OCR_TOTAL_TIMEOUT_MS` (default 3min) bounds the whole multi-page routine, checked after
  each page completes (so the in-flight page always finishes — best-effort with whatever text
  was gathered rather than an abrupt kill mid-page).
- Every temp file this module creates — the written-out PDF copy (`<uuid>-input.pdf`) and each
  page's rendered PNG (`<uuid>-p<N>.png`), all under `uploads/tmp/kb-ocr/` (gitignored via the
  root `tmp/` pattern) — is unlinked in a `finally`, on every exit path (success, a page
  failure, a setup failure, or the total-timeout early exit).

## 11. The live-verify ops step

Once poppler + the models are installed and the env vars set:

```bash
# 1) Sanity-check pdftoppm directly (mirrors the exact args ocrScannedPdf builds, one page):
pdftoppm -png -r 200 -f 1 -l 1 -singlefile scanned-manual.pdf /tmp/kb-ocr-check

# 2) Confirm OCR itself already works for AOI vision (if not already verified — see doc45
#    ADDENDUM 3 / doc44 W5-B2): run any existing checkLabel/runOcr call against /tmp/kb-ocr-check.png
#    and confirm it returns real recognized text with engine:"onnx" (not degraded).

# 3) Set env + restart the server:
export PDFTOPPM_BIN=/usr/bin/pdftoppm   # from step 1
export OCR_ENGINE_ENABLED=true          # if not already on for AOI vision
export KB_OCR_ENABLED=true
export KB_STUDIO_ENABLED=true           # if not already on

# 4) Upload a genuinely scanned/image-only PDF through the Studio ingest endpoint (admin/
#    engineer session with 2FA):
```

```ts
const result = await trpc.kbIngest.uploadDocument.mutate({
  corpus: "vendor-manuals",
  sourceRef: "scanned-manual.pdf",
  mimeOrExt: "pdf",
  base64: fs.readFileSync("scanned-manual.pdf").toString("base64"),
});
console.log(result.parsedMeta); // { sourceType:"pdf", ocrUsed:true, ocrPagesProcessed:N, ... }
```

If `parsedMeta.ocrUsed` is `true` and `result.chunksAdded > 0`, the scanned PDF was OCR'd and
ingested end-to-end. If it's `false` with `scannedNoOcr:true` instead, double-check
`OCR_ENGINE_ENABLED`/`KB_OCR_ENABLED`/`PDFTOPPM_BIN` and the server logs for which precondition
failed (§8's taxonomy).

## 12. No-cloud / no-egress guarantee

`kbPdfOcr.ts` imports only `node:child_process`, `node:util`, `node:crypto`, `node:fs`,
`node:path`, and (dynamically, only once every gate above has already passed) the local
`./ai/ocrService.ts`. `pdftoppm` renders a local PDF file to a local PNG with no network access
of its own; `ocrService.ts`'s ONNX inference (`onnxruntime-node`) runs fully on-host. Nothing in
this ingest path calls out to a cloud OCR API.

## 13. What's code vs. what's the live ops step

**Built (this task):** the pdftoppm→ocrService pipeline (`kbPdfOcr.ts`), the density-detection
wiring in `kbDocParser.parsePdf`, shell-injection-safe command construction, the fail-safe/
bounds/cleanup discipline, the `OCR_ENGINE_ENABLED` + `KB_OCR_ENABLED` double gate, and 49 unit
tests (26 in `kbPdfOcr.test.ts` + 23 in `kbDocParser.test.ts`, 5 of which are new E3-5 wiring
tests) with `child_process` and `ocrService` both fully mocked.

**Not done here (ops):** installing `poppler`/`pdftoppm` + the ONNX OCR models on a target host,
setting `PDFTOPPM_BIN`/`OCR_ENGINE_ENABLED`/`KB_OCR_ENABLED`, and running a REAL OCR pass against
a real scanned PDF end-to-end. §11 above is the exact command/mutation sequence to do that.
