# Golden example — IR-flow: palletize / stack loop (loop + counter + handshake)

- **id**: `ir-flow/palletize-loop`
- **kind** (programmingAdapter): `ir-flow`
- **tier**: A (safety-linter → kinematic sim gate → Rapier → HIL URSim)
- **code file**: [`palletize-loop.ir.json`](./palletize-loop.ir.json)

## Task prompt

- **vi**: "Tạo chương trình IR xếp chồng (palletize): lặp N lần một chu trình gắp phôi từ điểm
  cấp, đặt lên vị trí xếp, đếm số phôi đã đặt, và bắt tay tín hiệu số với băng tải."
- **en**: "Author an IR palletize program: repeat a cycle N times that picks a part from a
  feed point, places it on the stack, counts the placed parts, and does a digital handshake
  with the conveyor."

## Why it is correct / what it passes

- `loop.count = 4` (positive int), body non-empty; a `set_variable` declares `placed`
  **before** the `counter increment` reads it (the linter's use-before-declare rule).
- All speeds ≤ 250 mm/s (pick/place descents at 60), forces 50 N ≤ 150 N, timeouts bounded,
  poses inside the workspace AABB → `lintFlow` `ok:true`.
- `set_output.signal` / `wait` use the schema shapes (`signal` is a **string**; `value` may be
  a bare boolean; `wait` carries `ms`).

## Internal convention & HONEST LIMITATION notes

- **`move_linear.target_pose` is a static literal** — the IR has no per-iteration parametric
  pose offset on a move. So a *real* pallet with distinct cell coordinates is authored either
  by **unrolling** one `move_linear` group per cell, or by driving a positioner via
  `set_analog`/`set_variable` expressions. This example uses the `loop` construct with a fixed
  representative stack pose to demonstrate the loop + counter + I/O-handshake vocabulary
  faithfully; treat the per-cell offset as the piece a real program fills in.
- Variables (`placed`) live in one program-order scope; `counter increment` must follow a
  prior `set_variable`/`counter reset` or the linter errors `undefined-variable`.
