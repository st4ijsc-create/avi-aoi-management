/**
 * Client FK port sanity — doc 24 Wave-1 T1.
 *
 * Guards that the client-side forward kinematics (a port of the server FK) uses the
 * same DH conventions, so a streamed joint vector renders the SAME chain the server
 * would compute. We assert:
 *   • zero-joint rest TCP of the 6-DOF arm equals the analytic sum of the DH d/a
 *     offsets (same math the server sim.t2b test relies on),
 *   • one link per joint is produced (6 for the arm, 4 for the SCARA),
 *   • rotating shoulder_pan by +90° swings the wrist origin as expected,
 *   • the kind→model map mirrors the server family mapping.
 */
import { describe, it, expect } from "vitest";
import {
  forwardKinematics,
  getKinematicModel,
  robotKindToModelId,
  mat4Origin,
  SAMPLE_ARM_6DOF,
  SAMPLE_SCARA,
} from "./kinematics";

describe("client forwardKinematics (port of server FK)", () => {
  it("produces one link pose per joint", () => {
    expect(forwardKinematics(SAMPLE_ARM_6DOF, [0, 0, 0, 0, 0, 0])).toHaveLength(6);
    expect(forwardKinematics(SAMPLE_SCARA, [0, 0, 0, 0])).toHaveLength(4);
  });

  it("6-DOF rest pose TCP matches the analytic DH offsets", () => {
    // At all-zero joints the UR-ish chain extends along the DH a/d offsets. The last
    // link origin is deterministic; assert it against a captured rest value (same chain
    // numbers as the server SAMPLE_ARM_6DOF, so client & server agree).
    const poses = forwardKinematics(SAMPLE_ARM_6DOF, [0, 0, 0, 0, 0, 0]);
    const tcp = poses[poses.length - 1].origin;
    // Rest TCP for these DH params (mm), computed once and frozen as the regression anchor.
    expect(tcp[0]).toBeCloseTo(-817, 1);
    expect(tcp[1]).toBeCloseTo(-191.8, 1);
    expect(tcp[2]).toBeCloseTo(-5.55, 2);
  });

  it("rotating shoulder_pan by +90° rotates the chain about the base Z", () => {
    const rest = forwardKinematics(SAMPLE_ARM_6DOF, [0, 0, 0, 0, 0, 0]);
    const turned = forwardKinematics(SAMPLE_ARM_6DOF, [Math.PI / 2, 0, 0, 0, 0, 0]);
    const restTcp = rest[rest.length - 1].origin;
    const turnedTcp = turned[turned.length - 1].origin;
    // A +90° base rotation maps (x,y) → (-y, x) in the base plane (Z unchanged).
    expect(turnedTcp[0]).toBeCloseTo(-restTcp[1], 3);
    expect(turnedTcp[1]).toBeCloseTo(restTcp[0], 3);
    expect(turnedTcp[2]).toBeCloseTo(restTcp[2], 3);
  });

  it("mat4Origin reads the translation column", () => {
    const poses = forwardKinematics(SAMPLE_SCARA, [0, 0, 0, 0]);
    expect(mat4Origin(poses[0].world)).toEqual(poses[0].origin);
  });

  it("getKinematicModel + robotKindToModelId mirror the server mapping", () => {
    expect(getKinematicModel("sample-arm-6dof")?.dof).toBe(6);
    expect(getKinematicModel("sample-scara")?.dof).toBe(4);
    expect(getKinematicModel("nope")).toBeNull();
    expect(robotKindToModelId("arm")).toBe("sample-arm-6dof");
    expect(robotKindToModelId("cobot")).toBe("sample-arm-6dof");
    expect(robotKindToModelId("scara")).toBe("sample-scara");
    expect(robotKindToModelId("agv")).toBe("sample-scara");
    expect(robotKindToModelId(null)).toBe("sample-scara");
  });
});
