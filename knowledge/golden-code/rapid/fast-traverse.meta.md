# Golden example — ABB RAPID: excessive-speed traverse (NEGATIVE / safety-lint)

- **id**: `rapid/fast-traverse`
- **kind** (programmingAdapter): `null` — **Tier B**, no `programmingAdapter` for RAPID (see
  `../README.md`). This pair exists ONLY for the doc 69 Wave-4 / C4 **safety-linter** golden
  corpus.
- **tier**: B — **not** vendor-manual-verified; a hand-authored negative fixture for linter
  regression coverage. Do not treat as validate-passed or as a citation-grounded RAG example.
- **code file**: [`fast-traverse.mod`](./fast-traverse.mod)

## Task prompt

- **vi**: "Viết một module RAPID di chuyển tới một điểm xa bằng tốc độ đặt trước rất cao
  (v1500) — minh hoạ một tốc độ vượt trần bảo thủ."
- **en**: "Write a RAPID module that moves to a far point using a very high predefined speed
  (v1500) — illustrates a speed that exceeds a conservative ceiling."

## Certification disclaimer

Reviewed + validated in RobotStudio / on a real IRC5 controller before any use.
Motion/process only. (This disclaimer lives here, not in the code file, so the `.mod`
fixture itself stays free of any safety-domain keyword — see `safetyLinter.test.ts`'s
golden-driven keyword assertion.)

## Why the safety-linter flags this

- `MoveL pFar, v1500, fine, tool0;` — the linter's `rapid` motion extractor reads `v1500` =
  1500 mm/s, well above the conservative `250 mm/s` default ceiling
  (`DPC_SAFETY_LINT_MAX_SPEED_MMS`) → `motion-envelope`, severity **warning**.
- **No safety keyword anywhere in the program body.**

## Internal convention notes

- `v1500` is itself a valid, real ABB predefined `speeddata` name (not a made-up token) — the
  finding is about the VALUE being outside a conservative default, not about invalid syntax.
