# Fanuc KAREL / TP — Tier B (placeholder)

**Status: RAG-first, no simulation substrate yet. Examples pending vendor-manual ingestion (P1).**

Per doc 34 §VI-bis, the D7 mapping puts Fanuc **KAREL / TP** in **Tier B**: the platform's
Fanuc driver is telemetry-only (a scaffold), so there is **no `programmingAdapter` kind** that
can `validate → simulate → HIL` KAREL/TP today. Generating KAREL therefore relies on:

1. **RAG grounding** against the Fanuc manuals ingested in P1 (KAREL Reference, TP Programming,
   R-30iB alarm/error-code list) — placed at `D:\SOURCES\AI Local\manuals\fanuc\`.
2. **Mandatory source citation** (this is a rare dialect — the copilot must cite the manual page
   rather than free-hallucinate).
3. **Human review + on-controller validation** in the vendor toolchain (ROBOGUIDE / the real
   R-30iB) — the platform cannot yet gate it.

Golden KAREL/TP examples will be added here **after** manual ingestion yields verified, cited
snippets. Until then, do **not** treat generated KAREL as validate-passed.

**Safety rule (unchanged):** no E-stop / interlock / SIL / DCS safety-zone logic is ever
authored here — that stays in the certified Fanuc safety configuration.

## Safety-linter fixtures (doc 69 Wave-4 / C4) — separate from the above

`bounded-index-loop.ls` (safe) and `unbounded-index-loop.ls` (unsafe) were added for the
platform's structural **safety-linter** (`server/services/programming/safetyLinter.ts`)
golden-driven test corpus. They are **hand-authored, small, structurally-plausible** TP
listings — **not** vendor-manual-verified RAG examples, and this remains Tier B (no
`programmingAdapter`, no `validate()` substrate) for authoring-generation purposes. Do not
promote them to few-shot generation material without the manual-verified P1 ingestion above.
