/**
 * ★ Census AST (2026-10-23) — test KHÔNG được tự `insert(users)` / `INSERT INTO users` ngoài helper `taoNguoiDungTest`.
 *
 * Vì sao: tệp test tạo admin/supervisor mà không dọn ⇒ `aoi_management_test` chất 1.951 admin/supervisor hoạt động, mọi cảnh báo "gửi cho mọi admin" nhân hàng theo số đó
 * (1,86 triệu hàng `notifications`). Helper `server/testing/nguoiDungTest.ts` đăng ký afterAll dọn đúng các id nó tạo.
 *
 * Hai danh sách MIỄN — chỉ được GIẢM (bậc thang):
 *   • TU_DON  — tệp có tự xoá người dùng (`delete(users)` / `DELETE FROM users`) nên không rò. TODO: chuyển dần sang helper khi sửa tệp.
 *   • CHUA_DON — tệp tạo người dùng mà KHÔNG có lệnh xoá ⇒ RÒ. TODO: chuyển sang `taoNguoiDungTest`. Bắt buộc không có lệnh xoá (nếu đã có xoá ⇒ chuyển sang TU_DON).
 * Mục lỗi thời (tệp không còn tạo người dùng, hoặc không còn tồn tại) ⇒ ĐỎ, buộc xoá khỏi danh sách.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const GOC = path.resolve(__dirname, "../..");
const THU_MUC = ["server", "scripts", "e2e", "client", "shared"];
const BO_QUA = new Set(["node_modules", ".git", "dist"]);
const HELPER_CENSUS = "server/testing/nguoiDungTest.census.test.ts";

/** Tệp tự xoá người dùng nó tạo. TODO: chuyển sang `taoNguoiDungTest` (chỉ được GIẢM). */
export const TU_DON: readonly string[] = [
  "e2e/twin-dot31-may.spec.ts",
  "scripts/edge-node-credential.bundle.dot10.db.test.ts",
  "scripts/edge-node-credential.dot9.test.ts",
  "scripts/edge-node-credential.round2.dot10.db.test.ts",
  "scripts/flow-backfill-pham-vi.db.test.ts",
  "scripts/mappings-import.actor.dot4.db.test.ts",
  "scripts/mappings-import.stopPin.dot1d.db.test.ts",
  "server/_core/cheDo2faTheoTrienKhai.test.ts",
  "server/_core/requireAnyPermissionKhoiC.db.test.ts",
  "server/_core/socketPhamViPhong.db.test.ts",
  "server/api/v1/apiKeyOwner.dot4.db.test.ts",
  "server/db/aiCodingLessonScope.test.ts",
  "server/db/congPhamViGop.db.test.ts",
  "server/db/twinBanGhi.db.test.ts",
  "server/db/twinDemVatThePhamVi.db.test.ts",
  "server/routers/aiCodingSessionScope.test.ts",
  "server/routers/andonGhiChuPhamVi.db.test.ts",
  "server/routers/apiKeyRouterHolder.dot9.db.test.ts",
  "server/routers/canhNhieuNhaMayPhamVi.db.test.ts",
  "server/routers/cayDayRouter.db.test.ts",
  "server/routers/commissioningRouter.recheck.dot4.db.test.ts",
  "server/routers/digitalTwinPhamVi.db.test.ts",
  "server/routers/duAnCaNhanRouter.test.ts",
  "server/routers/engineeringAssignment.db.test.ts",
  "server/routers/enhancedAuditScope.dot4.db.test.ts",
  "server/routers/factoryCommandAssetCockpitPhamVi.db.test.ts",
  "server/routers/factoryListCongQuyen.db.test.ts",
  "server/routers/flowRouter.db.test.ts",
  "server/routers/flowRouterOt.db.test.ts",
  "server/routers/flowRouterPhamVi.db.test.ts",
  "server/routers/ganKyThuatVienQuyen.db.test.ts",
  "server/routers/gatewayAllowlistRouter.db.test.ts",
  "server/routers/integrityRouterPermission.db.test.ts",
  "server/routers/layoutRoutersPermissionKhoiD.db.test.ts",
  "server/routers/machineApiPanelOperator.test.ts",
  "server/routers/maintenanceAndonPhamVi.db.test.ts",
  "server/routers/mqttBindMachine.db.test.ts",
  "server/routers/notificationBell.db.test.ts",
  "server/routers/oeeScopeLabels.db.test.ts",
  "server/routers/orchestrationScope.dot5.db.test.ts",
  "server/routers/phamViDoc11File.db.test.ts",
  "server/routers/phamViDocPatch.db.test.ts",
  "server/routers/quanLyDuAnRepo.test.ts",
  "server/routers/repoWorkspaceDot3b.test.ts",
  "server/routers/robotStopDegradedAuth.dot10.db.test.ts",
  "server/routers/safetyAssignmentShift.dot3b.db.test.ts",
  "server/routers/trangThaiNhieuNhaMayPhamVi.db.test.ts",
  "server/routers/twinBonManApiVaiPhamVi.db.test.ts",
  "server/routers/twinFactoryScope.dot4.db.test.ts",
  "server/routers/userUiPrefs.dot4.db.test.ts",
  "server/routers/userUiPrefsHaiTrinhDuyet.dot4.db.test.ts",
  "server/routes/congAnhPhamVi.db.test.ts",
  "server/routes/uyQuyenAnhPhamVi.db.test.ts",
  "server/services/edge/edgeExecution.fw.dot9fw.db.test.ts",
  "server/services/edge/edgeExecution.s12.dot9.db.test.ts",
  "server/services/flow/biMatHost.db.test.ts",
  "server/services/flow/flowPhamViChuLuong.db.test.ts",
  "server/services/flow/flowPhamViLuong.db.test.ts",
  "server/services/flow/kichHoat/mcp.db.test.ts",
  "server/services/flow/kichHoat/mcpGiayPhep.db.test.ts",
  "server/services/flow/luongCon.db.test.ts",
  "server/services/flow/quyenDuyet.db.test.ts",
  "server/services/oeeWarRoomScope.db.test.ts",
  "server/services/operatorBadgeService.test.ts",
  "server/services/orchestration/foe/foeApiKeyHolderDispatchers.dot9.db.test.ts",
  "server/services/ot/commissioningPinOrder.dot5.db.test.ts",
  "server/services/ot/safetyTarget.dot4.db.test.ts",
  "server/services/ot/stopPin.dot1d.db.test.ts",
  "server/services/programming/deployPreview.db.test.ts",
  "server/services/programming/expectedProjectGuard.db.test.ts",
  "server/services/robot/criticalStopAlert.khuTrung.db.test.ts",
  "server/services/scheduledReportScope.db.test.ts",
];

