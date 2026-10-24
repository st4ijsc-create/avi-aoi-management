/**
 * ★★★ 2026-10-24 — **BỘ QUÉT "MUTATION tRPC NÀO NHẬN KHOÁ ĐỊNH DANH THỰC THỂ MÀ KHÔNG QUA BỘ PHÂN GIẢI PHẠM VI TRƯỚC KHI GHI".**
 *
 * VÌ SAO FILE NÀY TỒN TẠI. `phamViDocScan` + `phamViDocCensus` canh phạm vi ĐỌC của thủ tục `.query` (nhóm A) và đẩy MỌI `.mutation`
 * (khoảng 1.198) vào nhóm (D) — "không áp dụng phạm vi đọc". Nhưng phạm vi GHI không có người canh: người dùng nhà máy B gửi `adapterId` /
 * `machineId` / `orderId` của nhà máy A vào một mutation rồi mutation ghi thẳng. Những lỗ cùng lớp đã tìm thấy bằng tay:
 * `commissioning.create` ký cho adapter nhà máy khác, `machineRecipe.deploy`, `genealogy.appendEvent`, `/api/v1` orders hold/cancel…
 * Bộ quét này ĐO thay vì chờ người gặp từng lỗ.
 *
 * ═══ HÌNH DẠNG ĐO (một mutation = một dòng) ═══
 *   • `khoaDinhDanh` — khoá trong `.input(z.object({…}))` (hoặc schema suy ra từ hằng cấp file / `.extend` / `.merge`) mà tên là một
 *     định danh THỰC THỂ (`id`, `*Id`, `*Ids`, `machineCode`, `serial`, …). Mutation không nhận khoá nào ⇒ phạm vi phải đến từ `ctx` (không đo ở đây).
 *   • `coCong` — thân handler (và bao đóng NGƯỢC các hàm nó gọi) với tới được một BỘ PHÂN GIẢI PHẠM VI (`phamViCua`, `idsTrongPhamVi`,
 *     `adapterTrongPhamVi`, `assert*InScope`, `resolveDataScope`, …). Hạt giống là mẫu TÊN (xem `laTenCong`) chứ KHÔNG phải một danh sách chép tay.
 *   • `bangGhi` — bảng mà handler với tới được một lượt INSERT/UPDATE/DELETE (drizzle `.insert(x)/.update(x)/.delete(x)` hoặc SQL thô), theo bao đóng XUÔI.
 *   • `bac` — mức nguy hiểm ƯỚC LƯỢNG (điều khiển/an toàn > sản xuất > cấu hình) từ TÊN router/thủ tục/bảng. LÀ HEURISTIC XẾP HẠNG, không phải phán quyết.
 *
 * ═══ GIỚI HẠN — ĐỌC TRƯỚC KHI TIN CON SỐ ═══
 *   1. Bao đóng theo TÊN hàm (không theo ràng buộc nhập như phamViDocScan): một tên khai ở NHIỀU file chỉ được coi là cổng/ghi nếu MỌI khai báo cùng
 *      thoả (nghiêng về BÁO nợ hơn là bỏ sót). Hàm gọi qua biến/đối tượng động không đi theo được.
 *   2. "Có cổng" = TỒN TẠI một lời gọi bộ phân giải trên đường tới, KHÔNG phải "cổng áp đúng cho khoá đang nhận" — một mutation gọi `phamViCua` rồi ghi
 *      theo một id KHÁC id đã kiểm vẫn bị tính là có cổng. Đó là XANH GIẢ có thể có; bộ test DB đo đỏ thật cho các mục đầu bảng.
 *   3. Khoá định danh suy từ TÊN: `id` mặc định coi là định danh; một `*Id` trỏ tới thực thể của CHÍNH người gọi vẫn bị tính. Sổ nợ vì vậy là CẬN TRÊN.
 *   4. Mutation KHÔNG nhận khoá nào (tạo mới chỉ với trường dữ liệu) không vào sổ nợ — nhưng cũng có thể tạo bản ghi không đóng dấu nhà máy; không đo ở đây.
 *   5. `admin` bỏ qua phạm vi theo thiết kế (xem ghi chú `admin BYPASS`): mục có `san` quản trị vẫn vào sổ nhưng hạng thấp hơn khi xếp top.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import ts from "typescript";

// ═════════════════════════════════════════════════════════════════════════════
// Hạt giống & mẫu tên
// ═════════════════════════════════════════════════════════════════════════════

/** Tên bộ phân giải phạm vi ĐÃ BIẾT (khớp `phamViDocScan.TEN_PHAN_GIAI` + các cổng GHI đo được trong thân mutation). */
const TEN_CONG_BIET = new Set([
  "resolveDataScope",
  "getAccessFilterConditions",
  "getUserAssignmentCodes",
  "getTenantScope",
  "resolveTenantFactoryScope",
  "getUserFactoryAssignments",
  "getUserCorporateAssignments",
  "phamViNhaMayCuaMay",
  "phamViCua",
  "idsTrongPhamVi",
  "adapterTrongPhamVi",
  "mayTrongPhamVi",
  "idsMayTrongPhamVi",
  "yeuCauTrongPhamVi",
  "luongTrongPhamVi",
  "maySuDungTrongPhamVi",
  "trongPhamVi",
  "boKiemPhamVi",
  "kiemPhamViYaml",
  "congPhamViAndon",
  "congPhamViDichAndon",
  "assertFactoryIdAllowed",
  "callerFactoryScope",
  "macTenantChoGhi",
  "scopeOf",
  "plcScopeOf",
  "foeScopeOf",
  "resolveFactoryScope",
  "factoryIdsInScope",
]);

