# Golden example — IEC 61131-3 Ladder DSL: station-ready permissive + XOR jam lamp

- **id**: `iec61131-ld/station-ready`
- **kind** (programmingAdapter): `iec61131-ld`
- **tier**: A (has authoring substrate — `Iec61131LdAdapter`, real one-scan boolean sim)
- **code file**: [`station-ready.ld`](./station-ready.ld)

## Task prompt

- **vi**: "Viết ladder tính cờ 'sẵn sàng chu trình' của một trạm: có phôi (2 cảm biến),
  chưa chạy chu trình, buffer phía trước trống; và một đèn báo kẹt phôi dùng XOR."
- **en**: "Write ladder that computes a station's 'cycle-ready' flag: part present (two
  sensors), no cycle running, upstream buffer clear; plus a jam lamp using XOR."

## Why it is correct / what it demonstrates

- **Combinational permissive** logic and the **XOR** operator (both sensors must agree for a
  valid part; exactly one made = a jam/misfeed).
- Three rungs, **scan-forward** dependency: Rung 2 uses `PartPresent` from Rung 1.

## Internal convention notes (what a reviewer expects)

- Same grammar limits as every `iec61131-ld` example: identifiers + `AND OR NOT XOR` + parens
  + `TRUE`/`FALSE` only. `XOR` is valid at the term level in `boolEval`.
- Readiness/permissive flags are PROCESS logic; a guard/light-curtain would be a SAFETY input
  handled on the certified controller — deliberately excluded here (see the safety rule).
- Comments are `//` line comments only (the parser strips comments per line).
