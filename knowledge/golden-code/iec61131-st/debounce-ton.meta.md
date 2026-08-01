# Golden example — IEC 61131-3 Structured Text: input debounce with TON

- **id**: `iec61131-st/debounce-ton`
- **kind** (programmingAdapter): `iec61131-st`
- **tier**: A (has authoring substrate — `Iec61131StAdapter`)
- **code file**: [`debounce-ton.st`](./debounce-ton.st)

## Task prompt

- **vi**: "Viết Structured Text chống dội (debounce) một tín hiệu số nhiễu bằng bộ định thời
  TON: chỉ chấp nhận trạng thái mới khi giữ ổn định quá thời gian đặt."
- **en**: "Write Structured Text that debounces a noisy digital signal using a TON timer:
  accept the new state only after it has been stable longer than a set time."

## Why it is correct / what it demonstrates

- Correct **standard function-block instance** usage: declare a `TON` instance, call it with
  named args `IN`/`PT`, then read its `.Q` output — the canonical IEC 61131-3 pattern.
- A `TIME` literal (`T#20ms`) as an initial value.
- A single balanced `VAR … END_VAR` block; no `IF/FOR/WHILE` needed.

## Internal convention notes (what a reviewer expects)

- Timer instances get a `Tmr` suffix; named FB arguments (`IN :=`, `PT :=`) not positional.
- Debounce is signal conditioning — **not** a safety function; a real E-stop stays hardwired.
- **Adapter reality**: `validate()` requires balanced `VAR/END_VAR` (here 1/1) and at least
  one `:=` (present). Because the keyword counter also scans comment text, the comments avoid
  the bare words *if / for / while / var*. `TON`, `T#20ms`, `.Q` pass through untouched — the
  adapter validates block-balance + assignment presence, not full type resolution (that is the
  OpenPLC/matiec runtime's job at `compile()` → `openplc://st/<checksum>`).
