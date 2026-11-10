/**
 * ★ Census AST (2026-10-23) — test KHÔNG được tự `insert(users)` / `INSERT INTO users` ngoài helper `taoNguoiDungTest`.
 *
 * Vì sao: tệp test tạo admin/supervisor mà không dọn ⇒ `aoi_management_test` chất 1.951 admin/supervisor hoạt động, mọi cảnh báo "gửi cho mọi admin" nhân hàng theo số đó
 * (1,86 triệu hàng `notifications`). Helper `server/testing/nguoiDungTest.ts` đăng ký afterAll dọn đúng các id nó tạo.
 *
 * Luật hiện hành (2026-11-02, kiem-dinh N3): test KHÔNG DELETE, mọi dọn dẹp bằng ROLLBACK ⇒ cách ĐÚNG để một test có người dùng là chèn TRONG giao dịch bị hoàn tác.
 * Tệp tạo người dùng được phân loại bằng AST (không còn danh sách tay + trần cho nhóm này):
 *   • HOÀN TÁC (TỰ NHẬN BIẾT) — có `.transaction(cb)` / `.begin(cb)` (postgres.js) mà `cb` ném một giá trị tên có "rollback" (hoặc câu `ROLLBACK` thô), KHÔNG xoá người dùng, và KHÔNG chèn người
 *     dùng qua kết nối chung (`db` / `conn` / `getDb()` …) ⇒ không bao giờ commit ⇒ không rò. Tệp mới đúng kiểu này KHÔNG phải sửa census.
 *   • TU_DON  — tệp CŨ tự xoá người dùng nó tạo (`delete(users)` / `DELETE FROM users`). Trái luật mới nhưng CHƯA bắt buộc chuyển: chỉ được GIẢM (trần).
 *   • CHUA_DON — tạo mà KHÔNG xoá ⇒ RÒ. Đã RỖNG, phải giữ rỗng.
 *   • Helper `taoNguoiDungTest` — LỖI THỜI (nó DELETE): không dùng cho tệp mới; tệp đang dùng giữ nguyên, chuyển dần sang giao dịch hoàn tác.
 * Mục lỗi thời trong danh sách (tệp mất / không còn tạo người dùng) ⇒ ĐỎ, buộc xoá khỏi danh sách.
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
];

/** Tệp tạo người dùng KHÔNG xoá ⇒ RÒ. ĐÃ RỖNG (2026-10-23): bốn tệp rò đã chuyển sang `taoNguoiDungTest`, bảy tệp còn lại hoá ra không rò (chúng nằm trong giao dịch hoàn tác). Phải GIỮ rỗng. */
export const CHUA_DON: readonly string[] = [];

/**
 * ★ MIỄN TRỪ CÓ HẠN, ĐÚNG MỘT TỆP (2026-11-03, phiên điều phối, phán quyết (a) của F5 đầy đủ fix round 1) — tệp ĐẦU-CUỐI COMMIT ⇒ NOTIFY ⇒
 * socket rớt. Lý do: "NOTIFY chỉ giao lúc COMMIT, ROLLBACK không thể kiểm". Bằng chứng (cả hai được census KIỂM, không chỉ ghi):
 *   • tài liệu Postgres, lệnh NOTIFY: "if a NOTIFY is executed inside a transaction, the notify events are not delivered until and unless the
 *     transaction is committed" (https://www.postgresql.org/docs/current/sql-notify.html);
 *   • ca HOÀN TÁC `ROLLBACK_KHONG_GIAO_THONG_BAO` trong `socketPhamVi0435.db.test.ts`: một lượt ghi bị hoàn tác KHÔNG giao thông báo nào tới
 *     một LISTEN thật (đối chứng: một NOTIFY đã commit thì tới).
 * Điều kiện (kiểm trên NGUỒN, mất một ⇒ ĐỎ): tiền tố `skpvtb`, vai ứng dụng (không owner `aoi` / MIGRATION_DB_*), không id tường minh trong
 * INSERT, dọn bằng UPDATE về trơ (người dùng `isActive = false`, phiên `isActive = false` + `expiresAt = now()`, phân công đổi mã `…-tro`),
 * KHÔNG DELETE / TRUNCATE. Chỉ ĐÚNG tệp này; tệp thứ hai dùng cùng hình dạng ⇒ vẫn VI PHẠM (lưới đột biến bên dưới). KHÔNG được thêm mục.
 */
