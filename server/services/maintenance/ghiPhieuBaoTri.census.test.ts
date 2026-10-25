/**
 * Census — ĐIỂM GHI `maintenance_work_orders`: ba đường do NGƯỜI/AI/LUỒNG khởi (router `createWorkOrder` · AI tool `create_maintenance_workorder` · node luồng
 * `bao-tri.tao-phieu`) PHẢI đi qua MỘT helper `ghiPhieuBaoTri`. Chỉ ba dịch vụ HỆ THỐNG tự sinh phiếu (PdM / lịch bảo trì) được tự insert — danh sách MIỄN chỉ được GIẢM;
 * mục lỗi thời ⇒ ĐỎ. Tệp test / testing / scripts không tính.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const GOC = path.resolve(__dirname, "../..");
const BO_QUA = new Set(["node_modules", ".git", "dist"]);

export const HE_THONG_TU_SINH: readonly string[] = [
  "services/pdmAutoWorkOrderService.ts",
  "services/pdmWorkOrderService.ts",
  "services/pmScheduleService.ts",
];

function tep(dir: string, ra: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (BO_QUA.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) tep(p, ra);
    else if (/\.ts$/.test(e.name) && !/\.(test|spec)\.ts$/.test(e.name) && !p.includes(`${path.sep}testing${path.sep}`)) ra.push(p);
  }
  return ra;
}

const DOC = tep(GOC).map((p) => ({ rel: path.relative(GOC, p).split(path.sep).join("/"), nd: fs.readFileSync(p, "utf8") }));
const GHI = /insert\(\s*maintenanceWorkOrders\s*\)|INSERT\s+INTO\s+(public\.)?maintenance_work_orders/i;

describe("điểm ghi maintenance_work_orders", () => {
  it("chỉ ghiPhieuBaoTri.ts + ba dịch vụ hệ thống tự sinh được insert; không có cửa thứ hai", () => {
    const co = DOC.filter((x) => GHI.test(x.nd)).map((x) => x.rel).sort();
    expect(co, "thêm cửa insert phiếu bảo trì ⇒ dùng ghiPhieuBaoTri (hoặc khai miễn có lý do)").toEqual(["services/maintenance/ghiPhieuBaoTri.ts", ...HE_THONG_TU_SINH].sort());
  });

  it("mục miễn lỗi thời ⇒ đỏ (tệp vẫn tồn tại và vẫn insert)", () => {
    for (const rel of HE_THONG_TU_SINH) {
      const x = DOC.find((d) => d.rel === rel);
      expect(x, `${rel} không còn tồn tại — xoá khỏi danh sách`).toBeDefined();
      expect(GHI.test(x!.nd), `${rel} không còn insert — xoá khỏi danh sách`).toBe(true);
    }
  });

  it("ba đường người/AI/luồng đều gọi ghiPhieuBaoTri", () => {
    for (const rel of ["routers/maintenanceRouter.ts", "services/aiLocalTools/writeHandlers/maintenance.ts", "services/flow/nut/baoTri.ts"]) {
      const x = DOC.find((d) => d.rel === rel);
      expect(x, rel).toBeDefined();
      expect(/\bghiPhieuBaoTri\s*\(/.test(x!.nd), `${rel} phải gọi ghiPhieuBaoTri`).toBe(true);
    }
  });
});
