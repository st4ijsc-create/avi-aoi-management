/**
 * Pha 0 · C0-5 — NỐI DÂY cổng mô-đun robot (kiem-dinh 2026-11-06: gỡ `<CongMoDunRobot>` khỏi route hoặc bỏ `<RobotModuleProvider>` bọc App ⇒ 186 test vẫn xanh,
 * vì cổng mới chỉ được test ở mức component). Lưới NGUỒN này ghim phần nối:
 *   • mỗi trong ba route robot/AGV bọc đúng trang bằng `<CongMoDunRobot>`;
 *   • `<RobotModuleProvider>` bọc cây route (`<Router />`) trong App.tsx;
 *   • truy vấn posture ở hook KHÔNG retry (`retry: false`) — lỗi/đang tải ⇒ đóng ngay, không đợi 3 lần thử.
 * Đột biến: bỏ bọc một route / bỏ Provider / đổi `retry: false` ⇒ đỏ.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../..");
const app = readFileSync(resolve(SRC, "App.tsx"), "utf8");
const hook = readFileSync(resolve(SRC, "hooks/useRobotModuleTamDung.tsx"), "utf8");

const ROUTE_ROBOT: ReadonlyArray<[string, string]> = [
  ["/robot-control", "RobotControl"],
  ["/command-console", "CommandConsole"],
  ["/labs/fleet-orchestration", "FleetOrchestration"],
];

describe("C0-5 nối dây — App.tsx", () => {
  for (const [duong, trang] of ROUTE_ROBOT) {
    it(`route ${duong} bọc <${trang} /> bằng <CongMoDunRobot>`, () => {
      const dong = app.split("\n").filter((l) => l.includes(`<Route path="${duong}">`));
      expect(dong.length, `đúng MỘT route ${duong}`).toBe(1);
      expect(dong[0]).toContain(`<CongMoDunRobot><${trang} /></CongMoDunRobot>`);
    });
  }

  it("<RobotModuleProvider> bọc <Router /> (mở trước, đóng sau) và chỉ xuất hiện một lần", () => {
    expect(app.match(/<RobotModuleProvider>/g)?.length).toBe(1);
    expect(app.match(/<\/RobotModuleProvider>/g)?.length).toBe(1);
    const mo = app.indexOf("<RobotModuleProvider>");
    const router = app.indexOf("<Router />");
    const dong = app.indexOf("</RobotModuleProvider>");
    expect(mo).toBeGreaterThan(-1);
    expect(mo).toBeLessThan(router);
    expect(router).toBeLessThan(dong);
  });
});

describe("C0-5 — truy vấn posture đóng-khi-lỗi", () => {
  it("`oversight.posture.useQuery` có `retry: false`", () => {
    const m = hook.match(/trpc\.oversight\.posture\.useQuery\([^)]*\)/s);
    expect(m, "không thấy truy vấn posture trong hook").not.toBeNull();
    expect(m![0]).toMatch(/retry:\s*false/);
  });
});
