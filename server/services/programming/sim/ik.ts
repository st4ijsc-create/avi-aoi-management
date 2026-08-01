/**
 * T2b (doc 22 P5) — NUMERICAL INVERSE KINEMATICS (IK) for the kinematic Simulation Gate.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * PURPOSE — close the Simulation-Gate blind spot on Cartesian (`move_linear`) moves. Until
 * now the gate could only run REAL full-arm collision on `move_joint` (which already carries
 * joint values → FK). A `move_linear` carries a Cartesian TCP pose with no joint values, so
 * the gate could only check the tool POINT against workspace + obstacle proximity — the rest
 * of the arm was invisible. This module turns a target TCP position into a joint config so
 * the SAME full-arm FK → collision / joint-limit / workspace / safety-zone checks run for
 * Cartesian moves too.
 *
 * ── APPROACH (honest scope) ─────────────────────────────────────────────────
 *   • NUMERICAL IK — Damped Least Squares (Levenberg–Marquardt), with a Jacobian-transpose
 *     fallback if the DLS step does not reduce error. This is a general iterative solver that
 *     works for ANY chain the FK can evaluate — no closed-form / vendor-specific geometry.
 *   • Reuses the EXISTING FK (forwardKinematics / tcpPosition in kinematicModel.ts). The
 *     Jacobian is built by FINITE DIFFERENCES on that FK, so there is ZERO duplication of the
 *     DH / URDF-exact chain math — swap the FK and IK follows.
 *   • POSITION-ONLY target by default (3-DOF task). A `move_linear` block in the IR carries a
 *     full pose, but the sample models are position-reachability models; orientation tracking
 *     is left as a documented extension (targetOrientation hook is threaded but the default
 *     task minimises TCP POSITION error, which is what the collision gate needs).
 *   • SINGLE ARM, no redundancy resolution beyond SEEDING: for a redundant chain the solver
 *     returns ONE solution near the seed (good for path continuity — seed each waypoint from
 *     the previous solution). It does not enumerate the null-space / branch families.
 *   • PURE + DETERMINISTIC — fixed iteration cap, no Math.random, no time/DB. Given the same
 *     (model, target, seed, options) it always returns the same result. Joint limits are
 *     honoured by CLAMPING each iterate into range, so a returned solution never itself
 *     violates a declared limit (the caller still re-checks, and reports UNREACHABLE when the
 *     clamped chain cannot reach the target within tolerance).
 * ════════════════════════════════════════════════════════════════════════════
 */
import {
  type KinematicModel,
  type Vec3,
  tcpPosition,
  v3sub,
  v3len,
} from "./kinematicModel";

/** Result of an IK solve. `reached` is false when it did not converge within tolerance. */
export interface IkResult {
  /** True when the returned joints put the TCP within `positionToleranceMm` of the target. */
  reached: boolean;
  /** Joint solution (length == model.dof), clamped into declared limits. Best-effort even when !reached. */
  joints: number[];
  /** Final TCP position error magnitude (mm). */
  errorMm: number;
  /** Iterations actually run (≤ maxIterations). */
  iterations: number;
}

export interface IkOptions {
  /** Convergence tolerance on TCP position error (mm). Default 1.0 mm. */
  positionToleranceMm?: number;
  /** Hard cap on solver iterations (determinism). Default 200. */
  maxIterations?: number;
  /**
   * Damping factor λ for Damped Least Squares (mm-scaled). Larger = more stable near
   * singularities but slower. Default 50 (mm), suited to the mm-length sample models.
   */
  damping?: number;
  /** Finite-difference step for the numerical Jacobian (rad/mm on each joint). Default 1e-4. */
  fdStep?: number;
  /** Seed joint config (length ≤ model.dof; padded with 0). Default all-zero (home). */
  seed?: number[];
  /**
   * Optional target orientation hook — NOT solved by the default position task (documented
   * scope). Reserved so a future orientation-aware task can consume it without a signature
   * change. Currently ignored by the solver.
   */
  targetOrientation?: Vec3;
}

