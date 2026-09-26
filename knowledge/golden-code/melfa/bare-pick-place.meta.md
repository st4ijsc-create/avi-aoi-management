# Golden example — Mitsubishi MELFA-BASIC: bare pick-place (NEGATIVE / safety-lint)

- **id**: `melfa/bare-pick-place`
- **kind** (programmingAdapter): `null` — **Tier B**, no `programmingAdapter` for MELFA (see
  `../README.md`). This pair exists ONLY for the doc 69 Wave-4 / C4 **safety-linter** golden
  corpus.
- **tier**: B — **not** vendor-manual-verified; a hand-authored negative fixture for linter
  regression coverage. Do not treat as validate-passed or as a citation-grounded RAG example.
- **code file**: [`bare-pick-place.prg`](./bare-pick-place.prg)

## Task prompt

- **vi**: "Giống gated-pick-place.prg nhưng bỏ khối IF — minh hoạ lỗi thường gặp: chuyển động
  và ngõ ra chạy vô điều kiện mỗi vòng quét."
- **en**: "Same as gated-pick-place.prg but with the IF block removed — illustrates the
  common authoring mistake of unconditional motion + output every scan."

## Certification disclaimer

Reviewed + validated in RT ToolBox / on a real controller before any use. Motion/process
logic only -- distinct from `../mitsubishi-engineering/` (MELSEC PLC device/recipe
tables). (This disclaimer lives here, not in the code file, so the `.prg` fixture itself
stays free of any safety-domain keyword — see `safetyLinter.test.ts`'s golden-driven
keyword assertion.)

## Why the safety-linter flags this

- No line in the file matches the `melfa` profile's `guardOpenRe` (`IF … THEN`) — guard depth
  stays 0 for the whole file, so every `MOV`, `MVS`, and `M_OUT(10)=` occurrence is flagged:
  `missing-interlock` — "Motion/actuation command has no guarding conditional found upstream
  in its block…". Multiple findings are expected (one per unguarded actuation line).
- **No safety keyword anywhere in the program body.**

## Internal convention notes

- Identical sequence to `gated-pick-place.prg` with the `IF`/`ENDIF` wrapper removed and line
  numbers renumbered — a realistic "the guard was never added" authoring slip.
