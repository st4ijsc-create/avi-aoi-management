# Delta robot (DRAS / DIAStudio) — Tier B (placeholder)

**Status: RAG-first, no simulation substrate yet. Examples pending vendor-manual ingestion (P1).**

Delta industrial-robot programming (DRAS / DIAStudio) has **no `programmingAdapter` kind** in
the platform, so it cannot go through `validate → sim → HIL` today. (Note: Delta **PLC** DVP/AS
standard IEC-61131 ST/LD is partially covered by the Tier A `iec61131-*` adapters at the
common-language level; Delta-specific PLC instructions and the **Delta robot** language are the
Tier B parts.) Generating Delta robot code relies on:

1. **RAG grounding** against ingested Delta manuals (DIAStudio / Delta robot programming, ASDA
   servo error codes) at `D:\SOURCES\AI Local\manuals\delta\`.
2. **Mandatory source citation** for this dialect.
3. **Human review + validation in DIAStudio / on real hardware** — not platform-gated.

Golden Delta-robot examples land here after cited manual ingestion. Until then, generated Delta
code is **not** validate-passed.

**Safety rule (unchanged):** never author E-stop / interlock / SIL logic here — that stays in
the certified controller configuration.

## Safety-linter fixtures (doc 69 Wave-4 / C4) — separate from the above

`gated-transfer.drl` (safe) and `bare-transfer.drl` (unsafe) were added for the platform's
structural **safety-linter** (`server/services/programming/safetyLinter.ts`) golden-driven
test corpus. They are **hand-authored, small, structurally-plausible** Delta-robot scripts —
**not** vendor-manual-verified RAG examples, and this remains Tier B (no `programmingAdapter`,
no `validate()` substrate) for authoring-generation purposes. Do not promote them to few-shot
generation material without the manual-verified P1 ingestion above.