/** Tệp tạo người dùng KHÔNG xoá ⇒ rò. TODO: chuyển sang `taoNguoiDungTest` (chỉ được GIẢM). */
export const CHUA_DON: readonly string[] = [
  "scripts/edge-node-credential.retire.dot12.db.test.ts",
  "server/services/edge/edgeControlSchema.dot10.db.test.ts",
  "server/services/edge/edgeDbSearchPath.dot10.db.test.ts",
  "server/services/edge/edgeDbSearchPath0376.dot10.db.test.ts",
  "server/services/edge/edgeHumanResolverAuth.dot10.db.test.ts",
  "server/services/edge/edgeResolution.dot10.db.test.ts",
  "server/services/edge/edgeStopNeverDropped.dot10.db.test.ts",
  "server/services/edge/otIntentResolve.dot10.db.test.ts",
  "server/services/edge/otIntentResultRace.dot10.db.test.ts",
  "server/services/edge/stopAckLockOrder.dot11.db.test.ts",
  "server/services/robot/centralStopSweepLockOrder.dot11.db.test.ts",
];

/** Trần số tệp CHƯA_DON — hạ khi chuyển thêm. */
const TRAN_CHUA_DON = 11;
const TRAN_TU_DON = 72;

function lietKeTest(): string[] {
  const kq: string[] = [];
  const di = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (BO_QUA.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) di(p);
      else if (/\.(test|spec)\.tsx?$/.test(e.name)) kq.push(path.relative(GOC, p).replace(/\\/g, "/"));
    }
  };
  for (const t of THU_MUC) if (fs.existsSync(path.join(GOC, t))) di(path.join(GOC, t));
  return kq.filter((f) => f !== HELPER_CENSUS);
}

export interface KetQuaQuet {
  tao: boolean;
  xoa: boolean;
}

const RE_INSERT_SQL = /INSERT\s+INTO\s+(public\.)?"?users"?\b/i;
const RE_DELETE_SQL = /DELETE\s+FROM\s+(public\.)?"?users"?\b/i;