export const MIEN_COMMIT_NOTIFY: readonly { file: string; ngay: string; lyDo: string; caHoanTac: { file: string; dau: string } }[] = [
  {
    file: "server/_core/socketPhamViThongBao.db.test.ts",
    ngay: "2026-11-03",
    lyDo: "NOTIFY chỉ giao lúc COMMIT, ROLLBACK không thể kiểm",
    caHoanTac: { file: "server/_core/socketPhamVi0435.db.test.ts", dau: "ROLLBACK_KHONG_GIAO_THONG_BAO" },
  },
];
const TRAN_MIEN_COMMIT_NOTIFY = 1;
const boChuThich = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
/** Điều kiện của miễn trừ trên NGUỒN tệp; trả danh sách điều kiện HỎNG (rỗng = hợp lệ). */
export function dieuKienMienCommitNotify(nguon: string): string[] {
  const ma = boChuThich(nguon);
  const hong: string[] = [];
  if (!/skpvtb/.test(ma)) hong.push("thiếu tiền tố skpvtb");
  if (/\bDELETE\s+FROM\b|\bTRUNCATE\b|\.delete\(/i.test(ma)) hong.push("có DELETE / TRUNCATE");
  if (/aoi@|MIGRATION_DB_|asOwner\(/.test(ma)) hong.push("dùng owner aoi");
  if (/\bSET\s+(LOCAL\s+|SESSION\s+)?ROLE\b(?!\s*=)/i.test(ma)) hong.push("đổi vai bằng SET ROLE"); // fix round 2 (M-3); `UPDATE … SET role = …` (cột) KHÔNG tính
  if (/INSERT\s+INTO\s+(public\.)?"?\w+"?\s*\(\s*"?id"?\s*[,)]/i.test(ma)) hong.push("INSERT có id tường minh");
  if (!/UPDATE users SET "isActive" = false/.test(ma)) hong.push("thiếu dọn người dùng bằng UPDATE isActive=false");
  if (!/UPDATE user_sessions SET "isActive" = false, "expiresAt" = now\(\)/.test(ma)) hong.push("thiếu dọn phiên (isActive=false + hết hạn)");
  if (!/UPDATE user_factory_assignments SET "factoryCode" = /.test(ma)) hong.push("thiếu dọn phân công bằng UPDATE về mã trơ");
  return hong;
}
/**
 * ★ MIỄN TRỪ DB GIẢ, ĐÚNG MỘT TỆP (2026-11-10, kiem-dinh chặn lô runner @6f42bfe5f) — chuỗi `INSERT INTO users` nằm trong một hàm `sql` GIẢ chạy trong bộ nhớ:
 * không có kết nối nào, nên không có hàng nào để rò hay để dọn. KHÔNG đổi chuỗi để lách cổng; khai tệp ở đây kèm bằng chứng được census KIỂM.
 * Bằng chứng (kiểm trên NGUỒN tệp, mất một ⇒ ĐỎ): mọi `import` / `export … from` / `require()` / `import()` chỉ trỏ tới `vitest` và `./dungNguoiPilot`; nguồn không
 * nhắc `getDb`, `postgres`, `drizzle`, `DATABASE_URL`, `process.env`; hàm giả được khai kiểu `Sql`. Phía mô-đun được test: `dungNguoiPilot.ts` chỉ gọi `postgres(url…)` trong
 * `main()` (dòng 60), và `main()` chỉ chạy khi `process.argv[1]` khớp tên tệp (dòng 70) ⇒ nạp mô-đun từ test không mở kết nối.
 * Chỉ ĐÚNG tệp này; tệp thứ hai cùng hình dạng ⇒ vẫn VI PHẠM. KHÔNG được thêm mục.
 */
export const MIEN_DB_GIA: readonly { file: string; ngay: string; lyDo: string; chiImport: readonly string[] }[] = [
  {
    file: "scripts/tho-ca-pilot/dungNguoiPilot.test.ts",
    ngay: "2026-11-10",
    lyDo: "DB giả trong bộ nhớ, không chạm Postgres",
    chiImport: ["vitest", "./dungNguoiPilot"],
  },
];
const TRAN_MIEN_DB_GIA = 1;
/** Điều kiện của miễn trừ DB giả trên NGUỒN tệp; trả danh sách điều kiện HỎNG (rỗng = hợp lệ). */
export function dieuKienMienDbGia(nguon: string, chiImport: readonly string[]): string[] {
  const sf = ts.createSourceFile("mien-db-gia.test.ts", nguon, ts.ScriptTarget.Latest, true);
  const hong: string[] = [];
  const dacTa = new Set<string>();
  const di = (n: ts.Node): void => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteralLike(n.moduleSpecifier)) dacTa.add(n.moduleSpecifier.text);
    if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference) && ts.isStringLiteralLike(n.moduleReference.expression)) dacTa.add(n.moduleReference.expression.text);
    if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require"))) {
      const a = n.arguments[0];
      dacTa.add(a && ts.isStringLiteralLike(a) ? a.text : "<không-tĩnh>");
    }
    if (ts.isImportTypeNode(n)) dacTa.add(ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal) ? n.argument.literal.text : "<không-tĩnh>");
    ts.forEachChild(n, di);
  };
  di(sf);
  for (const d of dacTa) if (!chiImport.includes(d)) hong.push(`import ngoài danh sách cho phép: ${d}`);
  const ma = boChuThich(nguon);
  if (/\b(getDb|postgres|drizzle|DATABASE_URL)\b|process\.env/.test(ma)) hong.push("nhắc tới getDb / postgres / drizzle / DATABASE_URL / process.env");
  if (!/:\s*Sql\b/.test(ma)) hong.push("không khai hàm giả kiểu Sql");
  return hong;
}
/** Tệp được miễn DB giả: CÓ trong danh sách VÀ thoả mọi điều kiện. */
export function tepMienDbGia(docTep: (f: string) => string | null): Set<string> {
  const out = new Set<string>();
  for (const m of MIEN_DB_GIA) {
    const nguon = docTep(m.file);
    if (nguon !== null && dieuKienMienDbGia(nguon, m.chiImport).length === 0) out.add(m.file);
  }
  return out;
}
/**
 * fix round 2 (M-3) — dấu bằng chứng phải nằm trong một ca CHẠY THẬT: chuỗi chứa `dau` nằm trong một lời gọi `it` / `test` / `describe`, và
 * không lời gọi nào bao quanh nó (kể cả chính nó) là `.skip` / `.todo` / `.skipIf` / `.runIf` / `xit` / `xdescribe`; nếu lời gọi gần nhất là
 * `describe`, nó phải chứa ít nhất một `it` / `test` không bị bỏ qua. Chỉ nhắc trong chú thích / chuỗi ngoài ca ⇒ KHÔNG phải bằng chứng.
 */