/** Clamp a joint value into the model's declared limit for the joint at value-index `vi`. */
function clampToLimit(model: KinematicModel, valueIndex: number, value: number): number {
  // Map value-index → the corresponding non-fixed joint (fixed joints consume no value).
  let vi = 0;
  for (const joint of model.joints) {
    if (joint.type === "fixed") continue;
    if (vi === valueIndex) {
      if (joint.limits) return Math.max(joint.limits.min, Math.min(joint.limits.max, value));
      return value;
    }
    vi += 1;
  }
  return value;
}

/** Clamp a full joint vector into all declared limits. */
function clampAll(model: KinematicModel, joints: number[]): number[] {
  return joints.map((v, i) => clampToLimit(model, i, v));
}

/**
 * Numerical position Jacobian J (3 × dof): column j is ∂TCP/∂q_j by central finite
 * differences on the EXISTING FK. Pure; no allocation beyond the returned matrix.
 * Row-major flat: J[r*dof + c].
 */
function positionJacobian(model: KinematicModel, joints: number[], fdStep: number): number[] {
  const dof = model.dof;
  const J = new Array<number>(3 * dof).fill(0);
  for (let c = 0; c < dof; c++) {
    const plus = joints.slice();
    const minus = joints.slice();
    plus[c] += fdStep;
    minus[c] -= fdStep;
    const tp = tcpPosition(model, plus);
    const tm = tcpPosition(model, minus);
    const inv = 1 / (2 * fdStep);
    J[0 * dof + c] = (tp[0] - tm[0]) * inv;
    J[1 * dof + c] = (tp[1] - tm[1]) * inv;
    J[2 * dof + c] = (tp[2] - tm[2]) * inv;
  }
  return J;
}

/**
 * Solve one Damped-Least-Squares step: Δq = Jᵀ (J Jᵀ + λ²I₃)⁻¹ · e, where e is the 3-vector
 * TCP position error (target − current). The 3×3 inverse is closed-form (adjugate/det), so
 * there is no external linear-algebra dependency. Returns Δq (length dof) or null if the 3×3
 * system is singular (caller falls back to Jacobian transpose).
 */
function dlsStep(J: number[], dof: number, error: Vec3, lambda: number): number[] | null {
  // A = J Jᵀ + λ²I  (3×3, symmetric).
  const l2 = lambda * lambda;
  const A = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let r = 0; r < 3; r++) {
    for (let cc = 0; cc < 3; cc++) {
      let s = 0;
      for (let k = 0; k < dof; k++) s += J[r * dof + k] * J[cc * dof + k];
      A[r][cc] = s + (r === cc ? l2 : 0);
    }
  }
  // 3×3 inverse via cofactors.
  const det =
    A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
    A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
    A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
  if (Math.abs(det) < 1e-12) return null;
  const invDet = 1 / det;
  const inv = [
    [
      (A[1][1] * A[2][2] - A[1][2] * A[2][1]) * invDet,
      (A[0][2] * A[2][1] - A[0][1] * A[2][2]) * invDet,
      (A[0][1] * A[1][2] - A[0][2] * A[1][1]) * invDet,
    ],
    [
      (A[1][2] * A[2][0] - A[1][0] * A[2][2]) * invDet,
      (A[0][0] * A[2][2] - A[0][2] * A[2][0]) * invDet,
      (A[0][2] * A[1][0] - A[0][0] * A[1][2]) * invDet,
    ],
    [
      (A[1][0] * A[2][1] - A[1][1] * A[2][0]) * invDet,
      (A[0][1] * A[2][0] - A[0][0] * A[2][1]) * invDet,
      (A[0][0] * A[1][1] - A[0][1] * A[1][0]) * invDet,
    ],
  ];
  // y = A⁻¹ · e  (3-vector).
  const e: Vec3 = error;
  const y: Vec3 = [
    inv[0][0] * e[0] + inv[0][1] * e[1] + inv[0][2] * e[2],
    inv[1][0] * e[0] + inv[1][1] * e[1] + inv[1][2] * e[2],
    inv[2][0] * e[0] + inv[2][1] * e[1] + inv[2][2] * e[2],
  ];
  // Δq = Jᵀ · y.
  const dq = new Array<number>(dof).fill(0);
  for (let c = 0; c < dof; c++) {
    dq[c] = J[0 * dof + c] * y[0] + J[1 * dof + c] * y[1] + J[2 * dof + c] * y[2];
  }
  return dq;
}