/** Quét một nguồn: có tạo người dùng (`.insert(users)` hoặc chuỗi SQL `INSERT INTO users`) và có xoá không. */
export function quetNguon(ten: string, nguon: string): KetQuaQuet {
  const sf = ts.createSourceFile(ten, nguon, ts.ScriptTarget.Latest, true);
  let tao = false;
  let xoa = RE_DELETE_SQL.test(nguon);
  const di = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const a = n.arguments[0];
      const laUsers = !!a && ts.isIdentifier(a) && a.text === "users";
      if (n.expression.name.text === "insert" && laUsers) tao = true;
      if (n.expression.name.text === "delete" && laUsers) xoa = true;
    }
    if (ts.isTemplateExpression(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isStringLiteral(n)) {
      if (RE_INSERT_SQL.test(n.getText(sf))) tao = true;
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return { tao, xoa };
}

const quetTatCa = () => {
  const kq = new Map<string, KetQuaQuet>();
  for (const f of lietKeTest()) kq.set(f, quetNguon(f, fs.readFileSync(path.join(GOC, f), "utf8")));
  return kq;
};

describe("census — test không tự insert(users) ngoài taoNguoiDungTest", () => {
  const ket = quetTatCa();
  const ngoaiLe = new Set([...TU_DON, ...CHUA_DON]);

  it("★ mọi tệp test tạo người dùng đều nằm trong danh sách miễn (hoặc dùng helper)", () => {
    const vi = [...ket].filter(([f, k]) => k.tao && !ngoaiLe.has(f)).map(([f]) => f);
    expect(vi, "tệp mới tự insert(users): dùng taoNguoiDungTest (server/testing/nguoiDungTest.ts)").toEqual([]);
  });

  it("★ bậc thang: mục lỗi thời (tệp mất / không còn tạo người dùng) phải bị xoá khỏi danh sách", () => {
    const loiThoi = [...ngoaiLe].filter((f) => !ket.get(f)?.tao);
    expect(loiThoi).toEqual([]);
  });

  it("★ TU_DON thật sự có xoá; CHUA_DON thật sự KHÔNG có xoá (sai nhóm ⇒ đỏ)", () => {
    expect(TU_DON.filter((f) => !ket.get(f)?.xoa)).toEqual([]);
    expect(CHUA_DON.filter((f) => ket.get(f)?.xoa)).toEqual([]);
  });

  it("★ hai danh sách không giao nhau, không trùng, và chỉ được GIẢM (trần)", () => {
    expect(TU_DON.filter((f) => CHUA_DON.includes(f))).toEqual([]);
    expect(new Set(TU_DON).size).toBe(TU_DON.length);
    expect(new Set(CHUA_DON).size).toBe(CHUA_DON.length);
    expect(CHUA_DON.length).toBeLessThanOrEqual(TRAN_CHUA_DON);
    expect(TU_DON.length).toBeLessThanOrEqual(TRAN_TU_DON);
  });

  it("★ năm tệp đã chuyển KHÔNG còn insert(users) và dùng helper", () => {
    for (const f of [
      "server/_core/accessControlScope.test.ts",
      "server/routers/reportServiceScope.test.ts",
      "server/routers/defectHeatmapSavedScope.test.ts",
      "server/services/defectSpatialHeatmap.scope.test.ts",
      "server/db/statisticsDailyScope.test.ts",
      "server/routers/reportExportScope.test.ts",
      "server/db/statisticsScope.test.ts",
    ]) {
      expect(ket.get(f)?.tao, f).toBe(false);
      expect(fs.readFileSync(path.join(GOC, f), "utf8"), f).toContain("taoNguoiDungTest");
    }
  });
});

describe("census — đột biến của chính bộ quét", () => {
  it.each([
    ["Drizzle insert", "await db.insert(users).values({})", true],
    ["Drizzle insert qua conn!", "await conn!.insert(users).values({})", true],
    ["SQL thô", "await db.execute(sql`INSERT INTO users (id) VALUES (1)`)", true],
    ["SQL thô có public.", "const q = 'insert into public.users(id) values (1)'", true],
    ["bảng khác", "await db.insert(machines).values({})", false],
    ["chữ 'users_x'", "const q = 'INSERT INTO users_archive (a) VALUES (1)'", false],
    ["chỉ nhắc trong comment", "// insert(users) bị cấm", false],
  ])("%s", (_t, nguon, mongDoi) => {
    expect(quetNguon("x.test.ts", nguon as string).tao).toBe(mongDoi);
  });
  it("nhận ra lệnh xoá (Drizzle và SQL)", () => {
    expect(quetNguon("x.ts", "await db.delete(users).where(a)").xoa).toBe(true);
    expect(quetNguon("x.ts", "DELETE FROM users WHERE id=1").xoa).toBe(true);
    expect(quetNguon("x.ts", "await db.delete(machines)").xoa).toBe(false);
  });
});