export function coBangChungChayThat(nguon: string, dau: string): boolean {
  const sf = ts.createSourceFile("bang-chung.test.ts", nguon, ts.ScriptTarget.Latest, true);
  const goc = (e: ts.Expression): { ten: string | null; boQua: boolean } => {
    let cur: ts.Expression = e;
    let boQua = false;
    for (let k = 0; k < 10; k++) {
      if (ts.isIdentifier(cur)) {
        if (cur.text === "xit" || cur.text === "xdescribe" || cur.text === "xtest") return { ten: cur.text.slice(1), boQua: true };
        return { ten: ["it", "test", "describe"].includes(cur.text) ? cur.text : null, boQua };
      }
      if (ts.isPropertyAccessExpression(cur)) {
        if (["skip", "todo", "skipIf", "runIf", "fails"].includes(cur.name.text)) boQua = true;
        cur = cur.expression;
      } else if (ts.isCallExpression(cur)) cur = cur.expression; // describe.skipIf(x)(…)
      else return { ten: null, boQua };
    }
    return { ten: null, boQua };
  };
  const laCa = (n: ts.Node) => ts.isCallExpression(n) && goc(n.expression).ten !== null;
  const coCaChayTrong = (n: ts.Node): boolean => {
    let co = false;
    const di = (x: ts.Node) => {
      if (co) return;
      if (ts.isCallExpression(x)) {
        const g = goc(x.expression);
        if ((g.ten === "it" || g.ten === "test") && !g.boQua) co = true;
      }
      ts.forEachChild(x, di);
    };
    ts.forEachChild(n, di);
    return co;
  };
  let hopLe = false;
  const di = (n: ts.Node): void => {
    if (hopLe) return;
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.text.includes(dau)) {
      let ganNhat: ts.CallExpression | null = null;
      let biBoQua = false;
      for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
        if (laCa(p)) {
          const c = p as ts.CallExpression;
          if (!ganNhat) ganNhat = c;
          if (goc(c.expression).boQua) biBoQua = true;
        }
      }
      if (ganNhat && !biBoQua) {
        const g = goc(ganNhat.expression);
        hopLe = g.ten === "describe" ? coCaChayTrong(ganNhat) : true;
      }
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return hopLe;
}

/** Tệp được miễn: CÓ trong danh sách VÀ thoả mọi điều kiện. */
export function tepMienCommitNotify(docTep: (f: string) => string | null): Set<string> {
  const out = new Set<string>();
  for (const m of MIEN_COMMIT_NOTIFY) {
    const nguon = docTep(m.file);
    if (nguon !== null && dieuKienMienCommitNotify(nguon).length === 0) out.add(m.file);
  }
  return out;
}

