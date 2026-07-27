# Golden example — Delta robot (DRAS/DIAStudio): gated transfer (POSITIVE / safety-lint)

- **id**: `delta-robot/gated-transfer`
- **kind** (programmingAdapter): `null` — **Tier B**, no `programmingAdapter` for the Delta
  robot language (see `../README.md`). This pair exists ONLY for the doc 69 Wave-4 / C4
  **safety-linter** golden corpus (`safetyLinter.ts` has a hand-written `delta-robot` language
  profile that does not depend on a `ProgrammingAdapter`).
- **tier**: B — **not** vendor-manual-verified; a hand-authored, small, structurally-plausible
  Delta-robot script for linter regression coverage. Do not treat as validate-passed or as a
  citation-grounded RAG example.
- **code file**: [`gated-transfer.drl`](./gated-transfer.drl)

## Task prompt

- **vi**: "Viết một đoạn script robot Delta chuyển chi tiết, chỉ chạy khi tín hiệu vào DI(1)
  bật (báo cell sẵn sàng), bọc toàn bộ khối chuyển động + ngõ ra trong một khối IF."
- **en**: "Write a Delta-robot transfer script that only runs when input DI(1) is set (a
  cell-ready signal), wrapping the whole motion + output block in an IF block."

## Why the safety-linter finds nothing

- `MOVJ`/`MOVL`/`DO(1)=` all occur strictly between `IF DI(1) = 1 THEN` and `END IF` — the
  linter's `delta-robot` interlock check finds every actuation guarded → zero
  `missing-interlock` findings.
- `SPEED 40` (a 0-100% override) is under the conservative `100%` ceiling → zero
  `motion-envelope` findings.
- Zero `safety-lint` findings — this is the **safe** half of the delta-robot pair (sibling:
  `bare-transfer.drl`).

## Internal convention notes

- Speed here is modelled as a **percentage override** (`SPEED 40` = 40%), distinct from the
  mm/s speeds used by KAREL/RAPID/MELFA — a deliberate stand-in for a Delta DIAStudio-style
  override parameter, demonstrating the linter's `speed_pct` envelope path.
