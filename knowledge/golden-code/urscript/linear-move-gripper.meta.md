# Golden example — URScript: linear move + gripper (transpiler-target dialect)

- **id**: `urscript/linear-move-gripper`
- **kind** (index label): `urscript`
- **tier**: A (validated indirectly — this is what `ir-flow` → URScript emits, then HIL URSim)
- **code file**: [`linear-move-gripper.script`](./linear-move-gripper.script)

## Task prompt

- **vi**: "Viết một đoạn URScript di chuyển tuyến tính (movel) và đóng/mở đầu kẹp cho robot UR,
  đúng phong cách mã mà bộ chuyển IR→URScript sinh ra."
- **en**: "Write a URScript snippet with linear moves (movel) and gripper open/close for a UR
  robot, in the exact style the IR→URScript transpiler emits."

## IMPORTANT — this is not a direct programmingAdapter kind

- There is **no `urscript` adapter** in `programmingRegistry`. URScript is the **output** of the
  `ir-flow` transpiler (`transpileToUrscript`), and it is validated **indirectly** by pushing
  it to a virtual URSim controller (the HIL gate, `validateUrscriptOnUrsim`). This golden file
  therefore primes the model on the **target syntax**; author the program as `ir-flow` when you
  want the full linter → sim → HIL chain, and this is what a correct IR flow produces.
- If a future direct URScript kind is added, this file becomes a validate-able example too.

## Convention notes (matches `irToUrscript.ts` exactly)

- `movel(p[x,y,z,rx,ry,rz], a=…, v=…, r=…)` — position **metres**, speed **m/s**, blend **m**;
  numbers are trimmed (no trailing zeros), matching the transpiler's `fmt()`.
- Gripper close/open = `set_tool_digital_out(0, True|False)`.
- Every line group is preceded by a `# [IR <type> #<id>]` provenance marker.
- The whole body is wrapped in `def <flow_id>(): … end`.
