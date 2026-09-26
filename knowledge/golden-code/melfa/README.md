# Mitsubishi MELFA-BASIC V/VI — Tier B (placeholder)

**Status: RAG-first, no simulation substrate yet. Examples pending vendor-manual ingestion (P1).**

Mitsubishi **MELFA-BASIC V/VI** is the robot-teach language for MELFA arms — **distinct from**
the `mitsubishi-engineering` adapter, which handles MELSEC **PLC** device/recipe tables, **not**
MELFA robot programs. There is **no `programmingAdapter` kind** for MELFA, so it cannot be
validated/simulated by the platform today. Generating MELFA relies on:

1. **RAG grounding** against ingested Mitsubishi manuals (RT ToolBox / MELFA-BASIC VI reference,
   MELFA robot error codes) at `D:\SOURCES\AI Local\manuals\mitsubishi\`.
2. **Mandatory source citation** for this dialect.
3. **Human review + validation in RT ToolBox / on a real controller** — not platform-gated.

Golden MELFA examples land here after cited manual ingestion. Until then, generated MELFA is
**not** validate-passed.

**Do not confuse** with `../mitsubishi-engineering/` (Tier A — MELSEC PLC device/recipe tables).

**Safety rule (unchanged):** never author E-stop / interlock / SIL logic here — that stays in
the certified controller configuration.

## Safety-linter fixtures (doc 69 Wave-4 / C4) — separate from the above

`gated-pick-place.prg` (safe) and `bare-pick-place.prg` (unsafe) were added for the
platform's structural **safety-linter** (`server/services/programming/safetyLinter.ts`)
golden-driven test corpus. They are **hand-authored, small, structurally-plausible**
MELFA-BASIC programs — **not** vendor-manual-verified RAG examples, and this remains Tier B
(no `programmingAdapter`, no `validate()` substrate) for authoring-generation purposes. Do not
promote them to few-shot generation material without the manual-verified P1 ingestion above.
