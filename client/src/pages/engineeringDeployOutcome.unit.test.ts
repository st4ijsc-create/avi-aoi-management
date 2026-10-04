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
import {
  initialWorkspaceState,
  workspaceReducer,
  type WorkspaceState,
} from "@/components/engineering/workspace/workspaceReducer";

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
  // doc 81 Đợt 2 Task 12 — ghim lại: hệ quả này rời `useEffect(..., [artifactId])` của trang sang
  // hành động "artifact/select" của workspaceReducer (WorkspaceContext). Đo HÀNH VI ở reducer, và
  // đo ở trang rằng cả hai lối đổi phiên bản (bấm chọn + createArtifact.onSuccess) đi qua đúng hành
  // động đó, còn buildId/simResult/diagnostics không còn state cục bộ nào để vòng qua chuỗi reset.
  it("đổi/lưu phiên bản (artifact/select) reset cả ba trạng thái; trang chỉ đổi phiên bản qua hành động ấy", () => {
    const armed: WorkspaceState = {
      ...initialWorkspaceState,
      projectId: 1,
      artifactId: 11,
      buildId: 5,
      simResult: { ok: true, warnings: [], timeline: [] },
      diagnostics: [{ severity: "error", message: "E" }],
    };
    const s = workspaceReducer(armed, { type: "artifact/select", artifactId: 12 });
    expect(s.buildId).toBeNull();
    expect(s.simResult).toBeNull();
    expect(s.diagnostics).toBeNull();

    const src = readFileSync(resolve(__dirname, "EngineeringWorkspace.tsx"), "utf8");
    expect(src).toMatch(/guardDirty\(\(\) => dispatch\(\{ type: "artifact\/select", artifactId: a\.id \}\)\)/);
    // Task 12b — lưu phiên bản đi qua "artifact/created" (gắn project lúc yêu cầu) ⇒ cùng withArtifact.
    // Bị chặn trong khối createArtifact (không vượt sang useMutation khác) — review task 12 Minor 2.
    expect(src).toMatch(/const createArtifact = trpc\.programming\.createArtifact\.useMutation\(\{(?:(?!useMutation)[^])*?dispatch\(\{ type: "artifact\/created", projectId: vars\.projectId, artifactId: row\.id \}\)/);
    const luu = workspaceReducer(armed, { type: "artifact/created", projectId: 1, artifactId: 13 });
    expect([luu.buildId, luu.simResult, luu.diagnostics]).toEqual([null, null, null]);
    expect(src).not.toMatch(/\buseState\s*[<(]/);
    expect(src).not.toMatch(/\bset(BuildId|SimResult|Diagnostics|ArtifactId)\b/);
  });
});

describe("doc 81 Đợt 1B Task 4 — lý do deploy có mã ⇒ khoá i18n (vi/en/zh)", () => {
  const LOCALES = ["vi", "en", "zh"] as const;
  const load = (l: string) =>
    JSON.parse(readFileSync(resolve(__dirname, "..", "i18n", "locales", `${l}.json`), "utf8")) as Record<string, any>;

  it("robot-tm: detailJson.reasonCode techman_program_download_unsupported ⇒ detailKey riêng, level error", () => {
    const o = deployOutcome(
      {
        status: "failed",
        error: "techman_program_download_unsupported: ...",
        detailJson: { reasonCode: "techman_program_download_unsupported" },
      },
      "deploy",
    );
    expect(o.level).toBe("error");
    expect(o.detailKey).toBe("engineering.deployReason.techman_program_download_unsupported");
    expect(o.detail).toBe("techman_program_download_unsupported: ...");
  });

  it("mã lạ / không có mã ⇒ không có detailKey (giữ nguyên hiển thị lỗi server như cũ)", () => {
    expect(deployOutcome({ status: "failed", error: "x", detailJson: { reasonCode: "khong_biet" } }, "deploy").detailKey).toBeUndefined();
    expect(deployOutcome({ status: "failed", error: "x" }, "deploy").detailKey).toBeUndefined();
  });

  it("khoá có đủ ở vi/en/zh", () => {
    for (const l of LOCALES) {
      const v = load(l)?.engineering?.deployReason?.techman_program_download_unsupported;
      expect(typeof v === "string" && v.trim().length > 0, `${l}.json thiếu khoá`).toBe(true);
    }
  });
});