/** Trần — hạ khi chuyển thêm. */
const TRAN_CHUA_DON = 0;
const TRAN_TU_DON = 71; // 72 → 71: scheduledReportScope.db.test.ts chuyển sang giao dịch BEGIN…ROLLBACK (2026-11-06)

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
  /** có `.transaction(cb)` mà `cb` ném giá trị tên "rollback" (hoặc câu `ROLLBACK` thô) — bằng chứng giao dịch luôn bị hoàn tác. */
  hoanTac: boolean;
  /** có chỗ chèn người dùng đi qua KẾT NỐI CHUNG (`db` / `conn` / `getDb()` …) — commit ngay, ngoài mọi giao dịch hoàn tác. */
  chenKetNoiChung: boolean;
}

const RE_INSERT_SQL = /INSERT\s+INTO\s+(public\.)?"?users"?\b/i;
const RE_DELETE_SQL = /DELETE\s+FROM\s+(public\.)?"?users"?\b/i;
const RE_ROLLBACK_THO = /^\s*ROLLBACK\s*;?\s*$/i;
/** Tên kết nối CHUNG của tiến trình test (mỗi lệnh trên đó commit). `tx` / `sp` / tham số giao dịch KHÔNG nằm ở đây. */
const KET_NOI_CHUNG = new Set(["db", "conn", "database", "pool", "getDb", "dbConn", "realDb"]);

/** Gốc của một chuỗi truy cập: `(await getDb())!.insert` ⇒ "getDb"; `db.insert` ⇒ "db"; `tx.execute` ⇒ "tx". */
function gocChuoi(e: ts.Expression): string | null {
  let cur: ts.Expression = e;
  for (let k = 0; k < 20; k++) {
    if (ts.isIdentifier(cur)) return cur.text;
    if (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur)) cur = cur.expression;
    else if (ts.isNonNullExpression(cur) || ts.isParenthesizedExpression(cur) || ts.isAwaitExpression(cur) || ts.isAsExpression(cur)) cur = cur.expression;
    else if (ts.isCallExpression(cur)) cur = cur.expression;
    else return null;
  }
  return null;
}

/** Chỗ chèn bằng chuỗi SQL: lời gọi bao nó. `X.execute(sql`…`)` ⇒ gốc của X; `f(tx, sql`…`)` ⇒ đối số đầu; postgres.js `b`…`` ⇒ tên thẻ; không rõ ⇒ null (không kết tội). */
function goiBaoChuoi(n: ts.Node): string | null {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isTaggedTemplateExpression(p) && ts.isIdentifier(p.tag) && p.tag.text !== "sql") return p.tag.text;
    if (ts.isCallExpression(p)) {
      if (ts.isPropertyAccessExpression(p.expression)) return gocChuoi(p.expression.expression);
      const a0 = p.arguments[0];
      return a0 && ts.isIdentifier(a0) ? a0.text : null;
    }
    if (ts.isSourceFile(p) || ts.isBlock(p)) return null;
  }
  return null;
}

