# Golden example — Fanuc KAREL/TP: unbounded index loop (NEGATIVE / safety-lint)

- **id**: `karel/unbounded-index-loop`
- **kind** (programmingAdapter): `null` — **Tier B**, no `programmingAdapter` for KAREL/TP
  (see `../README.md`). This pair exists ONLY for the doc 69 Wave-4 / C4 **safety-linter**
  golden corpus.
- **tier**: B — **not** vendor-manual-verified; a hand-authored negative fixture for linter
  regression coverage. Do not treat as validate-passed or as a citation-grounded RAG example.
- **code file**: [`unbounded-index-loop.ls`](./unbounded-index-loop.ls)

## Task prompt

- **vi**: "Giống bounded-index-loop.ls nhưng dòng nhảy lùi bị mất điều kiện `IF` — minh hoạ
  lỗi thường gặp khiến vòng lặp chuyển động chạy vô hạn."
- **en**: "Same as bounded-index-loop.ls but the back-jump loses its `IF` guard — illustrates
  the common authoring mistake that turns a motion loop unbounded."

## Certification disclaimer

Reviewed + validated on ROBOGUIDE / a real R-30iB controller before any use. Motion/process
only. (This disclaimer lives here, not in the code file, so the `.ls` fixture itself stays
free of any safety-domain keyword — see `safetyLinter.test.ts`'s golden-driven keyword
assertion.)

## Why the safety-linter flags this

- Line 6 is `JMP LBL[1]` with **no `IF` on the same line** — the linter's `karel` profile
  resolves the label `LBL[1]` (defined earlier, at line 2) and, finding no conditional hint,
  flags it: `unbounded-loop` — "Unconditional jump back to an earlier label with no guarding
  condition — the loop has no reachable exit."
- Severity is **warning** (advisory) — the finding never blocks anything; there is nothing to
  block for a Tier-B language anyway (no `compile()`/`deploy()` exists for KAREL).
- **No safety keyword anywhere in the program body.**

## Internal convention notes

- Identical to `bounded-index-loop.ls` except the `IF R[1]>0,` guard was removed from line 6 —
  the register decrement on line 5 becomes meaningless (never checked), and motion never
  reaches `LBL[2]` — a realistic authoring slip, not a contrived pattern.
