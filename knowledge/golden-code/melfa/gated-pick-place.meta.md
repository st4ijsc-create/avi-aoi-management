# Golden example — Mitsubishi MELFA-BASIC: gated pick-place (POSITIVE / safety-lint)

- **id**: `melfa/gated-pick-place`
- **kind** (programmingAdapter): `null` — **Tier B**, no `programmingAdapter` for MELFA (see
  `../README.md`; distinct from `../mitsubishi-engineering/`, which is MELSEC PLC device/
  recipe tables). This pair exists ONLY for the doc 69 Wave-4 / C4 **safety-linter** golden
  corpus (`safetyLinter.ts` has a hand-written `melfa` language profile that does not depend
  on a `ProgrammingAdapter`).
- **tier**: B — **not** vendor-manual-verified; a hand-authored, small, structurally-plausible
  MELFA-BASIC program for linter regression coverage. Do not treat as validate-passed or as a
  citation-grounded RAG example.
- **code file**: [`gated-pick-place.prg`](./gated-pick-place.prg)

## Task prompt

- **vi**: "Viết chương trình MELFA-BASIC gắp-đặt chỉ chạy khi tín hiệu vào M_IN(1) bật (báo
  trạm sẵn sàng), bọc toàn bộ khối chuyển động + ngõ ra trong một khối IF."
- **en**: "Write a MELFA-BASIC pick-place program that only runs when input M_IN(1) is set
  (a station-ready signal), wrapping the whole motion + output block in an IF block."

## Why the safety-linter finds nothing

- `MOV`/`MVS`/`M_OUT(10)=` all occur strictly between `IF M_IN(1) = 1 THEN` and `ENDIF` — the
  linter's `melfa` interlock check tracks a guard-depth counter and finds every actuation
  guarded (`depth > 0` at each occurrence) → zero `missing-interlock` findings.
- `SPD 150` is under the conservative `250 mm/s` ceiling → zero `motion-envelope` findings.
- Zero `safety-lint` findings — this is the **safe** half of the melfa pair (sibling:
  `bare-pick-place.prg`).

## Internal convention notes

- Line-numbered BASIC style (`10 SPD 150`, …) — a realistic MELFA-BASIC V/VI shape.
- The linter's `guardOpenRe` matches a block-form `IF … THEN` (line ends in `THEN`, nothing
  after) — an inline `IF x THEN GOTO *lbl` would NOT open the guard depth (out of scope here).
