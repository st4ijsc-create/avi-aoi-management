# Golden example — Techman (robot-tm): pick-and-place job-list

- **id**: `robot-tm/pick-place-job`
- **kind** (programmingAdapter): `robot-tm`
- **tier**: A (has authoring substrate — `RobotTmAdapter`, teach-points + job-list sim)
- **code file**: [`pick-place-job.tmscript`](./pick-place-job.tmscript)

## Task prompt

- **vi**: "Viết một job-list Techman TMflow: định nghĩa 2 điểm dạy (PICK A, PLACE B), về home,
  gắp ở A, đặt ở B, có dwell chờ đầu kẹp, rồi về home."
- **en**: "Write a Techman TMflow job-list: define two taught POINTs (pick A, place B), home,
  grip at A, place at B, with a gripper dwell, then home."

## Why it is correct / what it passes

- Every referenced point (`PICKA`, `PLACEB`) is **defined by a `POINT` line before use** — the
  adapter errors on an undefined point.
- Every verb is in the known set: `HOME / MOVE / MOVEL / PICK / PLACE / GRIP / RELEASE / WAIT`.
- `WAIT t=300` uses the `t=<ms>` form the adapter parses for dwell duration.

## Internal convention notes (what a reviewer expects)

- **Adapter reality**: `parseJob` collects `POINT <name> = (…)` defs (names upper-cased), then
  parses steps. `MOVE`/`MOVEL` require a defined point (last identifier on the line or a `P…`
  token); `HOME` needs none. Comments use `'`.
- `POINT` tuple is `(x, y, z, rx, ry, rz)`; `rx=3.142` ≈ tool-down. Keep point names distinct
  from verbs.
- `compile()` → `tm://job/<checksum>` + a step list; `simulate()` builds a per-step timeline.
  The TMflow Listen-Node download (via `robotCommandDispatcher`, `ROBOT_CONTROL_ENABLED`) is
  gated + needs real-controller validation — deploy never fakes success.
