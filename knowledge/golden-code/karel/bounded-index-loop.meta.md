# Golden example — Fanuc KAREL/TP: bounded index loop (POSITIVE / safety-lint)

- **id**: `karel/bounded-index-loop`
- **kind** (programmingAdapter): `null` — **Tier B**, no `programmingAdapter` for KAREL/TP
  (see `../README.md`). This pair exists ONLY for the doc 69 Wave-4 / C4 **safety-linter**
  golden corpus (`safetyLinter.ts` has a hand-written `karel` language profile that does not
  depend on a `ProgrammingAdapter`).
- **tier**: B — **not** vendor-manual-verified; a hand-authored, small, structurally-plausible
  TP listing for linter regression coverage. Do not treat as validate-passed or as a
  citation-grounded RAG example.
- **code file**: [`bounded-index-loop.ls`](./bounded-index-loop.ls)

## Task prompt

- **vi**: "Viết một chương trình TP Fanuc index 3 chi tiết từ P[1] sang P[2], đếm ngược bằng
  thanh ghi R[1], nhảy lùi có điều kiện về nhãn để lặp."
- **en**: "Write a Fanuc TP listing that indexes 3 parts from P[1] to P[2], counting down in
  register R[1], with a conditional back-jump to the label to repeat."

## Why the safety-linter finds nothing

- The loop's back-edge (`JMP LBL[1]`) is on the SAME line as `IF R[1]>0,` — the linter's
  `karel` profile treats a jump preceded by `IF` on its own line as a **guarded** (bounded)
  back-edge, not an unbounded loop.
- Move speeds (`200mm/sec`) are well under the conservative `250 mm/s` default ceiling
  (`DPC_SAFETY_LINT_MAX_SPEED_MMS`).
- Zero `safety-lint` findings — this is the **safe** half of the karel pair (sibling:
  `unbounded-index-loop.ls`).

## Internal convention notes

- Loosely modelled on a Fanuc TP program listing (`N: <instr>`, `LBL[n]`/`JMP LBL[n]`,
  `L/J P[n] <speed> <term>`) — realistic shape, not a verbatim manual transcription.
- Comments use `!` (Fanuc TP remark convention).