/**
 * Mẫu TÊN của một bộ kiểm phạm vi GHI. KHÔNG khớp tên chung chung: `applyReportScope`/`resolveExportScope` là phạm vi ĐỌC của báo cáo — loại.
 * (Tên đủ chắc để ít xanh giả; thiếu thì thêm vào `TEN_CONG_BIET` kèm test.)
 */
function laTenCong(ten: string): boolean {
  if (TEN_CONG_BIET.has(ten)) return true;
  if (/^(assert|kiem|require|ensure|check)\w*(InScope|TrongPhamVi|PhamVi|Allowed)\w*$/i.test(ten)) return true;
  if (/\w*TrongPhamVi\w*$/.test(ten)) return true;
  return false;
}

/** Tên khoá input là một ĐỊNH DANH THỰC THỂ (có thể thuộc nhà máy khác với người gọi). */
export function laKhoaDinhDanh(khoa: string): boolean {
  const k = khoa;
  if (/^(id|ids|uuid)$/i.test(k)) return true;
  if (/(^|[a-z0-9])(Id|Ids|ID)$/.test(k)) return !/^(userId|ownerId|actorId|requestedBy|createdBy|approvedBy|reviewerId|assigneeId|operatorId|submittedBy)$/i.test(k);
  if (/^(machine|line|station|factory|workshop|zone|adapter|device|robot|order|lot|work[oO]rder|job|run|node|site|corporate|tag)(Code|Codes|No|Number|Serial)$/i.test(k)) return true;
  if (/^(serial|serialNumber|serialNo|barcode|lotNo|lotNumber|orderNo|orderNumber|panelId|pcbId|unitId)$/i.test(k)) return true;
  return false;
}

// ═════════════════════════════════════════════════════════════════════════════
// Tiện ích cây (cùng khuôn phamViDocScan, nhưng độc lập — luong-ui đang sửa file kia)
// ═════════════════════════════════════════════════════════════════════════════

function moiFileTs(goc: string, ra: string[] = []): string[] {
  if (!existsSync(goc)) return ra;
  for (const ten of readdirSync(goc)) {
    if (ten === "node_modules" || ten.startsWith(".")) continue;
    const p = join(goc, ten);
    if (statSync(p).isDirectory()) moiFileTs(p, ra);
    else if (ten.endsWith(".ts") && !ten.endsWith(".d.ts") && !ten.endsWith(".test.ts")) ra.push(p);
  }
  return ra;
}

