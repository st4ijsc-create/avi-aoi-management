# Golden example — IEC 61131-3 ST: unbounded conveyor-poll loop (NEGATIVE / safety-lint)

- **id**: `iec61131-st/conveyor-poll-unbounded`
- **kind** (programmingAdapter): `iec61131-st`
- **tier**: A (has authoring substrate — `Iec61131StAdapter`)
- **code file**: [`conveyor-poll-unbounded.st`](./conveyor-poll-unbounded.st)
- **purpose**: doc 69 Wave-4 / C4 safety-linter golden corpus — the **UNSAFE** half of the
  `iec61131-st` safe/unsafe pair (the sibling **safe** examples are `moving-average.st` and
  `debounce-ton.st`, unchanged).

## Task prompt

- **vi**: "Viết một chương trình ST đọc cảm biến rồi điều khiển động cơ liên tục trong một
  vòng lặp — dùng để chứng minh safety-linter phát hiện vòng lặp không có lối thoát."
- **en**: "Write an ST program that polls a sensor and drives a motor continuously inside a
  loop — used to demonstrate the safety-linter catching a loop with no reachable exit."

## Why it is correct (passes `Iec61131StAdapter.validate()`) yet is flagged

- `VAR/END_VAR`, `WHILE/END_WHILE` are each balanced 1:1 — the adapter's structural check
  passes (`ok:true`).
- The **new** safety-lint pass (`safetyLintDiagnostics("iec61131-st", …)`, wired into
  `validate()`) finds `WHILE TRUE DO … END_WHILE` with **no `EXIT`/`RETURN`** anywhere in the
  body → `unbounded-loop`, severity **warning** (advisory — does not flip `ok` to false).
- **No safety keyword anywhere in the program body** (only the boilerplate header comment,
  identical across every file in this corpus, uses those words) — the finding is purely
  structural.

## Internal convention notes

- Comments avoid the bare words `if`/`for`/`while`/`var` (the adapter's balance count is
  case-insensitive over the **whole file including comments** — see `README.md` gotcha list).
- This file is a **hand-authored negative fixture for the linter test corpus**, not a
  vendor-manual-verified few-shot example — it is not selected by `selectGoldenExamples()`
  differently than any other `iec61131-st` entry, but its purpose here is regression coverage
  for `safetyLinter.test.ts`, not prompt priming quality.
