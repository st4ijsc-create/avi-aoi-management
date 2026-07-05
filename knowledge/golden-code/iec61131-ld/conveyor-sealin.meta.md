# Golden example — IEC 61131-3 Ladder DSL: motor seal-in (latch)

- **id**: `iec61131-ld/conveyor-sealin`
- **kind** (programmingAdapter): `iec61131-ld`
- **tier**: A (has authoring substrate — `Iec61131LdAdapter`, real one-scan boolean sim)
- **code file**: [`conveyor-sealin.ld`](./conveyor-sealin.ld)

## Task prompt

- **vi**: "Viết một mạch ladder tự giữ (seal-in) để chạy băng tải: nút Start giữ trạng thái
  chạy, nút Stop (dừng chu trình, không phải E-stop) nhả ra; kèm đèn báo chạy."
- **en**: "Write a seal-in (latch) ladder rung to run a conveyor: a Start button latches the
  run state, a Stop button (cycle-stop, not E-stop) releases it; plus a running lamp."

## Why it is correct / what it demonstrates

- The classic **seal-in / hold-in** idiom `OUT := (Start OR OUT) AND NOT Stop AND Permissive`.
- Multi-rung **scan order**: Rung 2 reads Rung 1's freshly-computed `ConveyorRun` — exactly
  what the adapter's real one-scan simulator does (`scenario.assumedInputs` feed forward).

## Internal convention notes (what a reviewer expects)

- **Adapter reality**: `Iec61131LdAdapter` parses one rung per line as `OUT := <bool expr>`
  and hands the expression to `boolEval`, whose grammar is ONLY: identifiers, `AND OR NOT
  XOR`, parentheses, `TRUE`/`FALSE`. **No numbers, no comparison operators, no `&|!`
  symbols** — those raise a parse error. Keep rungs purely boolean.
- Comments: the parser strips `(* … *)` and `//` **per line only**, so a `(* … *)` that spans
  lines would break parsing. **Use `//` line comments** (as here) for anything multi-line.
- A trailing `;` is optional. `NOT` binds tightest, then `AND`/`XOR`, then `OR`.
- `simulate()` runs a genuine one-scan evaluation; unknown symbols resolve to `false` and are
  surfaced as warnings (not errors). `compile()` transpiles rungs → ST → `openplc://ld/<sum>`.
