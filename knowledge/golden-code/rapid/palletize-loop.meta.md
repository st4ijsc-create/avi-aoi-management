# Golden example — ABB RAPID: bounded palletize loop (POSITIVE / safety-lint)

- **id**: `rapid/palletize-loop`
- **kind** (programmingAdapter): `null` — **Tier B**, no `programmingAdapter` for RAPID (see
  `../README.md`). This pair exists ONLY for the doc 69 Wave-4 / C4 **safety-linter** golden
  corpus (`safetyLinter.ts` has a hand-written `rapid` language profile that does not depend
  on a `ProgrammingAdapter`).
- **tier**: B — **not** vendor-manual-verified; a hand-authored, small, structurally-plausible
  RAPID module for linter regression coverage. Do not treat as validate-passed or as a
  citation-grounded RAG example.
- **code file**: [`palletize-loop.mod`](./palletize-loop.mod)

## Task prompt

- **vi**: "Viết một module RAPID palletize 4 chi tiết bằng vòng lặp FOR có giới hạn, tốc độ
  vừa phải (v100/v150)."
- **en**: "Write a RAPID module that palletizes 4 parts with a bounded FOR loop, at moderate
  speeds (v100/v150)."

## Why the safety-linter finds nothing

- `FOR i FROM 1 TO 4 DO … ENDFOR` is a bounded loop by construction — the linter's
  `unbounded-loop` check only pattern-matches `WHILE TRUE DO`, so a `FOR` loop is out of its
  scope entirely (no false claim either way about `FOR`'s boundedness).
- Every `Move[LJC]` speed (`v100`/`v150`) is extracted from the ABB predefined-speeddata
  literal and is well under the conservative `250 mm/s` ceiling.
- Zero `safety-lint` findings — this is the **safe** half of the rapid pair (sibling:
  `fast-traverse.mod`).

## Internal convention notes

- `vNNN` is a real ABB predefined `speeddata` naming convention (v100 = 100 mm/s, …, v1500 =
  1500 mm/s, …) — the linter's `rapid` motion extractor parses the numeric suffix directly
  off the 2nd argument of `Move[LJC]`.
- Comments use `!` (RAPID comment marker).
