# Golden example — IEC 61131-3 Structured Text: N-sample moving average

- **id**: `iec61131-st/moving-average`
- **kind** (programmingAdapter): `iec61131-st`
- **tier**: A (has authoring substrate — `Iec61131StAdapter`)
- **code file**: [`moving-average.st`](./moving-average.st)

## Task prompt

- **vi**: "Viết một khối Structured Text (IEC 61131-3) làm trung bình trượt N mẫu (ví dụ N=8)
  để làm mượt một tín hiệu analog nhiễu, dùng ring buffer."
- **en**: "Write a Structured Text (IEC 61131-3) block that computes an N-sample moving
  average (e.g. N=8) to smooth a noisy analog signal, using a ring buffer."

## Why it is correct / what it demonstrates

- A `VAR … END_VAR` declaration block, an `IF … END_IF` wrap-around, and a `FOR … END_FOR`
  accumulation loop — the three balanced constructs the ST adapter's `validate()` checks.
- Deterministic ring-buffer indexing (no dynamic allocation) — the idiom real PLC code uses.
- `:=` assignments throughout (the adapter warns if none are present).

## Internal convention notes (what a reviewer expects)

- PascalCase symbol names; one statement per line; every statement terminated with `;`.
- `ARRAY[0..N-1]` zero-based; the wrap constant (`8`) matches the array size — keep them in
  lock-step (a real refactor would hoist it into a `CONSTANT`).
- **Adapter reality**: `Iec61131StAdapter.validate()` balances `VAR/END_VAR`, `IF/END_IF`,
  `FOR/END_FOR`, `WHILE/END_WHILE` **case-insensitively over the entire file including
  comments**. Therefore comments here deliberately avoid the bare words *if / for / while /
  var* so they never unbalance the counts. `compile()` normalises to `openplc://st/<checksum>`
  (matiec-compatible; open runtime only — never a certified vendor PLC).
