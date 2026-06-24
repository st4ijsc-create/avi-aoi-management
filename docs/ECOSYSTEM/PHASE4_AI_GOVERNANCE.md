# Phase 4 WS4.3 — AI governance

Lightweight governance for the local-AI subsystem (LLM copilot, vision models,
orchestration watcher). Goal: traceable, human-overseen AI aligned with EU AI Act
expectations for industrial quality decisions.

## Human oversight (already enforced)
- **No autonomous control.** AI can only *propose*; device/robot commands run
  only through the HITL `ai_pending_actions` flow + the OT/robot dispatchers
  (idempotency, approval, read-back, append-only logs).
- The Phase 4 **AI watcher is advisory-only** — it writes `ai_insights`, never
  executes.
- Every authenticated mutation is audited (Phase 0 WS0.5 middleware).

## Model cards (recommended next step)
Maintain a card per deployed model (extend `ai_models` or a new `ai_model_cards`
table) with: purpose & intended use, training/validation dataset + date,
key metrics (accuracy/precision/recall, confusion matrix), known limitations &
failure modes, human-oversight requirement, and EU AI Act risk class. Surface it
in the Model Management UI and require it before a version can be activated
(gate alongside the existing quality-gate activation guard).

## Inference audit
`ml_inference_audit` exists. For high-risk decisions (quality pass/fail driven by
AI), log: model+version, input ref, output + confidence, calibration applied, and
whether a human reviewed/overrode. This gives a defensible decision trail.

## Known correctness items to fix (targeted follow-ups)
Flagged in the baseline audit; each is a small, well-scoped change to validate
against tests before enabling more AI autonomy:
- **Holt-Winters short-window** (AI time-series): guard against too-few points;
  fall back to a simpler estimator and label confidence.
- **AI Analytics N+1 / no date-range cap**: batch the per-tab queries and cap the
  date range server-side (the FE batching landed; verify the BE).
- **Cpk in `getControlChart`** (AI Analytics): confirm USL/LSL usage (the SPC
  engine was fixed; the analytics path was still flagged).

## RAG provenance
The production KB store (WS4.1) keeps `metadata.sourcePath` per chunk, so RAG
answers can cite their source — keep citations in the answer surface for
auditability.
