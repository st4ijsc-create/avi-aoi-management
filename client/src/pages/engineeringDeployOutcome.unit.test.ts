/**
 * doc 80 Đợt 0 — Task 4 (WS-04 / WS-05) — phía client của màn Lập trình thiết bị.
 *
 * WS-04: khoá idempotency CỐ ĐỊNH (`dep-{build}-{stage}`, `depreq-{build}-production`,
 *        `rollback-dep-{id}`) ⇒ bấm lại sau khi bị từ chối nhận lại ĐÚNG dòng cũ (server trả
 *        hàng trước "as-is"); toast luôn báo thành công bất kể status.
 * WS-05: `buildId`/kết quả mô phỏng/chẩn đoán không reset khi đổi hoặc lưu phiên bản ⇒
 *        Deploy/Fleet đẩy build của phiên bản KHÁC phiên bản đang hiển thị.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deployOutcome, newDeployAttemptKey } from "./engineeringDeployOutcome";

describe("WS-04 — khoá idempotency mới cho MỖI lượt mở/xác nhận", () => {
  it("hai lượt liên tiếp cùng (build, stage) ⇒ hai khoá KHÁC nhau, cùng tiền tố đọc được", () => {
    const a = newDeployAttemptKey("dep", 12, "staging");
    const b = newDeployAttemptKey("dep", 12, "staging");
    expect(a).not.toBe(b);
    expect(a.startsWith("dep-12-staging-")).toBe(true);
    expect(a.length).toBeLessThanOrEqual(128);
  });

  it("EngineeringWorkspace không còn khoá cố định theo build/stage/deployment", () => {
    const src = readFileSync(resolve(__dirname, "EngineeringWorkspace.tsx"), "utf8");
    expect(src).not.toMatch(/idempotencyKey:\s*`dep-\$\{buildId\}-\$\{deployStage\}`/);
    expect(src).not.toMatch(/idempotencyKey:\s*`depreq-\$\{buildId\}-production`/);
    expect(src).not.toMatch(/idempotencyKey:\s*`rollback-dep-\$\{rollbackTarget\.id\}`/);
  });
});

describe("WS-04 — toast theo status THẬT của hàng trả về", () => {
  it("deploy: rejected/failed ⇒ error; verified ⇒ success; deployed ⇒ warning; simulated ⇒ success; pending ⇒ info", () => {
    expect(deployOutcome({ status: "rejected" }, "deploy").level).toBe("error");
    expect(deployOutcome({ status: "failed" }, "deploy").level).toBe("error");
    expect(deployOutcome({ status: "verified" }, "deploy").level).toBe("success");
    expect(deployOutcome({ status: "deployed" }, "deploy").level).toBe("warning");
    expect(deployOutcome({ status: "simulated" }, "deploy").level).toBe("success");
    expect(deployOutcome({ status: "pending" }, "deploy").level).toBe("info");
    expect(deployOutcome({ status: "awaiting_approval" }, "deploy").level).toBe("info");
  });

  it("server error text đi kèm khi bị từ chối/thất bại", () => {
    expect(deployOutcome({ status: "rejected", error: "Simulation Gate required" }, "deploy").detail).toBe(
      "Simulation Gate required",
    );
  });

  it("yêu cầu duyệt: awaiting_approval ⇒ success; rejected (build lỗi) ⇒ error — không luôn 'đã gửi'", () => {
    expect(deployOutcome({ status: "awaiting_approval" }, "request")).toMatchObject({
      level: "success",
      key: "engineering.deployRequested",
    });
    expect(deployOutcome({ status: "rejected", error: "Build is not ok" }, "request").level).toBe("error");
  });

  it("rollback: KHÔNG báo 'đã khôi phục' khi lượt lùi thất bại hoặc chỉ mô phỏng mà đích giữ nguyên", () => {
    const failed = deployOutcome({ status: "failed", error: "download NAK", targetRolledBack: false }, "rollback");
    expect(failed.level).toBe("error");
    expect(failed.key).not.toBe("engineering.rollbackDone");

    const simOnly = deployOutcome({ status: "simulated", targetRolledBack: false }, "rollback");
    expect(simOnly.level).toBe("warning");
    expect(simOnly.key).not.toBe("engineering.rollbackDone");

    expect(deployOutcome({ status: "verified", targetRolledBack: true }, "rollback")).toMatchObject({
      level: "success",
      key: "engineering.rollbackDone",
    });
    expect(deployOutcome({ status: "simulated", targetRolledBack: true }, "rollback").level).toBe("success");
  });
});

describe("WS-05 — đổi / lưu phiên bản ⇒ reset buildId + mô phỏng + chẩn đoán", () => {
  it("EngineeringWorkspace có effect theo artifactId reset cả ba trạng thái", () => {
    const src = readFileSync(resolve(__dirname, "EngineeringWorkspace.tsx"), "utf8");
    const effect = src.match(/useEffect\(\(\) => \{([^}]*)\}, \[artifactId\]\)/);
    expect(effect, "thiếu useEffect(..., [artifactId])").not.toBeNull();
    const body = effect![1]!;
    expect(body).toMatch(/setBuildId\(null\)/);
    expect(body).toMatch(/setSimResult\(null\)/);
    expect(body).toMatch(/setDiagnostics\(null\)/);
  });
});
