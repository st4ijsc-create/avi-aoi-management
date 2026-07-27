# Golden example — Delta robot (DRAS/DIAStudio): bare transfer (NEGATIVE / safety-lint)

- **id**: `delta-robot/bare-transfer`
- **kind** (programmingAdapter): `null` — **Tier B**, no `programmingAdapter` for the Delta
  robot language (see `../README.md`). This pair exists ONLY for the doc 69 Wave-4 / C4
  **safety-linter** golden corpus.
- **tier**: B — **not** vendor-manual-verified; a hand-authored negative fixture for linter
  regression coverage. Do not treat as validate-passed or as a citation-grounded RAG example.
- **code file**: [`bare-transfer.drl`](./bare-transfer.drl)

## Task prompt

- **vi**: "Giống gated-transfer.drl nhưng bỏ khối IF — minh hoạ lỗi thường gặp: chuyển động và
  ngõ ra chạy vô điều kiện mỗi chu kỳ."
- **en**: "Same as gated-transfer.drl but with the IF block removed — illustrates the common
  authoring mistake of unconditional motion + output every cycle."

## Certification disclaimer

Reviewed + validated in DIAStudio / on real hardware before any use. Motion/process only.
(This disclaimer lives here, not in the code file, so the `.drl` fixture itself stays free
of any safety-domain keyword — see `safetyLinter.test.ts`'s golden-driven keyword
assertion.)

## Why the safety-linter flags this

- No line in the file matches the `delta-robot` profile's `guardOpenRe` (`IF … THEN`) — guard
  depth stays 0 for the whole file, so every `MOVJ`, `MOVL`, and `DO(1)=` occurrence is
  flagged: `missing-interlock`. Multiple findings are expected (one per unguarded actuation
  line).
- **No safety keyword anywhere in the program body.**

## Internal convention notes

- Identical sequence to `gated-transfer.drl` with the `IF`/`END IF` wrapper removed — a
  realistic "the guard was never added" authoring slip.
