# Golden example — Zmotion ZBasic: single-axis absolute move

- **id**: `zmotion-basic/axis-absolute-move`
- **kind** (programmingAdapter): `zmotion-basic`
- **tier**: A (has authoring substrate — `ZmotionBasicAdapter`, real motion-timeline sim)
- **code file**: [`axis-absolute-move.bas`](./axis-absolute-move.bas)

## Task prompt

- **vi**: "Viết chương trình Zmotion ZBasic cấu hình trục 0 và thực hiện một lệnh di chuyển
  tuyệt đối (MOVEABS) đến vị trí đặt, đợi trục dừng."
- **en**: "Write a Zmotion ZBasic program that configures axis 0 and performs one absolute
  move (MOVEABS) to a target position, waiting for the axis to stop."

## Why it is correct / what it passes

- Contains a recognised **motion op** (`MOVEABS`) — the adapter warns if none is present.
- Axis-parameter setup (`BASE`, `ATYPE`, `UNITS`, `SPEED`, `ACCEL`, `DECEL`) is the standard
  ZMC preamble before a move; `WAIT IDLE` blocks until the move completes.
- No `IF/FOR/WHILE/SUB` block, so open/close block-keyword counts are balanced (0/0).

## Internal convention notes (what a reviewer expects)

- **Adapter reality**: `ZmotionBasicAdapter.lint()` strips `'` comments per line, then balances
  block-open (`IF/FOR/WHILE/SUB`) against block-close (`ENDIF/END IF/NEXT/WEND/ENDSUB/END SUB`)
  by **line count**, and requires ≥1 op from `MOVE/MOVEABS/MOVECIRC/MOVESP/MHELICAL/CONNECT/CAM`.
- `MOVEABS(pos)` = absolute; `MOVE(dist)` = relative. Motion params are axis globals set on the
  current `BASE`.
- `compile()` → `zmc://build/<checksum>`; `simulate()` builds a per-move timeline. The ZMC
  Ethernet download path is a scaffold (needs real-HW/ZAux-SDK validation) — deploy stays gated.
