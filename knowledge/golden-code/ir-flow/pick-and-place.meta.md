# Golden example — IR-flow: pick-and-place (move_linear / grip / release)

- **id**: `ir-flow/pick-and-place`
- **kind** (programmingAdapter): `ir-flow`
- **tier**: A (strongest substrate — safety-linter → kinematic sim gate → Rapier → HIL URSim)
- **code file**: [`pick-and-place.ir.json`](./pick-and-place.ir.json)
- **transpiles to**: URScript (see `urscript/linear-move-gripper.script`) + ROS2 MoveIt Python

## Task prompt

- **vi**: "Tạo một chương trình IR gắp-đặt cho robot cộng tác (UR): tiếp cận trên điểm gắp,
  hạ xuống, kẹp bằng đầu hút, nâng lên, di chuyển sang điểm đặt, hạ, nhả, rồi rút về."
- **en**: "Author an IR pick-and-place program for a collaborative robot (UR): approach above
  the pick, descend, grip with a vacuum tool, lift, traverse to the place, descend, release,
  retract."

## Why it is correct / what it passes

- Every `move_linear.speed_mms` is ≤ **250 mm/s** (ISO/TS 15066 collaborative ceiling); the
  descent/approach moves use a slow **80 mm/s**.
- Every `grip.force_limit_n` (40 N) ≤ **150 N** ceiling; `timeout_ms` (1500) is `> 0` and
  ≤ 30 000 ms; `acceleration > 0`; `blend_radius` (0–10) ≤ **100 mm**.
- Every `target_pose` sits inside the default workspace AABB (x,y ∈ [-1000,1000], z ∈ [0,1500]).
- → `lintFlow` returns `ok:true` (no `error` diagnostics) so `compile()` transpiles.

## Internal convention notes (what a reviewer expects)

- Poses are **mm + rad** in the IR; the URScript transpiler converts mm→m and mm/s→m/s and
  passes rx/ry/rz through. `rx=3.14159` = tool pointing down.
- `signal`/`signal_ref` values are **strings** in the schema even for numeric I/O ports.
- A vacuum/parallel gripper is `grip` (close) + `release`; the transpiler emits
  `set_tool_digital_out(0, …)`.
- The leading `_safety_note` key is **not** part of `flowSchema`; `safeParse` strips unknown
  keys, so it is inert (a JSON file cannot carry a comment — this is the header substitute).
