# ABB RAPID — Tier B (placeholder)

**Status: RAG-first, no simulation substrate yet. Examples pending vendor-manual ingestion (P1).**

ABB **RAPID** is a robot-teach language with **no `programmingAdapter` kind** in the platform
(the ABB driver is telemetry scaffold only), so it cannot go through the
`validate → sim → HIL` chain today. Generating RAPID relies on:

1. **RAG grounding** against ingested ABB manuals (RAPID Instructions/Functions/Data-types
   reference, IRC5/OmniCore error codes) at `D:\SOURCES\AI Local\manuals\abb\`.
2. **Mandatory source citation** for this dialect.
3. **Human review + validation in RobotStudio / on a real controller** — the platform cannot
   gate it yet.

Golden RAPID examples land here after cited manual ingestion. Until then, generated RAPID is
**not** validate-passed.

**Safety rule (unchanged):** never author E-stop / interlock / SafeMove / SIL logic here — that
stays in the certified ABB safety configuration.

> Note: ABB RAPID was not called out explicitly in the doc 34 §VI-bis factory list; it is
> included as a common Tier B robot-teach language for completeness. Prioritise the vendors
> actually deployed in the plant (Fanuc, Mitsubishi MELFA, Delta) first.
