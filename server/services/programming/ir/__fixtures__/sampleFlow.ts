/**
 * D1 regression fixture — a representative IR Flow exercising every block type
 * (move_linear, move_joint, grip, release, set_output, wait, if_condition, loop). It is
 * kept SAFE (within the default limits) so the linter passes and the transpilers emit
 * code. The golden URScript / ROS2 outputs are asserted in ir.d1.test.ts so any change to
 * the transpilers is caught.
 */
import type { Flow } from "../irModel";

export const SAMPLE_FLOW: Flow = {
  flow_id: "pick_and_place",
  target_device_type: "universal-robots",
  version: 1,
  author: "fixture",
  linked_capability: "run_job",
  blocks: [
    { id: "b1", type: "move_joint", joints: [0, -1.57, 1.57, 0, 1.57, 0], speed_pct: 50 },
    {
      id: "b2",
      type: "move_linear",
      target_pose: { x: 300, y: 100, z: 200, rx: 0, ry: 3.14, rz: 0 },
      speed_mms: 200,
      acceleration: 1.2,
      blend_radius: 10,
    },
    { id: "b3", type: "grip", tool_id: "gripper_a", force_limit_n: 40, timeout_ms: 2000 },
    {
      id: "b4",
      type: "if_condition",
      signal_ref: "1",
      operator: "eq",
      value: true,
      true_branch: [
        {
          id: "b5",
          type: "move_linear",
          target_pose: { x: 300, y: -100, z: 200, rx: 0, ry: 3.14, rz: 0 },
          speed_mms: 150,
          acceleration: 1.0,
          blend_radius: 0,
        },
      ],
      false_branch: [{ id: "b6", type: "wait", ms: 500 }],
    },
    {
      id: "b7",
      type: "loop",
      count: 3,
      body: [
        { id: "b8", type: "set_output", signal: "2", value: true },
        { id: "b9", type: "wait", signal_ref: "3" },
      ],
    },
    { id: "b10", type: "release", tool_id: "gripper_a" },
    { id: "b11", type: "set_output", signal: "2", value: false },
  ],
};