function gocChuoi(n: ts.Node | undefined): string | null {
  let cur: ts.Node | undefined = n;
  for (;;) {
    if (cur === undefined) return null;
    if (ts.isIdentifier(cur)) return cur.text;
    if (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur)) cur = cur.expression;
    else if (ts.isNonNullExpression(cur) || ts.isParenthesizedExpression(cur)) cur = cur.expression;
    else if (ts.isCallExpression(cur)) cur = cur.expression;
    else return null;
  }
}

function objRouter(x: ts.Node | undefined): ts.ObjectLiteralExpression | null {
  if (x === undefined || !ts.isCallExpression(x)) return null;
  if (!ts.isIdentifier(x.expression) || x.expression.text !== "router") return null;
  const a = x.arguments[0];
  return a !== undefined && ts.isObjectLiteralExpression(a) ? a : null;
}

function tenCuaLoiGoi(e: ts.Expression): string | null {
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
}

// ═════════════════════════════════════════════════════════════════════════════
// Kết quả
// ═════════════════════════════════════════════════════════════════════════════

export type BacNguyHiem = "dieu-khien" | "san-xuat" | "cau-hinh";

export interface MutationGhi {
  readonly file: string;
  readonly dong: number;
  readonly ten: string;
  readonly duongRouter: string;
  /** `file#duongRouter.ten` — khoá của sổ nợ (KHÔNG mang số dòng). */
  readonly khoa: string;
  /** Định danh sàn quyền (gốc chuỗi thủ tục): `protectedProcedure` · `adminProcedure` · `actuationProcedure`… */
  readonly san: string;
  /** Tên các middleware `.use(...)` (hoặc sàn dựng sẵn) trên chuỗi thủ tục, để biết sàn quyền thật. */
  readonly middleware: readonly string[];
  readonly khoaDinhDanh: readonly string[];
  /** `.input(...)` có nhưng KHÔNG phân giải được thành khoá (nhập từ file khác, tính toán…) — không biết nó nhận khoá nào. */
  readonly inputMo: boolean;
  readonly coCong: boolean;
  /** Bằng chứng cổng: vài tên bộ phân giải tới được. */
  readonly congTim: readonly string[];
  readonly bangGhi: readonly string[];
  readonly bac: BacNguyHiem;
}

export interface KetQuaGhi {
  readonly mutation: readonly MutationGhi[];
  /** Ô không phân giải được ⇒ lưới phải ĐỎ. */
  readonly mu: readonly string[];
  readonly soFileDuyet: number;
}

// ═════════════════════════════════════════════════════════════════════════════
// Phân bậc nguy hiểm (HEURISTIC xếp hạng)
// ═════════════════════════════════════════════════════════════════════════════

const RE_DIEU_KHIEN_TEN = /(deploy|dispatch|execute|command|actuat|commission|stop|start|release|override|bypass|write(?:Tag)?|setpoint|sign|arm|estop|emergency|handover|takeover|motion|jog|reset(?:Session|Adapter)?)/i;
const RE_DIEU_KHIEN_NGU_CANH = /(adapter|device|robot|interlock|safety|plc|edge|vda5050|fleet|andon|commission|recipe|control|ot[A-Z_]|opc|modbus|sparkplug|mqtt.*command|foe|stopPin|stop_pin|tag)/i;
const RE_DIEU_KHIEN_BANG = /(device_adapters|device_tags|control_audit|command|robot|interlock|safety|stop_pin|plc|edge_|vda5050|andon|recipe|commission|motion|ot_)/i;
const RE_SAN_XUAT = /(order|lot|work_?order|production|inspection|genealog|traceab|ncr|defect|disposition|serial|ecn|batch|yield|panel|pcb|lineStop|changeover|shift|session|spc)/i;

export function bacCua(file: string, duongRouter: string, ten: string, bang: readonly string[]): BacNguyHiem {
  const ngucCanh = `${file} ${duongRouter}`;
  const bangTxt = bang.join(" ");
  if (RE_DIEU_KHIEN_BANG.test(bangTxt)) return "dieu-khien";
  if (RE_DIEU_KHIEN_TEN.test(ten) && RE_DIEU_KHIEN_NGU_CANH.test(ngucCanh)) return "dieu-khien";
  if (RE_SAN_XUAT.test(bangTxt) || RE_SAN_XUAT.test(ngucCanh)) return "san-xuat";
  return "cau-hinh";
}