/** Quét một nguồn: có tạo người dùng (`.insert(users)` hoặc chuỗi SQL `INSERT INTO users`), có xoá, có giao dịch hoàn tác, có chèn qua kết nối chung. */
export function quetNguon(ten: string, nguon: string): KetQuaQuet {
  const sf = ts.createSourceFile(ten, nguon, ts.ScriptTarget.Latest, true);
  let tao = false;
  let xoa = RE_DELETE_SQL.test(nguon);
  let hoanTac = false;
  let chenKetNoiChung = false;
  const ketNoiChung = (g: string | null) => !!g && KET_NOI_CHUNG.has(g);
  const ngemRollback = (n: ts.Node) => {
    let thay = false;
    const dd = (x: ts.Node) => {
      if (ts.isThrowStatement(x) && x.expression && /rollback/i.test(x.expression.getText(sf))) thay = true;
      ts.forEachChild(x, dd);
    };
    dd(n);
    return thay;
  };
  const di = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const a = n.arguments[0];
      const laUsers = !!a && ts.isIdentifier(a) && a.text === "users";
      if (n.expression.name.text === "insert" && laUsers) {
        tao = true;
        if (ketNoiChung(gocChuoi(n.expression.expression))) chenKetNoiChung = true;
      }
      if (n.expression.name.text === "delete" && laUsers) xoa = true;
      if ((n.expression.name.text === "transaction" || n.expression.name.text === "begin") && n.arguments.some((x) => (ts.isArrowFunction(x) || ts.isFunctionExpression(x)) && ngemRollback(x))) hoanTac = true;
    }
    if (ts.isTemplateExpression(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isStringLiteral(n)) {
      if (RE_INSERT_SQL.test(n.getText(sf))) {
        tao = true;
        if (ketNoiChung(goiBaoChuoi(n))) chenKetNoiChung = true;
      }
      if (ts.isNoSubstitutionTemplateLiteral(n) && RE_ROLLBACK_THO.test(n.text)) hoanTac = true; // postgres.js: await b`ROLLBACK`
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return { tao, xoa, hoanTac, chenKetNoiChung };
}

/** Tệp VI PHẠM: tạo người dùng, không phải giao dịch hoàn tác, và không nằm trong danh sách cũ. Thuần ⇒ kiểm được bằng bản đồ giả. */
export const tepViPham = (ket: ReadonlyMap<string, KetQuaQuet>, ngoaiLe: ReadonlySet<string>): string[] =>
  [...ket].filter(([f, k]) => k.tao && !laHoanTac(k) && !ngoaiLe.has(f)).map(([f]) => f);

/** Tệp tạo người dùng mà MỌI chỗ chèn không đi qua kết nối chung, có giao dịch luôn hoàn tác và không xoá ⇒ không rò. */
export const laHoanTac = (k: KetQuaQuet): boolean => k.tao && !k.xoa && k.hoanTac && !k.chenKetNoiChung;

const quetTatCa = () => {
  const kq = new Map<string, KetQuaQuet>();
  for (const f of lietKeTest()) kq.set(f, quetNguon(f, fs.readFileSync(path.join(GOC, f), "utf8")));
  return kq;
};

/** Các tệp từng nằm trong danh sách tay HOAN_TAC (trước 2026-11-02): bộ quét AST PHẢI vẫn nhận ra chúng (chống bộ quét yếu đi trong im lặng). */
const TUNG_HOAN_TAC: readonly string[] = [
  "server/services/edge/edgeControlSchema.dot10.db.test.ts",
  "server/services/edge/edgeDbSearchPath.dot10.db.test.ts",
  "server/services/edge/edgeDbSearchPath0376.dot10.db.test.ts",
  "server/services/edge/edgeHumanResolverAuth.dot10.db.test.ts",
  "server/services/edge/edgeResolution.dot10.db.test.ts",
  "server/services/edge/edgeStopNeverDropped.dot10.db.test.ts",
  "server/services/edge/otIntentResolve.dot10.db.test.ts",
  "server/services/edge/otIntentResultRace.dot10.db.test.ts",
  "server/routers/khoaMienLapTrinh.t6d.db.test.ts",
  "server/services/ot/khoaIdempotency.t6d.r1b2b2.db.test.ts",
  "server/services/scheduledReportScope.db.test.ts", // 2026-11-06: BEGIN…ROLLBACK trên một kết nối
];

describe("census — test không tự insert(users) ngoài giao dịch hoàn tác (hoặc helper / danh sách cũ)", () => {
  const ket = quetTatCa();
  const docTep = (f: string) => (fs.existsSync(path.join(GOC, f)) ? fs.readFileSync(path.join(GOC, f), "utf8") : null);
  const mienCommit = tepMienCommitNotify(docTep);
  const mienDbGia = tepMienDbGia(docTep);
  const ngoaiLe = new Set([...TU_DON, ...CHUA_DON]);
  const hoanTac = [...ket].filter(([, k]) => laHoanTac(k)).map(([f]) => f);

  it("★ miễn trừ COMMIT ⇒ NOTIFY (2026-11-03): đúng MỘT mục, có ngày + lý do + bằng chứng còn tồn tại, mọi điều kiện thoả; không mở rộng", () => {
    expect(MIEN_COMMIT_NOTIFY.length).toBe(TRAN_MIEN_COMMIT_NOTIFY);
    for (const m of MIEN_COMMIT_NOTIFY) {
      expect(m.ngay).toBe("2026-11-03");
      expect(m.lyDo).toBe("NOTIFY chỉ giao lúc COMMIT, ROLLBACK không thể kiểm");
      const nguon = docTep(m.file);
      expect(nguon, `tệp miễn ${m.file} phải tồn tại`).not.toBeNull();
      expect(dieuKienMienCommitNotify(nguon!), m.file).toEqual([]);
      expect(ket.get(m.file)?.tao, "tệp miễn phải thật sự tạo người dùng (không thì xoá mục)").toBe(true);
      expect(coBangChungChayThat(docTep(m.caHoanTac.file) ?? "", m.caHoanTac.dau), "ca hoàn tác (bằng chứng) phải tồn tại trong một ca CHẠY THẬT").toBe(true);
    }
  });

  it("★ miễn trừ DB GIẢ (2026-11-10): đúng MỘT mục, có ngày + lý do, mọi điều kiện thoả, thật sự khớp mẫu INSERT; không mở rộng", () => {
    expect(MIEN_DB_GIA.length).toBe(TRAN_MIEN_DB_GIA);
    for (const m of MIEN_DB_GIA) {
      expect(m.ngay).toBe("2026-11-10");
      expect(m.lyDo).toBe("DB giả trong bộ nhớ, không chạm Postgres");
      const nguon = docTep(m.file);
      expect(nguon, `tệp miễn ${m.file} phải tồn tại`).not.toBeNull();
      expect(dieuKienMienDbGia(nguon!, m.chiImport), m.file).toEqual([]);
      expect(ket.get(m.file)?.tao, "tệp miễn phải thật sự khớp mẫu tạo người dùng (không thì xoá mục)").toBe(true);
      expect(mienDbGia.has(m.file)).toBe(true);
    }
  });

  it("★ mọi tệp test tạo người dùng là: giao dịch hoàn tác (AST), hoặc nằm trong danh sách cũ", () => {
    const vi = tepViPham(ket, new Set([...ngoaiLe, ...mienCommit, ...mienDbGia]));
    expect(
      vi,
      "tệp mới tạo người dùng: chèn TRONG `db.transaction(async (tx) => { … throw new Rollback() })` và KHÔNG qua kết nối chung db/conn/getDb() (luật 2026-11-02: không DELETE, dọn bằng ROLLBACK)",
    ).toEqual([]);
  });

  it("★ bậc thang: mục lỗi thời (tệp mất / không còn tạo người dùng) phải bị xoá khỏi danh sách", () => {
    const loiThoi = [...ngoaiLe].filter((f) => !ket.get(f)?.tao);
    expect(loiThoi).toEqual([]);
  });

  it("★ TU_DON thật sự có xoá; CHUA_DON thật sự KHÔNG có xoá (sai nhóm ⇒ đỏ)", () => {
    expect(TU_DON.filter((f) => !ket.get(f)?.xoa)).toEqual([]);
    expect(CHUA_DON.filter((f) => ket.get(f)?.xoa)).toEqual([]);
  });

  it("★ bộ quét vẫn nhận mười một tệp hoàn tác cũ (không yếu đi trong im lặng) và không tệp nào trong danh sách cũ lọt vào nhóm hoàn tác", () => {
    expect(TUNG_HOAN_TAC.filter((f) => !hoanTac.includes(f))).toEqual([]);
    expect(hoanTac.filter((f) => ngoaiLe.has(f))).toEqual([]);
  });

  it("★ CHUA_DON phải RỖNG — tệp mới tạo người dùng không dọn thì chèn trong giao dịch hoàn tác, không thêm vào đây", () => {
    expect(CHUA_DON).toEqual([]);
  });

  it("★ danh sách cũ không trùng và chỉ được GIẢM (trần)", () => {
    expect(new Set(TU_DON).size).toBe(TU_DON.length);
    expect(new Set(CHUA_DON).size).toBe(CHUA_DON.length);
    expect(CHUA_DON.length).toBeLessThanOrEqual(TRAN_CHUA_DON);
    expect(TU_DON.length).toBeLessThanOrEqual(TRAN_TU_DON);
    expect(TU_DON.length, "TU_DON ngắn đi ⇒ HẠ TRAN_TU_DON cùng lúc (bậc thang chỉ giảm, không để chỗ trống cho tệp mới)").toBe(TRAN_TU_DON);
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
  const TX = "await db.transaction(async (tx) => { await tx.insert(users).values({}); throw new Rollback(); });";
  it.each([
    ["Drizzle trong giao dịch ném Rollback", TX, true],
    ["ném ký hiệu ROLLBACK (Symbol)", "await db.transaction(async (tx) => { await tx.insert(users).values({}); throw ROLLBACK; });", true],
    ["SQL thô qua tx.execute", "await d.transaction(async (tx) => { await tx.execute(sql`INSERT INTO users (id) VALUES (1)`); throw new Rollback(); });", true],
    ["postgres.js begin + thẻ tx", "await c.begin(async (tx) => { await tx`INSERT INTO public.users (id) VALUES (1)`; throw new Rollback(); });", true],
    ["giao dịch KHÔNG ném rollback (commit)", "await db.transaction(async (tx) => { await tx.insert(users).values({}); });", false],
    ["chèn bằng kết nối chung db ngay trong tệp có rollback", TX + " await db.insert(users).values({});", false],
    ["chèn bằng (await getDb())! trong tệp có rollback", TX + " await (await getDb())!.insert(users).values({});", false],
    ["SQL thô qua db.execute (kết nối chung)", TX + " await db.execute(sql`INSERT INTO users (id) VALUES (2)`);", false],
    ["có DELETE users ⇒ không phải hoàn tác", TX + " await db.delete(users);", false],
    ["không giao dịch", "await tx.insert(users).values({});", false],
    ["giao dịch ném lỗi KHÁC (không phải rollback) ⇒ commit khi hết lỗi", "await db.transaction(async (tx) => { await tx.insert(users).values({}); throw new Error('boom'); });", false],
    ["postgres.js: BEGIN / INSERT / ROLLBACK thô", "await b`BEGIN`; await b`INSERT INTO users (id) VALUES (1)`; await b`ROLLBACK`;", true],
    ["postgres.js: INSERT thô trên kết nối chung db trong tệp có rollback", TX + " await db`INSERT INTO users (id) VALUES (3)`;", false],
    ["chỉ nhắc ROLLBACK trong chú thích", "// throw new Rollback()\nawait db.transaction(async (tx) => { await tx.insert(users).values({}); });", false],
  ])("laHoanTac: %s", (_t, nguon, mongDoi) => {
    expect(laHoanTac(quetNguon("x.test.ts", "export {};\n" + (nguon as string)))).toBe(mongDoi); // `export {}` ⇒ mô-đun: nếu không, TS đọc `await (` là lời gọi hàm tên await
  });
  it("tepViPham: tệp tạo người dùng ngoài giao dịch hoàn tác và ngoài danh sách cũ ⇒ vi phạm; hoàn tác / có trong danh sách / không tạo ⇒ sạch", () => {
    const k = (o: Partial<KetQuaQuet>): KetQuaQuet => ({ tao: false, xoa: false, hoanTac: false, chenKetNoiChung: false, ...o });
    const ket = new Map<string, KetQuaQuet>([
      ["moi.ro.test.ts", k({ tao: true })],
      ["moi.hoantac.test.ts", k({ tao: true, hoanTac: true })],
      ["moi.hoantac.nhung.chen.chung.test.ts", k({ tao: true, hoanTac: true, chenKetNoiChung: true })],
      ["cu.tu-don.test.ts", k({ tao: true, xoa: true })],
      ["khong.tao.test.ts", k({})],
    ]);
    expect(tepViPham(ket, new Set(["cu.tu-don.test.ts"]))).toEqual(["moi.ro.test.ts", "moi.hoantac.nhung.chen.chung.test.ts"]);
    expect(tepViPham(ket, new Set())).toEqual(["moi.ro.test.ts", "moi.hoantac.nhung.chen.chung.test.ts", "cu.tu-don.test.ts"]);
  });
  it("miễn COMMIT ⇒ NOTIFY không mở rộng: tệp THỨ HAI cùng hình dạng ⇒ vẫn vi phạm; tệp miễn mất một điều kiện ⇒ hết miễn", () => {
    const that = fs.readFileSync(path.join(GOC, MIEN_COMMIT_NOTIFY[0].file), "utf8");
    const k = quetNguon("server/_core/zzBanSao.db.test.ts", that);
    expect(k.tao).toBe(true);
    const mien = tepMienCommitNotify((f) => (f === MIEN_COMMIT_NOTIFY[0].file ? that : null));
    expect(tepViPham(new Map([["server/_core/zzBanSao.db.test.ts", k]]), mien)).toEqual(["server/_core/zzBanSao.db.test.ts"]);
    for (const [ten, dotBien] of [
      ["DELETE", that.replace("// DỌN = UPDATE VỀ TRƠ (KHÔNG DELETE)", "await chay(sql`DELETE FROM users WHERE id = 0`);")],
      ["bỏ dọn phiên", that.replace('"isActive" = false, "expiresAt" = now()', '"isActive" = false')],
      ["id tường minh", that.replace('INSERT INTO users ("openId"', 'INSERT INTO users (id, "openId"')],
      ["owner aoi", that + "\nconst u = 'postgres://aoi@x/y';"],
      ["SET ROLE", that + "\nconst q = sql`SET ROLE aoi`;"],
      ["SET LOCAL ROLE", that + "\nconst q = sql`set local role aoi`;"],
    ] as const) {
      expect(that).not.toBe(dotBien);
      expect(dieuKienMienCommitNotify(dotBien).length, ten).toBeGreaterThan(0);
      expect(tepMienCommitNotify(() => dotBien).size, ten).toBe(0);
    }
  });
  it("miễn DB GIẢ không mở rộng: tệp THỨ HAI cùng hình dạng ⇒ vẫn vi phạm; mỗi cách chạm DB thật / thêm import ⇒ hết miễn", () => {
    const m = MIEN_DB_GIA[0];
    const that = fs.readFileSync(path.join(GOC, m.file), "utf8");
    expect(dieuKienMienDbGia(that, m.chiImport)).toEqual([]);
    const k = quetNguon("scripts/zzBanSao.test.ts", that);
    expect(k.tao).toBe(true);
    const mien = tepMienDbGia((f) => (f === m.file ? that : null));
    expect(mien.has(m.file)).toBe(true);
    expect(tepViPham(new Map([["scripts/zzBanSao.test.ts", k]]), mien)).toEqual(["scripts/zzBanSao.test.ts"]);
    for (const [ten, dotBien] of [
      ["import getDb", `import { getDb } from "../../server/db";\n${that}`],
      ["import postgres", `import postgres from "postgres";\n${that}`],
      ["import mô-đun khác cạnh bên", `import { x } from "./chayMotViec";\n${that}`],
      ["export from", `${that}\nexport { y } from "../../server/db";`],
      ["require", `${that}\nconst p = require("./chayMotViec");`],
      ["import() động", `${that}\nconst p = await import("postgres");`],
      ["import() không tĩnh", `${that}\nconst n = "post"; const p = await import(n + "gres");`],
      ["import = require", `import pg = require("pg");\n${that}`],
      ["kiểu import()", `${that}\ntype T = import("../../server/db").Foo;`],
      ["nhắc DATABASE_URL", `${that}\nconst u = DATABASE_URL;`],
      ["process.env", `${that}\nconst u = process.env.X;`],
      ["nhắc drizzle", `${that}\nconst d = drizzle;`],
      ["bỏ hàm giả kiểu Sql", that.replace(/:\s*Sql\b/g, "")],
    ] as const) {
      expect(that).not.toBe(dotBien);
      expect(dieuKienMienDbGia(dotBien, m.chiImport).length, ten).toBeGreaterThan(0);
      expect(tepMienDbGia(() => dotBien).size, ten).toBe(0);
    }
    // chú thích nhắc tên KHÔNG làm hỏng (chỉ mã thật mới tính)
    expect(dieuKienMienDbGia(`${that}\n// không dùng getDb hay postgres ở đây\n`, m.chiImport)).toEqual([]);
  });
  it("(M-3) bằng chứng phải nằm trong ca CHẠY THẬT: it.skip / describe.skip / .todo / skipIf / chỉ trong chú thích ⇒ KHÔNG phải bằng chứng", () => {
    const D = "ROLLBACK_KHONG_GIAO_THONG_BAO";
    expect(coBangChungChayThat(fs.readFileSync(path.join(GOC, MIEN_COMMIT_NOTIFY[0].caHoanTac.file), "utf8"), D), "tệp bằng chứng thật").toBe(true);
    expect(coBangChungChayThat(`describe("${D}", () => { it("x", () => {}); });`, D)).toBe(true);
    expect(coBangChungChayThat(`it("${D} x", () => {});`, D)).toBe(true);
    for (const [ten, nguon] of [
      ["it.skip", `describe("a", () => { it.skip("${D}", () => {}); });`],
      ["describe.skip", `describe.skip("${D}", () => { it("x", () => {}); });`],
      ["describe ngoài skip", `describe.skip("a", () => { describe("${D}", () => { it("x", () => {}); }); });`],
      ["it.todo", `it.todo("${D}");`],
      ["skipIf", `describe.skipIf(true)("${D}", () => { it("x", () => {}); });`],
      ["describe chỉ có it.skip", `describe("${D}", () => { it.skip("x", () => {}); });`],
      ["chỉ trong chú thích", `// ${D}\nit("x", () => {});`],
      ["chuỗi ngoài mọi ca", `const x = "${D}";`],
      ["xit", `xit("${D}", () => {});`],
    ] as const) {
      expect(coBangChungChayThat(nguon, D), ten).toBe(false);
    }
  });
  it("nhận ra lệnh xoá (Drizzle và SQL)", () => {
    expect(quetNguon("x.ts", "await db.delete(users).where(a)").xoa).toBe(true);
    expect(quetNguon("x.ts", "DELETE FROM users WHERE id=1").xoa).toBe(true);
    expect(quetNguon("x.ts", "await db.delete(machines)").xoa).toBe(false);
  });
});
