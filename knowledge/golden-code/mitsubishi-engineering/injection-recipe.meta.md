# Golden example — Mitsubishi MELSEC: device/recipe parameter table

- **id**: `mitsubishi-engineering/injection-recipe`
- **kind** (programmingAdapter): `mitsubishi-engineering`
- **tier**: A (has authoring substrate — `MitsubishiEngineeringAdapter`)
- **code file**: [`injection-recipe.dev`](./injection-recipe.dev)

## Task prompt

- **vi**: "Tạo một bảng tham số thiết bị/recipe MELSEC cho một sản phẩm ép nhựa: nạp các
  setpoint nhiệt độ/áp suất vào thanh ghi D và các cờ chế độ vào bit M."
- **en**: "Create a MELSEC device/recipe parameter table for an injection-mould product: load
  temperature/pressure setpoints into D registers and mode flags into M bits."

## Why it is correct / what it passes

- Every line is a `<DEVICE> = <value>` assignment; each device matches the adapter's
  `DEVICE_RE` (prefix ∈ `X Y M L F B V S T C D W R Z`, decimal address for non-hex devices).
- `D…` are word registers (setpoints), `M…` are bit flags (0/1) — the recipe shape the adapter
  is built to own (it deliberately does **not** reimplement GX Works' compiler).

## Internal convention notes (what a reviewer expects)

- **Adapter reality**: `parseAssignments` strips `'` comments, matches `^<name> := | = <value>`,
  then validates the device token. Non-hex devices (D/M/L/…) require a **decimal** address;
  X/Y/B/W accept hex. Values are stored as free strings (`= 1`, `= 2200`, or `:= TRUE` all
  parse — semantics are the recipe's concern).
- Keep MELSEC scaling explicit in comments (`x0.1 degC`) — GX Works recipes are unit-scaled.
- `compile()` → a `device → value` map at `melsec://recipe/<checksum>`; the real push
  (commandDispatcher per-device HITL, or a GX Works headless transfer) is gated + HW-validated.