// ═════════════════════════════════════════════════════════════════════════════
// Bộ quét
// ═════════════════════════════════════════════════════════════════════════════

const TRAN_VONG = 12;
const TEN_QUA_CHUNG = new Set([
  "list", "get", "getById", "create", "update", "delete", "remove", "find", "findOne", "findMany", "set", "add", "map", "filter", "reduce", "push",
  "then", "catch", "finally", "toString", "parse", "safeParse", "string", "number", "boolean", "object", "array", "optional", "nullable",
  "log", "warn", "error", "info", "debug", "now", "from", "of", "all", "run", "handler", "execute", "values", "keys", "entries", "select",
]);

/**
 * Quét `server/**` và đo MỌI `.mutation(...)`.
 * @param ghiDe tệp ẢO chồng lên cây (khoá = đường tương đối posix từ `goc`) — cho phép ĐỘT BIẾN không ghi tệp tạm vào cây repo.
 */
export function quetPhamViGhi(goc: string, ghiDe: Readonly<Record<string, string>> = {}): KetQuaGhi {
  const mu: string[] = [];
  const THU_MUC = join(goc, "server");
  const files = moiFileTs(THU_MUC);
  const ao = new Map<string, string>();
  for (const [rel, nd] of Object.entries(ghiDe)) {
    const p = join(goc, ...rel.split("/"));
    ao.set(p, nd);
    if (!files.includes(p)) files.push(p);
  }
  if (files.length === 0) mu.push("không duyệt được file nào dưới server/** — bộ quét trúng 0 file");

  const duong = (p: string): string => relative(goc, p).split(sep).join("/");
  const noiDung = new Map<string, string>();
  for (const f of files) noiDung.set(f, ao.get(f) ?? readFileSync(f, "utf8"));

  const cayCua = new Map<string, ts.SourceFile>();
  const cay = (f: string): ts.SourceFile => {
    let c = cayCua.get(f);
    if (c === undefined) {
      c = ts.createSourceFile(duong(f), noiDung.get(f) ?? "", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      cayCua.set(f, c);
    }
    return c;
  };

  const phanGiai = (tuFile: string, spec: string): string | null => {
    let base: string;
    if (spec.startsWith(".")) base = resolve(dirname(tuFile), spec);
    else if (spec.startsWith("@shared/")) base = join(goc, "shared", spec.slice("@shared/".length));
    else return null;
    for (const c of [base, `${base}.ts`, join(base, "index.ts")]) {
      if (ao.has(c) || (existsSync(c) && c.endsWith(".ts") && statSync(c).isFile())) return c;
    }
    return null;
  };

  // ── tên bảng thật (biến drizzle + tên SQL) từ drizzle/schema — lọc nhiễu của `.update(x)`/`.delete(x)` trên Map/Set/đối tượng khác ──────────
  const tenBang = new Set<string>();
  {
    const dThuMuc = join(goc, "drizzle", "schema");
    const doc = (p: string): void => {
      const nd = ao.get(p) ?? readFileSync(p, "utf8");
      for (const m of nd.matchAll(/export const (\w+)\s*=\s*pg(?:Table|View|MaterializedView)\w*\(\s*["'](\w+)["']/g)) {
        if (m[1] !== undefined) tenBang.add(m[1]);
        if (m[2] !== undefined) tenBang.add(m[2]);
      }
    };
    if (existsSync(dThuMuc)) for (const t of readdirSync(dThuMuc)) if (t.endsWith(".ts")) doc(join(dThuMuc, t));
    const goc1 = join(goc, "drizzle", "schema.ts");
    if (existsSync(goc1)) doc(goc1);
    if (tenBang.size === 0) mu.push("không đọc được tên bảng từ drizzle/schema — cột bangGhi mất điểm neo");
  }

  // ── khai báo cấp file ───────────────────────────────────────────────────────────
  const khaiCua = new Map<string, Map<string, ts.Node>>();
  const khai = (f: string): Map<string, ts.Node> => {
    const co = khaiCua.get(f);
    if (co !== undefined) return co;
    const ra = new Map<string, ts.Node>();
    khaiCua.set(f, ra);
    for (const st of cay(f).statements) {
      if (ts.isFunctionDeclaration(st) && st.name !== undefined && st.body !== undefined) ra.set(st.name.text, st.body);
      else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.initializer !== undefined) ra.set(d.name.text, d.initializer);
        }
      }
    }
    return ra;
  };

  // ── đồ thị hàm theo TÊN: tên → các khai báo (file, thân) ────────────────────────────
  interface HamKhai {
    f: string;
    than: ts.Node;
  }
  const theoTen = new Map<string, HamKhai[]>();
  for (const f of files) {
    for (const [ten, than] of khai(f)) {
      if (objRouter(than) !== null) continue; // router không phải hàm
      let ds = theoTen.get(ten);
      if (ds === undefined) {
        ds = [];
        theoTen.set(ten, ds);
      }
      ds.push({ f, than });
    }
  }

  /** Tên được GỌI trong một cây con (lời gọi `x()` hoặc `a.b()` ⇒ `x` / `b`). Gồm cả tham chiếu `await import` đã tách. */
  const goiCua = new Map<ts.Node, Set<string>>();
  const cacLoiGoi = (n: ts.Node): Set<string> => {
    const co = goiCua.get(n);
    if (co !== undefined) return co;
    const ra = new Set<string>();
    goiCua.set(n, ra);
    const di = (x: ts.Node): void => {
      if (ts.isCallExpression(x)) {
        const t = tenCuaLoiGoi(x.expression);
        if (t !== null) ra.add(t);
      }
      ts.forEachChild(x, di);
    };
    di(n);
    return ra;
  };

  /**
   * Tên các lời gọi trong `n` mà ĐỐI SỐ mang danh tính/phạm vi người gọi (`ctx` · `user` · `scope` · `phamVi*` hoặc một lời gọi cổng gốc).
   * Một hàm DẪN XUẤT tới được cổng (`hamCong`) chỉ tính là cổng ở mutation khi lời gọi truyền danh tính: `db.getFactoryById(id)` (phạm vi là
   * tham số TUỲ CHỌN, bỏ trống = không lọc) KHÔNG phải cổng, `db.getFactoryById(id, phamViCua(ctx))` mới là. Cổng gốc (`laTenCong`) không cần.
   */
  const coDanhTinhCua = new Map<ts.Node, Set<string>>();
  const goiCoDanhTinh = (n: ts.Node): Set<string> => {
    const co = coDanhTinhCua.get(n);
    if (co !== undefined) return co;
    const ra = new Set<string>();
    coDanhTinhCua.set(n, ra);
    const mangDanhTinh = (x: ts.Node): boolean => {
      if (ts.isIdentifier(x) && /^(ctx|user|scope|phamViw*|ngCanh)$/i.test(x.text)) return true;
      if (ts.isPropertyAccessExpression(x) && /^(ctx|user)$/i.test(x.name.text)) return true;
      if (ts.isCallExpression(x)) {
        const t = tenCuaLoiGoi(x.expression);
        if (t !== null && laTenCong(t)) return true;
      }
      let thay = false;
      ts.forEachChild(x, (c) => {
        if (!thay && mangDanhTinh(c)) thay = true;
      });
      return thay;
    };
    const di = (x: ts.Node): void => {
      if (ts.isCallExpression(x)) {
        const t = tenCuaLoiGoi(x.expression);
        if (t !== null && x.arguments.some((a) => mangDanhTinh(a))) ra.add(t);
      }
      ts.forEachChild(x, di);
    };
    di(n);
    return ra;
  };

  // ── bao đóng NGƯỢC: tên nào tới được bộ phân giải phạm vi ──────────────────────────
  const hamCong = new Set<string>();
  for (let vong = 0; vong < TRAN_VONG; vong++) {
    let them = 0;
    for (const [ten, ds] of theoTen) {
      if (hamCong.has(ten) || TEN_QUA_CHUNG.has(ten)) continue;
      // MỌI khai báo cùng tên phải tới được cổng (nghiêng về báo nợ).
      const moiKhaiDat = ds.every((d) => {
        for (const g of cacLoiGoi(d.than)) if (laTenCong(g) || hamCong.has(g)) return true;
        return false;
      });
      if (moiKhaiDat) {
        hamCong.add(ten);
        them++;
      }
    }
    if (them === 0) break;
  }

  // ── bao đóng XUÔI: bảng ghi ──────────────────────────────────────────────────────
  const bangTrucTiep = new Map<ts.Node, Set<string>>();
  const reSqlGhi = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:ONLY\s+)?(?:public\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi;
  const bangTrucTiepCua = (n: ts.Node, sf: ts.SourceFile): Set<string> => {
    const co = bangTrucTiep.get(n);
    if (co !== undefined) return co;
    const ra = new Set<string>();
    bangTrucTiep.set(n, ra);
    const di = (x: ts.Node): void => {
      if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression)) {
        const m = x.expression.name.text;
        if ((m === "insert" || m === "update" || m === "delete") && x.arguments[0] !== undefined) {
          const a = x.arguments[0];
          const t = ts.isIdentifier(a) ? a.text : ts.isPropertyAccessExpression(a) ? a.name.text : null;
          if (t !== null && tenBang.has(t)) ra.add(t);
        }
      }
      if (ts.isTemplateExpression(x) || ts.isNoSubstitutionTemplateLiteral(x)) {
        const txt = x.getText(sf);
        for (const m of txt.matchAll(reSqlGhi)) {
          const t = m[1];
          if (t !== undefined && tenBang.has(t)) ra.add(t);
        }
      }
      ts.forEachChild(x, di);
    };
    di(n);
    return ra;
  };
  const bangCuaTen = new Map<string, Set<string>>();
  const bangHam = (ten: string, sau: number, vet: Set<string>): Set<string> => {
    const co = bangCuaTen.get(ten);
    if (co !== undefined) return co;
    const ra = new Set<string>();
    if (sau > 4 || vet.has(ten) || TEN_QUA_CHUNG.has(ten)) return ra;
    const ds = theoTen.get(ten);
    if (ds === undefined || ds.length > 3) return ra;
    vet.add(ten);
    for (const d of ds) {
      for (const b of bangTrucTiepCua(d.than, cay(d.f))) ra.add(b);
      for (const g of cacLoiGoi(d.than)) for (const b of bangHam(g, sau + 1, vet)) ra.add(b);
    }
    vet.delete(ten);
    if (sau === 0) bangCuaTen.set(ten, ra);
    return ra;
  };

  // ── khoá input ───────────────────────────────────────────────────────────────────
  const khoaCuaSchema = (f: string, n: ts.Node, sau: number, mo: { v: boolean }): Set<string> => {
    const ra = new Set<string>();
    if (sau > 6) {
      mo.v = true;
      return ra;
    }
    const nhat = (x: ts.Node): void => {
      if (ts.isCallExpression(x)) {
        const e = x.expression;
        // z.object({...}) / .extend({...}) — lấy khoá của object literal đối số
        if (ts.isPropertyAccessExpression(e) && (e.name.text === "object" || e.name.text === "extend" || e.name.text === "strictObject")) {
          const a = x.arguments[0];
          if (a !== undefined && ts.isObjectLiteralExpression(a)) {
            for (const p of a.properties) {
              if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) {
                const nm = p.name;
                if (ts.isIdentifier(nm) || ts.isStringLiteral(nm)) ra.add(nm.text);
              } else if (ts.isSpreadAssignment(p)) {
                const gt = ts.isIdentifier(p.expression) ? khai(f).get(p.expression.text) : undefined;
                if (gt !== undefined) for (const k of khoaCuaSchema(f, gt, sau + 1, mo)) ra.add(k);
                else mo.v = true;
              }
            }
          } else if (a !== undefined && ts.isIdentifier(a)) {
            const gt = khai(f).get(a.text);
            if (gt !== undefined) for (const k of khoaCuaSchema(f, gt, sau + 1, mo)) ra.add(k);
            else mo.v = true;
          }
        }
        // .merge(Other)
        if (ts.isPropertyAccessExpression(e) && e.name.text === "merge") {
          const a = x.arguments[0];
          if (a !== undefined && ts.isIdentifier(a)) {
            const gt = khai(f).get(a.text);
            if (gt !== undefined) for (const k of khoaCuaSchema(f, gt, sau + 1, mo)) ra.add(k);
            else mo.v = true;
          }
        }
      }
      if (ts.isIdentifier(x) && x !== n) {
        // tham chiếu tới hằng schema cấp file
        const gt = khai(f).get(x.text);
        if (gt !== undefined && gt !== n && /schema|input|zod|z\./i.test(gt.getText(cay(f)).slice(0, 80)) && sau < 6) {
          for (const k of khoaCuaSchema(f, gt, sau + 1, mo)) ra.add(k);
        }
      }
      ts.forEachChild(x, nhat);
    };
    // `.input(idInput)`: đối số CHÍNH LÀ một định danh — `nhat` bỏ qua `x === n`, nên phải phân giải hằng schema cấp file TẠI ĐÂY
    // (trước đó mọi `.input(idInput)` / `bulkIdsInput` / `importInput` bị coi "không khoá" ⇒ delete/bulk/import không vào sổ).
    if (ts.isIdentifier(n)) {
      const gt = khai(f).get(n.text);
      if (gt !== undefined) for (const k of khoaCuaSchema(f, gt, sau + 1, mo)) ra.add(k);
      else mo.v = true;
      return ra;
    }
    nhat(n);
    return ra;
  };

  // ── liệt kê mutation ───────────────────────────────────────────────────────────────
  const ra: MutationGhi[] = [];
  for (const f of files) {
    const src = noiDung.get(f) ?? "";
    if (!src.includes(".mutation(") || !src.includes("router(")) continue;
    const rel = duong(f);
    const sf = cay(f);
    const daTham = new Set<ts.ObjectLiteralExpression>();

    const xuLy = (obj: ts.ObjectLiteralExpression, duongR: string[]): void => {
      daTham.add(obj);
      for (const p of obj.properties) {
        if (!ts.isPropertyAssignment(p)) continue;
        const ten = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : p.name.getText(sf);
        const con = objRouter(p.initializer);
        if (con !== null) {
          xuLy(con, [...duongR, ten]);
          continue;
        }
        const san = gocChuoi(p.initializer);
        if (san === null || san === "router") continue;

        // tìm lời gọi `.mutation(fn)` ở đỉnh chuỗi và các `.use(...)`, `.input(...)` bên dưới
        let than: ts.Node | null = null;
        let inputArg: ts.Node | null = null;
        const mw: string[] = [];
        const di = (x: ts.Node): void => {
          if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression)) {
            const m = x.expression.name.text;
            if (m === "mutation" && x.arguments[0] !== undefined && than === null) than = x.arguments[0];
            if (m === "input" && x.arguments[0] !== undefined && inputArg === null) inputArg = x.arguments[0];
            if (m === "use" && x.arguments[0] !== undefined) {
              const a = x.arguments[0];
              mw.push(ts.isCallExpression(a) ? (tenCuaLoiGoi(a.expression) ?? "?") : ts.isIdentifier(a) ? a.text : "?");
            }
          }
          ts.forEachChild(x, di);
        };
        di(p.initializer);
        if (than === null) continue;
        const thanNode: ts.Node = than;

        const moInput = { v: false };
        let khoa: string[] = [];
        if (inputArg !== null) {
          const ks = khoaCuaSchema(f, inputArg, 0, moInput);
          khoa = [...ks].filter(laKhoaDinhDanh).sort();
        }
        // input là một hằng nhập từ file khác ⇒ mở
        // inputArg được gán trong closure `di` ⇒ TS thu hẹp sai về `null`; đọc lại qua một biến có kiểu rõ.
        const inputNode = inputArg as ts.Node | null;
        if (inputNode !== null && ts.isIdentifier(inputNode) && !khai(f).has(inputNode.text)) moInput.v = true;

        // cổng
        const congTim: string[] = [];
        const coDT = goiCoDanhTinh(thanNode);
        for (const g of cacLoiGoi(thanNode)) {
          if (laTenCong(g) || (hamCong.has(g) && coDT.has(g))) congTim.push(g);
        }
        // middleware của chuỗi thủ tục cũng có thể là cổng phạm vi
        for (const m of mw) if (laTenCong(m) || hamCong.has(m)) congTim.push(`use:${m}`);
        const bang = new Set<string>(bangTrucTiepCua(thanNode, sf));
        for (const g of cacLoiGoi(thanNode)) for (const b of bangHam(g, 0, new Set())) bang.add(b);
        const bangGhi = [...bang].filter((b) => b.length > 1).sort().slice(0, 8);

        ra.push({
          file: rel,
          dong: sf.getLineAndCharacterOfPosition(p.getStart(sf)).line + 1,
          ten,
          duongRouter: duongR.join("."),
          khoa: `${rel}#${duongR.join(".")}.${ten}`,
          san,
          middleware: mw,
          khoaDinhDanh: khoa,
          inputMo: moInput.v,
          coCong: congTim.length > 0,
          congTim: [...new Set(congTim)].sort().slice(0, 5),
          bangGhi,
          bac: bacCua(rel, duongR.join("."), ten, bangGhi),
        });
      }
    };

    for (const [tenBien, kh] of khai(f)) {
      const obj = objRouter(kh);
      if (obj !== null) xuLy(obj, [tenBien]);
    }
    const soatMu = (n: ts.Node): void => {
      const obj = objRouter(n);
      if (obj !== null && !daTham.has(obj)) {
        mu.push(`${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} — \`router({…})\` không gắn vào một \`const\` cấp file ⇒ bộ quét không đặt tên được`);
        xuLy(obj, ["(vô danh)"]);
      }
      ts.forEachChild(n, soatMu);
    };
    soatMu(sf);
  }
  if (ra.length === 0) mu.push("không thấy mutation tRPC nào — bộ quét đã mất hình dạng `.mutation(…)`");
  return { mutation: ra, mu, soFileDuyet: files.length };
}