/** Jacobian-transpose step Δq = α · Jᵀ · e (fallback when DLS is singular). */
function transposeStep(J: number[], dof: number, error: Vec3, alpha: number): number[] {
  const dq = new Array<number>(dof).fill(0);
  for (let c = 0; c < dof; c++) {
    dq[c] = alpha * (J[0 * dof + c] * error[0] + J[1 * dof + c] * error[1] + J[2 * dof + c] * error[2]);
  }
  return dq;
}

/**
 * Solve inverse kinematics for a target TCP POSITION, seeded from `opts.seed`.
 *
 * Returns `{ reached, joints, errorMm, iterations }`. `reached` is true iff the returned
 * joints (clamped into limits) place the TCP within `positionToleranceMm` of the target.
 * When the target is out of reach (or blocked by joint limits) `reached` is false and the
 * caller must treat it as a REACHABILITY failure — never a silent pass.
 *
 * PURE + deterministic: fixed iteration cap, no randomness. Reuses the model's FK for both
 * the residual and the (finite-difference) Jacobian, so the DH / URDF-exact math is never
 * duplicated here.
 */
export function solveIk(model: KinematicModel, target: Vec3, opts: IkOptions = {}): IkResult {
  const tol = opts.positionToleranceMm ?? 1.0;
  const maxIter = Math.max(1, Math.round(opts.maxIterations ?? 200));
  const lambda = opts.damping ?? 50;
  const fdStep = opts.fdStep ?? 1e-4;

  // Seed → full dof vector, clamped into limits so we start feasible.
  const seed = opts.seed ?? [];
  let q = clampAll(
    model,
    Array.from({ length: model.dof }, (_, i) => seed[i] ?? 0),
  );

  let bestQ = q.slice();
  let bestErr = v3len(v3sub(target, tcpPosition(model, q)));
  let iterations = 0;

  // ADAPTIVE damping (Levenberg–Marquardt trust-region flavour): shrink λ after a step that
  // reduces error (take bigger, Gauss-Newton-like steps), grow it after a failed step (fall
  // back to a smaller, gradient-like step). This handles the ill-conditioning of MIXED-unit
  // chains (revolute rad + prismatic mm columns) far better than a fixed λ. Deterministic.
  let lam = lambda;
  const lamMin = Math.max(1e-3, lambda * 1e-4);
  const lamMax = lambda * 1e6;

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;
    const tcp = tcpPosition(model, q);
    const error = v3sub(target, tcp);
    const errMag = v3len(error);
    if (errMag < bestErr) {
      bestErr = errMag;
      bestQ = q.slice();
    }
    if (errMag <= tol) break;

    const J = positionJacobian(model, q, fdStep);

    // Try successively larger damping until a step reduces error (LM trust region). Each try
    // is a bounded loop → deterministic + terminating.
    let applied = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      let dq = dlsStep(J, model.dof, error, lam);
      if (!dq) dq = transposeStep(J, model.dof, error, 1e-6); // singular → gradient step
      const trial = clampAll(
        model,
        q.map((v, i) => v + dq![i]),
      );
      const trialErr = v3len(v3sub(target, tcpPosition(model, trial)));
      if (trialErr < errMag) {
        q = trial;
        lam = Math.max(lamMin, lam * 0.5); // success → trust a bigger step next time
        applied = true;
        break;
      }
      lam = Math.min(lamMax, lam * 2.5); // failure → damp harder, smaller step
    }
    if (!applied) {
      // No downhill step even at max damping (true local min / limit-locked) → report best.
      break;
    }
  }

  // Final feasible pose from the best iterate seen.
  const finalTcp = tcpPosition(model, bestQ);
  const errorMm = v3len(v3sub(target, finalTcp));
  return {
    reached: errorMm <= tol,
    joints: bestQ,
    errorMm,
    iterations,
  };
}