// ═════════════════════════════════════════════════════════════════════════════
// Phân nhóm & xếp hạng
// ═════════════════════════════════════════════════════════════════════════════

/** Mutation vào SỔ NỢ: nhận ≥ 1 khoá định danh mà không với tới được bộ phân giải phạm vi. */
export function laNoGhi(m: MutationGhi): boolean {
  return m.khoaDinhDanh.length > 0 && !m.coCong && !laSanToanQuyen(m);
}

/**
 * Sàn `adminProcedure` (chỉ `role === "admin"`): admin có phạm vi TOÀN QUYỀN theo thiết kế (`resolveTenantFactoryScope`: `userRole === "admin"` ⇒
 * `factoryIds: null`) ⇒ không có "nhà máy khác" nào để vượt ⇒ KHÔNG phải nợ phạm vi. Tiền đề này được canh bằng test (`phamViGhiCensus` §5c): nếu ai đó
 * thu hẹp phạm vi admin (vd. thêm vai "admin nhà máy" phạm vi hẹp) thì test ĐỎ và quy tắc này PHẢI BỎ. `superAdminProcedure` cùng nhóm.
 */
export function laSanToanQuyen(m: Pick<MutationGhi, "san">): boolean {
  return /^(adminProcedure|superAdminProcedure)$/.test(m.san);
}

const SAN_QUAN_TRI = /^(adminProcedure|superAdminProcedure)$/;

/** Điểm xếp hạng nguy hiểm: bậc (điều khiển 300 > sản xuất 200 > cấu hình 100) + sàn thấp hơn nguy hiểm hơn + số khoá + bảng ghi. */
export function diemNguyHiem(m: MutationGhi): number {
  const bac = m.bac === "dieu-khien" ? 300 : m.bac === "san-xuat" ? 200 : 100;
  const san = SAN_QUAN_TRI.test(m.san) ? -80 : /^(protectedProcedure|writeProcedure|operatorProcedure)$/.test(m.san) ? 30 : /^(supervisorProcedure|qualityProcedure|actuationProcedure|deployProcedure)$/.test(m.san) ? 10 : 0;
  return bac + san + Math.min(m.khoaDinhDanh.length, 3) * 5 + Math.min(m.bangGhi.length, 4);
}
