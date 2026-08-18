/**
 * ★★★ 2026-08-18 — **BỘ SUY "THỦ TỤC ĐỌC NÀO TRẢ DỮ LIỆU TENANT MÀ KHÔNG AI LỌC".**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI — VÀ VÌ SAO NÓ **KHÔNG** ĐƯỢC LÀ MỘT DANH SÁCH CHÉP TAY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đợt 2026-08-17/18 vá phạm vi dữ liệu **MỘT-CÁI-MỘT** cho khoảng một tá bề mặt: `dashboard`,
 * `inspection`, `oee`, `defectHeatmap`, `commandCenter`, `executiveReport`, `aiTimeSeries`,
 * `aiInspectionAnalytics`, ba đường xuất báo cáo… Mỗi lượt vá là một bề mặt **được ai đó nhìn
 * thấy**. Không lượt nào trả lời được câu hỏi *"còn bao nhiêu bề mặt NHƯ THẾ mà chưa ai nhìn?"*
 *
 * Phép đếm thô ban đầu — *"1.475 `protectedProcedure` không nhắc `ctx`"* — là **CẬN TRÊN của bề
 * mặt**, không phải số lỗ: nó gộp cả **mutation** (phạm vi ĐỌC không áp dụng) lẫn mọi thủ tục đọc
 * cấu hình hệ thống / giấy phép / danh mục dùng chung. Báo con số ấy như số rò rỉ là đúng lớp lỗi
 * *"một con số đúng-về-thứ-khác"* mà repo này đã trả giá nhiều lần.
 *
 * ⇒ File này **ĐO**. Ba tập được **SUY RA**, không tập nào được viết tay:
 *
 *   §A **BẢNG TENANT** — suy từ chính `drizzle/schema` lúc chạy (`getTableConfig`), theo ba luật
 *       đọc được: (1) bảng có cột **mã tenant** (`factoryCode`/`corporateCode`/`factoryId`/
 *       `corporateId`, so khớp KHÔNG phân biệt hoa-thường và dấu `_` — lược đồ này trộn cả hai
 *       quy ước: `product_inspections.factoryCode` camel, `robot_telemetry.battery_level` snake);
 *       (2) bảng có **FK khai báo** trỏ tới một bảng tenant; (3) bảng có cột `<x>Id`/`<x>Code`
 *       mà `<x>s`/`<x>es`/`<x>` là một bảng tenant — quy ước **học từ chính các FK đã khai**
 *       trong lược đồ, không phải một bảng chữ chép tay.
 *       ⚠ Luật (3) là thứ bắt được `alert_settings` (`machineId`+`factoryId`, **không** FK khai
 *       báo) và `suppliers`/`materials`/`tools` (`corporateCode`+`factoryCode`). Bỏ nó đi thì
 *       ~160 bảng dữ liệu nhà xưởng biến thành "không thuộc tenant" một cách im lặng.
 *
 *   §B **HÀM ĐỌC BẢNG TENANT** — bao đóng NGƯỢC trên `server/**`: hạt giống là mọi khai báo cấp
 *       file có thân **chạm một biến bảng tenant** (nhập từ `drizzle/schema`) hoặc một câu SQL
 *       thô nêu tên bảng ấy; rồi *ai gọi tới được hạt giống* cũng vào tập. Bao đóng **NGƯỢC**
 *       (không phải xuôi) là điều kiện để tập không nở ra vô nghĩa — cùng lý lẽ đã ghi ở
 *       `deployProcedureScan.ts` §C-2.
 *
 *   §C **DANH TÍNH CÓ RỜI TAY HANDLER KHÔNG** — hỏi trên **CÂY**, không trên văn bản.
 *       ⚠⚠ Đây là ô đã trả giá: `reportExportScope.test.ts` ghi lại rằng một trong ba router xuất
 *       báo cáo **CÓ nhận `ctx`** rồi chỉ dùng cho ô `author` — tức *"có nhắc `ctx`"* là một vị từ
 *       **XANH GIẢ**. Nên vị từ ở đây đòi `ctx` / `ctx.user…` **được TRUYỀN vào một lời gọi** (hoặc
 *       gán ra một biến rồi dùng), chứ không đòi nó xuất hiện.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ TIỀN ĐỀ LOAD-BEARING — **HỆ NÀY KHÔNG CÓ DANH TÍNH NGẦM.** (đo 2026-08-18)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Cả hai bộ phân giải phạm vi (`resolveDataScope` và `resolveTenantFactoryScope`) đều **đòi
 * `userId` truyền vào**. Không có `AsyncLocalStorage` nào chở danh tính (chỉ có backbone
 * correlation, `server/services/observability/correlation.ts`). RLS ở tầng CSDL **nằm im**:
 * `runWithTenantScope` (`server/db/tenantContext.ts`) — cửa duy nhất bật GUC `app.tenant_rls_active`
 * — có **0 nơi gọi trong mã sản xuất**; middleware `tenantScopeMiddleware` có tính `ctx.tenantScope`
 * (vì `.env` đặt `TENANT_RLS_ENABLED=true`) nhưng **không tầng dữ liệu nào đọc nó**.
 *
 * ⇒ **Một handler ĐỌC không đưa danh tính rời tay thì KHÔNG THỂ đã được lọc ở tầng nào.** Đó là lý
 *   do nhóm (B) *"đã lọc ở tầng dưới"* của bản mô tả nhiệm vụ **RỖNG theo cấu tạo**, và bộ suy này
 *   vẫn tính nó ra để **đo** chứ không để giả định: `phanLoai === "B"` xuất hiện trở lại nghĩa là
 *   tiền đề trên đã hết đúng, và lưới phải nói ra điều đó.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ 2026-08-18, lượt 4 — §D **TUYẾN EXPRESS**, và vì sao nó nằm TRONG file này
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản điều tra dân số trên đếm 2.209 thủ tục tRPC và **không đếm được một tuyến Express nào**.
 * `GET /api/public/products/:productCode/reference-image-file` (`server/_core/index.ts`) phục vụ
 * ĐÚNG cùng dữ liệu (ảnh mẫu sản phẩm) cho ĐÚNG cùng người gọi bằng ĐÚNG cùng ba chứng thực như 8
 * thủ tục `publicProductApiRouter` — nhưng nó là Express, nên nó **không nằm trong 2.209**, không
 * nằm trong sổ nợ, và §4 **không thể** đỏ vì nó. Đo trên HTTP thật: máy nhà máy A tải được ảnh sản
 * phẩm của nhà máy B, **200 · image/png**.
 *
 * ⇒ §D dùng **LẠI ĐÚNG** ba tập trên (§A bảng tenant · §B bao đóng NGƯỢC · §C danh tính) chứ
 *   KHÔNG dựng bộ suy thứ hai. Hai bản luật cho cùng một câu hỏi là cách chúng lệch nhau, và **bản
 *   lỏng hơn sẽ quyết định ai thấy gì** — đúng lý lẽ đã viết ở `publicProductScope.sanPhamTrongNhaMay`.
 *
 * BA chỗ §D buộc phải KHÁC, mỗi chỗ có lý do đo được:
 *   1. **Danh tính REST có BA hình dạng**, không một: phiên (`req.user`/`req.externalUser`), **khoá
 *      API** (`x-api-key`), **khoá MÁY** (`x-machine-code`). §C của tRPC chỉ biết hình dạng thứ nhất
 *      — xem `GOC_DANH_TINH_REST` + `HAM_DANH_TINH_REST`.
 *   2. **Vị từ danh tính CHẶT HƠN một bậc**: §C coi "gán ra một biến" là đủ; §D đòi danh tính **đi
 *      vào một lời gọi**. Lý do đo được: lỗ vừa vá có hình dạng *"gọi `validateAccess` rồi VỨT giá
 *      trị trả về đi"* — một vị từ tính "đã gán" là xanh sẽ khai đúng cái lỗ ấy là ĐÃ LỌC.
 *   3. **Nhóm (U) UỶ QUYỀN**: quá nửa tuyến `/api/**` chỉ chuyển tiếp sang `appRouter.createCaller`.
 *      Xem docblock của `NhomTuyen`.
 *
 * ⚠⚠ **CÁI §D VẪN KHÔNG NHÌN THẤY** (ghi ra để không ai đọc con số như một lời bảo đảm):
 *   • `app.use("/uploads", express.static(…))` — phục vụ **byte tệp**, không qua một lượt đọc bảng
 *     nào ⇒ mọi vị từ ở đây đều mù với nó. Được đếm riêng vào `tuyenTinh`.
 *   • tiền tố `app.use("/api/v1", createV1Router())` KHÔNG được ghép vào đường dẫn (đoán là bịa).
 *   • `.use()` với middleware tự phục vụ dữ liệu, và mọi tuyến đăng ký qua đường dẫn TÍNH TOÁN
 *     (được ghi vào `mu` ⇒ lưới ĐỎ, không im lặng).
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import ts from "typescript";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { is } from "drizzle-orm";
import * as schema from "../../drizzle/schema";

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §A — BẢNG TENANT, SUY TỪ LƯỢC ĐỒ SỐNG
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Cột mang **mã tenant** ngay trên bảng (đã chuẩn hoá: thường + bỏ `_`). */
const COT_TENANT_CHUAN = ["factorycode", "corporatecode", "factoryid", "corporateid"] as const;

/** Chuẩn hoá tên cột/bảng: thường hoá + bỏ `_`, để `factory_code` và `factoryCode` là MỘT. */
function chuanTen(x: string): string {
  return x.toLowerCase().replace(/_/g, "");
}

export interface KetQuaBangTenant {
  /** Tên SQL của bảng thuộc tenant. */
  readonly tenSql: ReadonlySet<string>;
  /** Tên BIẾN drizzle của bảng thuộc tenant — thứ mã nguồn thực sự viết ra. */
  readonly tenBien: ReadonlySet<string>;
  /** Tổng số `pgTable` thấy trong lược đồ — cầu chì chống "quét trúng 0 bảng". */
  readonly tongBang: number;
}

/** Suy tập bảng TENANT từ `drizzle/schema` lúc chạy. Xem §A ở docblock đầu file. */
export function bangTenant(): KetQuaBangTenant {
  interface Info {
    bien: string;
    cot: string[];
    fk: { cot: string; toi: string }[];
  }
  const info = new Map<string, Info>();
  const sqlCuaBien = new Map<string, string>();
  for (const [ten, v] of Object.entries(schema as Record<string, unknown>)) {
    if (!is(v as never, PgTable)) continue;
    const cfg = getTableConfig(v as never);
    const fk: { cot: string; toi: string }[] = [];
    for (const f of cfg.foreignKeys) {
      try {
        const r = f.reference();
        const toi = getTableConfig(r.foreignTable as never).name;
        for (const c of r.columns) fk.push({ cot: c.name, toi });
      } catch {
        /* một FK không phân giải được không được làm hỏng cả phép đo */
      }
    }
    info.set(cfg.name, { bien: ten, cot: cfg.columns.map((c) => c.name), fk });
    sqlCuaBien.set(ten, cfg.name);
  }

  /** Quy ước **học từ chính lược đồ**: cột `x` (chuẩn hoá) từng được khai FK tới bảng nào. */
  const hoc = new Map<string, Set<string>>();
  for (const i of info.values()) {
    for (const f of i.fk) {
      const k = chuanTen(f.cot);
      let s = hoc.get(k);
      if (s === undefined) {
        s = new Set();
        hoc.set(k, s);
      }
      s.add(f.toi);
    }
  }

  /** Cột `xId`/`xCode` → tên bảng ỨNG VIÊN (`xs` · `xes` · `x`). */
  const ungVien = (cotChuan: string): string[] => {
    const b = cotChuan.endsWith("id")
      ? cotChuan.slice(0, -2)
      : cotChuan.endsWith("code")
        ? cotChuan.slice(0, -4)
        : null;
    if (b === null || b.length < 3) return [];
    return [`${b}s`, `${b}es`, b];
  };

  const tenant = new Set<string>(["factories", "corporates"]);
  for (const [sql, i] of info) {
    if (i.cot.some((c) => (COT_TENANT_CHUAN as readonly string[]).includes(chuanTen(c)))) tenant.add(sql);
  }
  for (let vong = 0; vong < 40; vong++) {
    let them = 0;
    for (const [sql, i] of info) {
      if (tenant.has(sql)) continue;
      const cham =
        i.fk.some((f) => tenant.has(f.toi)) ||
        i.cot.some((c) => [...(hoc.get(chuanTen(c)) ?? [])].some((t) => tenant.has(t))) ||
        i.cot.some((c) => ungVien(chuanTen(c)).some((t) => tenant.has(t)));
      if (cham) {
        tenant.add(sql);
        them++;
      }
    }
    if (them === 0) break;
  }

  const tenBien = new Set<string>();
  for (const [bien, sql] of sqlCuaBien) if (tenant.has(sql)) tenBien.add(bien);
  return { tenSql: tenant, tenBien, tongBang: info.size };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §B — DUYỆT NGUỒN `server/**`
// ══════════════════════════════════════════════════════════════════════════════════════════════

function moiFileTs(goc: string, ra: string[] = []): string[] {
  if (!existsSync(goc)) return ra;
  for (const ten of readdirSync(goc)) {
    if (ten === "node_modules" || ten.startsWith(".")) continue;
    const p = join(goc, ten);
    if (statSync(p).isDirectory()) moiFileTs(p, ra);
    else if (ten.endsWith(".ts") && !ten.endsWith(".d.ts")) ra.push(p);
  }
  return ra;
}

/** Định danh TRÁI NHẤT của một chuỗi truy cập (`a.use(x).query(y)` → `a`). */
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

/** Bóc mọi lớp vỏ KHÔNG đổi giá trị (`(x as any)!` · `(x)` · `await x`) để lộ biểu thức thật. */
function boVo(n: ts.Node): ts.Node {
  let cur = n;
  for (;;) {
    if (
      ts.isParenthesizedExpression(cur) ||
      ts.isAsExpression(cur) ||
      ts.isNonNullExpression(cur) ||
      ts.isAwaitExpression(cur) ||
      ts.isTypeAssertionExpression(cur)
    ) {
      cur = cur.expression;
      continue;
    }
    return cur;
  }
}

/**
 * Đường truy cập có dấu chấm của một biểu thức (`(req as any).externalUser` → `req.externalUser`).
 * `null` nếu không phải một chuỗi `Identifier(.prop)*` thuần.
 *
 * ⚠ Phải bóc `as any` **ở từng chặng**: khuôn có thật trong repo là `(req as any).externalUser?.id`,
 * và một phép so trên `getText()` sẽ trượt vì chuỗi mang cả cú pháp ép kiểu.
 */
function duongTruyCap(n: ts.Node): string | null {
  const phan: string[] = [];
  let cur = boVo(n);
  for (;;) {
    if (ts.isPropertyAccessExpression(cur)) {
      phan.unshift(cur.name.text);
      cur = boVo(cur.expression);
      continue;
    }
    if (ts.isIdentifier(cur)) {
      phan.unshift(cur.text);
      return phan.join(".");
    }
    return null;
  }
}

/** `router({…})` này là lời gọi `router` với đối số object literal? */
function objRouter(x: ts.Node | undefined): ts.ObjectLiteralExpression | null {
  if (x === undefined || !ts.isCallExpression(x)) return null;
  if (!ts.isIdentifier(x.expression) || x.expression.text !== "router") return null;
  const a = x.arguments[0];
  return a !== undefined && ts.isObjectLiteralExpression(a) ? a : null;
}

/** Một thủ tục tRPC tìm thấy trên đĩa. */
export interface ThuTuc {
  /** Đường tương đối gốc repo, dấu `/`. */
  readonly file: string;
  readonly dong: number;
  /** Tên ô trong `router({ … })`. */
  readonly ten: string;
  /**
   * Đường **ROUTER** bao quanh, từ biến khai ở cấp file xuống (`factoryRouter` · `spcRouter.cpk`).
   * ⚠ Không có ô này thì `file#tên` KHÔNG duy nhất: `hierarchyRouters.ts` có **5** ô tên `list`
   * (factory · zone · workshop · line · station). Một bảng kê khoá theo `file#tên` sẽ lặng lẽ gộp
   * năm thủ tục thành một mục, và bốn lượt rò biến mất khỏi phép đếm.
   */
  readonly duongRouter: string;
  /** Định danh sàn (`protectedProcedure` · `adminProcedure` · `publicProcedure` · …). */
  readonly san: string;
  readonly loai: "query" | "mutation" | "subscription";
  /** Handler có đưa danh tính (`ctx` / `ctx.user…`) **RỜI TAY** không — xem §C. */
  readonly danhTinhRoiTay: boolean;
  /** Handler với tới được một lượt ĐỌC bảng tenant không. */
  readonly chamTenant: boolean;
  /**
   * Handler KHÔNG đưa danh tính, nhưng một hàm nó gọi **TRỰC TIẾP** tự phân giải phạm vi.
   * ⚠ Tiền đề đã đo (xem docblock đầu file) nói tập này phải RỖNG. Nó khác rỗng ⇒ tiền đề hết
   * đúng, và lưới phải nói ra.
   */
  readonly tuPhanGiaiPhamVi: boolean;
  /** Bằng chứng: vài nút ĐỌC-TENANT mà handler chạm tới (`file#tên`). */
  readonly bangChung: readonly string[];
}

export interface KetQuaQuetPhamVi {
  readonly thuTuc: readonly ThuTuc[];
  /** Tuyến **Express** — bề mặt mà bản điều tra dân số tRPC KHÔNG đếm được (xem §D đầu file). */
  readonly tuyen: readonly TuyenExpress[];
  /**
   * Lượt gắn tệp TĨNH (`app.use("/x", express.static(…))`) — bề mặt mà bộ suy này **KHÔNG phát
   * biểu được gì**: nó phục vụ byte tệp, không qua một lượt đọc bảng nào. Ghi ra để nó không im lặng.
   */
  readonly tuyenTinh: readonly string[];
  /** Ô KHÔNG phân giải được — mỗi mục là một ô KHÔNG AI CANH ⇒ lưới phải ĐỎ. */
  readonly mu: readonly string[];
  /** Số file `.ts` sản xuất đã duyệt — cầu chì chống "quét trúng 0 file". */
  readonly soFileDuyet: number;
  /** Tập bảng tenant đã suy ra (để lưới đo lại chính nó). */
  readonly bang: KetQuaBangTenant;
  /** Số nút trong bao đóng "đọc bảng tenant". */
  readonly soNutDocTenant: number;
}

/**
 * Tên các bộ phân giải phạm vi — **hạt giống** của vị từ "hàm này tự lo phạm vi".
 * ⚠ Đây KHÔNG phải danh sách cho phép: nó chỉ dùng để **phát hiện** nhóm (B), tức để tiền đề
 * *"không có danh tính ngầm"* có thể bị **bác bỏ bằng phép đo** thay vì được tin.
 *
 * ★★★ 2026-08-18 — TIỀN ĐỀ TRÊN **ĐÃ BỊ BÁC BỎ MỘT PHẦN**, và đây là chỗ ghi lại điều đó.
 *
 * `phamViNhaMayCuaMay` (`server/routers/publicProductScope.ts`) phân giải phạm vi từ một **KHOÁ
 * MÁY trình trong `input`**, KHÔNG từ `ctx.user`. Tám thủ tục `publicProcedure` của
 * `publicProductApiRouter` phục vụ MÁY và ứng dụng bên thứ ba — chúng chưa bao giờ có `ctx.user`
 * để đưa rời tay, nên vị từ §C (`danhTinhRoiTay`) **không thể** xanh cho chúng dù có vá đúng tới
 * đâu. Không khai tên hàm ở đây thì tám thủ tục ấy bị đếm mãi mãi vào nhóm **A = RÒ RỈ** kể cả sau
 * khi đã thu hẹp về đúng một nhà máy — tức sổ nợ nói dối theo chiều NGƯỢC LẠI, và một lượt rò
 * THẬT nằm lẫn trong tám dòng "đã biết" sẽ không ai nhìn ra.
 *
 * ⚠⚠ Ranh giới phải giữ, nếu không mục này thành lỗ hổng: một tên chỉ được thêm vào đây khi hàm
 * ấy phân giải phạm vi từ một **CHỨNG THỰC ĐƯỢC ĐỐI CHIẾU** (`machines.apiKey` /
 * `MASTER_API_KEY` / `ctx.user`). Một hàm đọc `input.factoryId` rồi lọc theo đó **KHÔNG** đủ
 * tiêu chuẩn — đó là lời TỰ KHAI của người gọi, đúng thứ mà §4 tồn tại để bắt.
 * (Lối `machineCode` của router ấy trình một mã KHÔNG PHẢI bí mật; nó vẫn bị thu hẹp về đúng nhà
 * máy của mã ấy, nhưng xem lời khai ở `publicProductScope.ts` — nó là ngưỡng vào thấp nhất và
 * đang chờ quyết định của chủ dự án.)
 */
const TEN_PHAN_GIAI = new Set([
  "resolveDataScope",
  "getAccessFilterConditions",
  "getUserAssignmentCodes",
  "getTenantScope",
  "resolveTenantFactoryScope",
  "getUserFactoryAssignments",
  "getUserCorporateAssignments",
  "phamViNhaMayCuaMay",
]);

/**
 * ★★★ Quét `server/**` và phân loại **mọi** thủ tục tRPC.
 * @param goc thư mục gốc repo.
 */
export function quetPhamViDoc(goc: string): KetQuaQuetPhamVi {
  const bang = bangTenant();
  const mu: string[] = [];
  if (bang.tongBang === 0) mu.push("drizzle/schema không cho bảng nào — bộ suy mất điểm neo");
  if (bang.tenBien.size === 0) mu.push("không suy ra được bảng TENANT nào — luật §A đã hỏng");

  const THU_MUC_SERVER = join(goc, "server");
  const files = moiFileTs(THU_MUC_SERVER).filter((f) => !f.endsWith(".test.ts"));
  if (files.length === 0) mu.push("không duyệt được file nào dưới server/** — bộ suy quét trúng 0 file");

  const duong = (p: string): string => relative(goc, p).split(sep).join("/");
  const noiDung = new Map<string, string>();
  for (const f of files) noiDung.set(f, readFileSync(f, "utf8"));

  const cayCua = new Map<string, ts.SourceFile>();
  const cay = (f: string): ts.SourceFile => {
    let c = cayCua.get(f);
    if (c === undefined) {
      c = ts.createSourceFile(duong(f), noiDung.get(f) ?? "", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      cayCua.set(f, c);
    }
    return c;
  };

  /** Phân giải một đường nhập tương đối (hoặc `@shared/…`) về file thật. */
  const phanGiai = (tuFile: string, spec: string): string | null => {
    let base: string;
    if (spec.startsWith(".")) base = resolve(dirname(tuFile), spec);
    else if (spec.startsWith("@shared/")) base = join(goc, "shared", spec.slice("@shared/".length));
    else return null;
    for (const c of [base, `${base}.ts`, join(base, "index.ts")]) {
      if (existsSync(c) && c.endsWith(".ts") && statSync(c).isFile()) return c;
    }
    return null;
  };

  interface Nhap {
    ten: Map<string, string>;
    ns: Map<string, string>;
  }
  const nhapCua = new Map<string, Nhap>();
  /**
   * Ràng buộc nhập của một file. Bắt **cả ba** hình dạng có thật trong cây:
   * `import {X} from`, `import * as NS from`, và — khuôn CỰC phổ biến của repo này —
   * `const { X } = await import("…")` (nhập ĐỘNG, bắt buộc từ `server/db/**`, xem
   * `accessControlLabels.ts`). Bỏ hình dạng thứ ba ⇒ bộ suy mù với phần lớn router.
   *
   * ★★★ 2026-08-18, lượt 4 — **LỖ ĐÃ ĐO: nhập CÓ TÊN không đi qua BARREL.**
   * Bản đầu ánh xạ `import { getMachines } from "../db"` thành `server/db/index.ts#getMachines`.
   * Nhưng `server/db/index.ts` là barrel **thuần** (24 dòng `export *`, **không** một khai báo
   * nào), nên nút ấy không tồn tại trong bao đóng §B — nút thật là
   * `server/db/hierarchy.ts#getMachines`. Nhánh `import * as db` thì lại CÓ đi qua `xuat()`.
   * ⇒ Cùng một lượt đọc, viết bằng hai cú pháp, cho hai phán quyết khác nhau; và cú pháp phổ
   * biến hơn cho phán quyết **LỎNG HƠN** (rơi vào nhóm C "không thuộc tenant").
   * Đo được: `GET /api/external/hierarchy/tree` (`getFullHierarchyFlat`),
   * `GET /api/external/machines/by-code/:code` (`getMachineByCode`, trả cả `machine.apiKey`) và
   * `GET /equipment` (`getMachines`) đều bị khai là **(C) không thuộc tenant**.
   * ⚠ Sửa ở đây làm dịch CON SỐ GHIM của bản điều tra dân số tRPC — đó là **một lời khai**, không
   *   phải một lượt bảo trì; xem khối "lượt 4" ở `phamViDocCensus.test.ts`.
   */
  const nhap = (f: string): Nhap => {
    const co = nhapCua.get(f);
    if (co !== undefined) return co;
    const ra: Nhap = { ten: new Map(), ns: new Map() };
    nhapCua.set(f, ra);
    const sf = cay(f);
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
      const dich = phanGiai(f, st.moduleSpecifier.text);
      const nb = st.importClause?.namedBindings;
      if (dich === null || nb === undefined) continue;
      if (ts.isNamedImports(nb)) {
        for (const el of nb.elements) {
          const g = el.propertyName?.text ?? el.name.text;
          // ĐI QUA BARREL — cùng phép phân giải mà nhánh `import * as NS` vẫn dùng (`thamChieu`).
          ra.ten.set(el.name.text, xuat(dich).get(g) ?? `${duong(dich)}#${g}`);
        }
      } else if (ts.isNamespaceImport(nb)) {
        ra.ns.set(nb.name.text, duong(dich));
      }
    }
    const di = (x: ts.Node): void => {
      if (ts.isVariableDeclaration(x) && x.initializer !== undefined) {
        let init: ts.Node = x.initializer;
        if (ts.isAwaitExpression(init)) init = init.expression;
        const a0 = ts.isCallExpression(init) ? init.arguments[0] : undefined;
        if (
          ts.isCallExpression(init) &&
          init.expression.kind === ts.SyntaxKind.ImportKeyword &&
          a0 !== undefined &&
          ts.isStringLiteral(a0)
        ) {
          const dich = phanGiai(f, a0.text);
          if (dich !== null) {
            if (ts.isObjectBindingPattern(x.name)) {
              for (const el of x.name.elements) {
                if (!ts.isIdentifier(el.name)) continue;
                const g =
                  el.propertyName !== undefined && ts.isIdentifier(el.propertyName)
                    ? el.propertyName.text
                    : el.name.text;
                // ĐI QUA BARREL — xem khối "lượt 4" ở docblock của `nhap`.
                ra.ten.set(el.name.text, xuat(dich).get(g) ?? `${duong(dich)}#${g}`);
              }
            } else if (ts.isIdentifier(x.name)) {
              ra.ns.set(x.name.text, duong(dich));
            }
          }
        }
      }
      ts.forEachChild(x, di);
    };
    di(sf);
    return ra;
  };

  /** Bảng export của một file, ĐI QUA `export * from` (barrel `server/db/index.ts` có 24 dòng). */
  const xuatCua = new Map<string, Map<string, string>>();
  const xuat = (f: string, sau = 0): Map<string, string> => {
    const co = xuatCua.get(f);
    if (co !== undefined) return co;
    const ra = new Map<string, string>();
    xuatCua.set(f, ra); // đặt TRƯỚC khi đệ quy — chống vòng nhập
    if (sau > 6 || !noiDung.has(f)) return ra;
    const rel = duong(f);
    for (const st of cay(f).statements) {
      const xuatRa = ts.canHaveModifiers(st)
        ? (ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false)
        : false;
      if (ts.isFunctionDeclaration(st) && st.name !== undefined && xuatRa) {
        ra.set(st.name.text, `${rel}#${st.name.text}`);
      } else if (ts.isVariableStatement(st) && xuatRa) {
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name)) ra.set(d.name.text, `${rel}#${d.name.text}`);
        }
      } else if (ts.isClassDeclaration(st) && st.name !== undefined && xuatRa) {
        ra.set(st.name.text, `${rel}#${st.name.text}`);
      } else if (ts.isExportDeclaration(st)) {
        const spec =
          st.moduleSpecifier !== undefined && ts.isStringLiteral(st.moduleSpecifier)
            ? st.moduleSpecifier.text
            : null;
        const dich = spec !== null ? phanGiai(f, spec) : null;
        if (st.exportClause !== undefined && ts.isNamedExports(st.exportClause)) {
          for (const el of st.exportClause.elements) {
            const g = el.propertyName?.text ?? el.name.text;
            ra.set(
              el.name.text,
              dich !== null ? (xuat(dich, sau + 1).get(g) ?? `${duong(dich)}#${g}`) : `${rel}#${g}`,
            );
          }
        } else if (st.exportClause === undefined && dich !== null) {
          for (const [k, v] of xuat(dich, sau + 1)) if (!ra.has(k)) ra.set(k, v);
        }
      }
    }
    return ra;
  };

  /** Khai báo cấp file: tên → cây con (thân hàm / khởi tạo). */
  const khaiCua = new Map<string, Map<string, ts.Node>>();
  const khai = (f: string): Map<string, ts.Node> => {
    const co = khaiCua.get(f);
    if (co !== undefined) return co;
    const ra = new Map<string, ts.Node>();
    khaiCua.set(f, ra);
    for (const st of cay(f).statements) {
      if (ts.isFunctionDeclaration(st) && st.name !== undefined && st.body !== undefined) {
        ra.set(st.name.text, st.body);
      } else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.initializer !== undefined) ra.set(d.name.text, d.initializer);
        }
      } else if (ts.isClassDeclaration(st) && st.name !== undefined) {
        ra.set(st.name.text, st);
      }
    }
    return ra;
  };

  /**
   * Mọi tham chiếu của một cây con, dưới dạng nút `file#tên`.
   * ⚠ Bỏ hai hình dạng KHÔNG BAO GIỜ là một ràng buộc (chúng đẻ cạnh giả): **tên ô** của object
   * literal, và **tên thuộc tính** của `a.b`. Nhưng `NS.thanhVien` với `NS` là một **namespace
   * import** thì NGƯỢC LẠI phải được phân giải — `import * as db from "../db"; db.getMachines()`
   * là khuôn của gần như mọi router trong repo này.
   */
  const thamChieu = (f: string, n: ts.Node): Set<string> => {
    const rel = duong(f);
    const nh = nhap(f);
    const ra = new Set<string>();
    const di = (x: ts.Node): void => {
      if (ts.isPropertyAccessExpression(x)) {
        if (ts.isIdentifier(x.expression)) {
          const mod = nh.ns.get(x.expression.text);
          if (mod !== undefined) {
            const dich = join(goc, ...mod.split("/"));
            ra.add(xuat(dich).get(x.name.text) ?? `${mod}#${x.name.text}`);
            return;
          }
        }
        di(x.expression);
        return;
      }
      if (ts.isPropertyAssignment(x)) {
        di(x.initializer);
        return;
      }
      if (ts.isIdentifier(x)) {
        ra.add(nh.ten.get(x.text) ?? `${rel}#${x.text}`);
        return;
      }
      ts.forEachChild(x, di);
    };
    di(n);
    return ra;
  };

  // ── hạt giống §B: khai báo có thân chạm một BẢNG tenant (drizzle hoặc SQL thô) ────────────
  const reSqlTenant =
    bang.tenSql.size > 0 ? new RegExp(`\\b(${[...bang.tenSql].join("|")})\\b`) : /$^/;
  const laSchema = (nodeId: string): boolean => nodeId.startsWith("drizzle/schema");
  const chamBangTrucTiep = (f: string, n: ts.Node): boolean => {
    for (const q of thamChieu(f, n)) {
      const [fi, tn] = q.split("#");
      if (fi !== undefined && laSchema(fi) && tn !== undefined && bang.tenBien.has(tn)) return true;
    }
    const txt = n.getText(cay(f));
    return /\bsql`|\bquery\s*\(|\bexecute\s*\(/.test(txt) && reSqlTenant.test(txt);
  };

  const hatDoc = new Set<string>();
  const hatPhamVi = new Set<string>();
  for (const f of files) {
    const rel = duong(f);
    for (const [ten, than] of khai(f)) {
      if (chamBangTrucTiep(f, than)) hatDoc.add(`${rel}#${ten}`);
      for (const q of thamChieu(f, than)) {
        const t = q.split("#")[1];
        if (t !== undefined && TEN_PHAN_GIAI.has(t)) {
          hatPhamVi.add(`${rel}#${ten}`);
          break;
        }
      }
    }
  }

  // ── bao đóng NGƯỢC: ai gọi tới được một hạt giống ────────────────────────────────────────
  const docTenant = new Set(hatDoc);
  for (let vong = 0; vong < 15; vong++) {
    let them = 0;
    for (const f of files) {
      const rel = duong(f);
      for (const [ten, than] of khai(f)) {
        const id = `${rel}#${ten}`;
        if (docTenant.has(id)) continue;
        for (const q of thamChieu(f, than)) {
          if (docTenant.has(q)) {
            docTenant.add(id);
            them++;
            break;
          }
        }
      }
    }
    if (them === 0) break;
  }

  // ── §C + phân loại thủ tục ───────────────────────────────────────────────────────────────
  const thuTuc: ThuTuc[] = [];
  for (const f of files) {
    const src = noiDung.get(f) ?? "";
    if (!src.includes("router(")) continue;
    const rel = duong(f);
    const sf = cay(f);

    /** Mọi `router({…})` đã được đi vào từ một điểm vào CÓ TÊN — phần còn lại là ô mù. */
    const daTham = new Set<ts.ObjectLiteralExpression>();

    const xuLyRouter = (obj: ts.ObjectLiteralExpression, duongR: string[]): void => {
      daTham.add(obj);
      for (const p of obj.properties) {
        if (!ts.isPropertyAssignment(p)) continue;
        const ten =
          ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : p.name.getText(sf);
        const con = objRouter(p.initializer);
        if (con !== null) {
          xuLyRouter(con, [...duongR, ten]);
          continue;
        }
        {
          const san = gocChuoi(p.initializer);
          if (san === null || san === "router") continue;

          let loai: ThuTuc["loai"] | null = null;
          let than: ts.Node | null = null;
          const doc = (x: ts.Node): void => {
            if (loai === null && ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression)) {
              const m = x.expression.name.text;
              if (m === "query" || m === "mutation" || m === "subscription") {
                const arg = x.arguments[0];
                if (arg !== undefined) {
                  loai = m;
                  than = arg;
                }
              }
            }
            ts.forEachChild(x, doc);
          };
          doc(p.initializer);
          if (loai === null || than === null) continue;
          const thanNode: ts.Node = than;

          // §C — danh tính có RỜI TAY không (hỏi trên CÂY, không trên văn bản)
          let danhTinhRoiTay = false;
          const chuoiCtx = (x: ts.Node): string =>
            x.getText(sf).replace(/[\s?!]/g, "");
          const laDanhTinh = (x: ts.Node): boolean => {
            const t = chuoiCtx(x);
            return t === "ctx" || t.startsWith("ctx.user") || t.startsWith("ctx.tenantScope");
          };
          const diCtx = (x: ts.Node): void => {
            if (ts.isCallExpression(x)) {
              for (const a of x.arguments) {
                if (laDanhTinh(a)) danhTinhRoiTay = true;
                if (!ts.isObjectLiteralExpression(a)) continue;
                for (const pr of a.properties) {
                  if (ts.isPropertyAssignment(pr) && laDanhTinh(pr.initializer)) danhTinhRoiTay = true;
                  else if (ts.isShorthandPropertyAssignment(pr) && pr.name.text === "ctx") danhTinhRoiTay = true;
                  else if (ts.isSpreadAssignment(pr) && laDanhTinh(pr.expression)) danhTinhRoiTay = true;
                }
              }
            }
            if (ts.isVariableDeclaration(x) && x.initializer !== undefined && laDanhTinh(x.initializer)) {
              danhTinhRoiTay = true;
            }
            ts.forEachChild(x, diCtx);
          };
          diCtx(thanNode);

          const nut = thamChieu(f, thanNode);
          const chamTenant =
            chamBangTrucTiep(f, thanNode) || [...nut].some((q) => docTenant.has(q));
          thuTuc.push({
            file: rel,
            dong: sf.getLineAndCharacterOfPosition(p.getStart(sf)).line + 1,
            ten,
            duongRouter: duongR.join("."),
            san,
            loai,
            danhTinhRoiTay,
            chamTenant,
            tuPhanGiaiPhamVi: !danhTinhRoiTay && [...nut].some((q) => hatPhamVi.has(q)),
            bangChung: [...nut].filter((q) => docTenant.has(q)).sort().slice(0, 4),
          });
        }
      }
    };

    // Điểm vào CÓ TÊN: `const X = router({…})` ở cấp file (kể cả `export const`).
    for (const [tenBien, kh] of khai(f)) {
      const obj = objRouter(kh);
      if (obj !== null) xuLyRouter(obj, [tenBien]);
    }
    // Cầu chì: `router({…})` KHÔNG với tới được từ một điểm vào có tên ⇒ ô mù (không phải bỏ qua).
    const soatMu = (n: ts.Node): void => {
      const obj = objRouter(n);
      if (obj !== null && !daTham.has(obj)) {
        mu.push(
          `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} — \`router({…})\` không gắn vào một \`const\` cấp file ⇒ bộ suy không đặt tên được đường router`,
        );
        xuLyRouter(obj, ["(vô danh)"]);
      }
      ts.forEachChild(n, soatMu);
    };
    soatMu(sf);
  }
  if (thuTuc.length === 0) mu.push("không thấy thủ tục tRPC nào — bộ suy đã mất hình dạng `router({…})`");

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // §D — TUYẾN EXPRESS. Xem docblock §D ở đầu file để biết vì sao nó dùng LẠI đúng bộ máy trên.
  // ══════════════════════════════════════════════════════════════════════════════════════════

  // ── D.1 — bản đồ ALIAS tRPC, suy từ chính `appRouter` (để giải được lượt UỶ QUYỀN) ────────
  const diemVaoRouter = new Map<string, { f: string; obj: ts.ObjectLiteralExpression }>();
  for (const f of files) {
    for (const [ten, kh] of khai(f)) {
      const obj = objRouter(kh);
      if (obj !== null) diemVaoRouter.set(`${duong(f)}#${ten}`, { f, obj });
    }
  }
  /** `"publicProductApi"` → `"server/routers/publicProductApiRouter.ts#publicProductApiRouter"`. */
  const nutCuaAlias = new Map<string, string>();
  const giaiAlias = (
    f: string,
    obj: ts.ObjectLiteralExpression,
    alias: string[],
    nutFile: string,
    nutDuong: string[],
    sau: number,
  ): void => {
    if (sau > 8) return;
    for (const p of obj.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const ten =
        ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : p.name.getText(cay(f));
      const con = objRouter(p.initializer);
      if (con !== null) {
        const d = [...nutDuong, ten];
        nutCuaAlias.set([...alias, ten].join("."), `${nutFile}#${d.join(".")}`);
        giaiAlias(f, con, [...alias, ten], nutFile, d, sau + 1);
        continue;
      }
      const init = boVo(p.initializer);
      if (!ts.isIdentifier(init)) continue;
      const nut = nhap(f).ten.get(init.text) ?? `${duong(f)}#${init.text}`;
      const vao = diemVaoRouter.get(nut);
      if (vao === undefined) continue;
      const [nf, nt] = nut.split("#");
      if (nf === undefined || nt === undefined) continue;
      nutCuaAlias.set([...alias, ten].join("."), nut);
      giaiAlias(vao.f, vao.obj, [...alias, ten], nf, [nt], sau + 1);
    }
  };
  {
    const goc = diemVaoRouter.get("server/routers.ts#appRouter");
    if (goc === undefined) {
      mu.push("không tìm thấy `server/routers.ts#appRouter` — không giải được lượt UỶ QUYỀN của tuyến REST");
    } else {
      giaiAlias(goc.f, goc.obj, [], "server/routers.ts", ["appRouter"], 0);
    }
  }

  // ── D.2 — khai báo ở MỌI ĐỘ SÂU (thân `startServer()` dài 6.000 dòng nằm trọn trong một hàm) ─
  const khaiLongCua = new Map<string, Map<string, ts.Node>>();
  const khaiLong = (f: string): Map<string, ts.Node> => {
    const co = khaiLongCua.get(f);
    if (co !== undefined) return co;
    const ra = new Map<string, ts.Node>();
    khaiLongCua.set(f, ra);
    const di = (x: ts.Node): void => {
      if (ts.isFunctionDeclaration(x) && x.name !== undefined && x.body !== undefined) {
        if (!ra.has(x.name.text)) ra.set(x.name.text, x.body);
      } else if (ts.isVariableDeclaration(x) && ts.isIdentifier(x.name) && x.initializer !== undefined) {
        if (!ra.has(x.name.text)) ra.set(x.name.text, x.initializer);
      }
      ts.forEachChild(x, di);
    };
    di(cay(f));
    return ra;
  };

  /** Nút mà một thân handler với tới, MỞ RỘNG qua các hàm phụ **cùng file, trong lòng hàm khác**. */
  const moRong = (f: string, n: ts.Node): { nut: Set<string>; chamTrucTiep: boolean } => {
    const rel = duong(f);
    const capFile = khai(f);
    const noiBo = khaiLong(f);
    const nut = new Set<string>();
    let chamTrucTiep = false;
    const daXet = new Set<string>();
    const hangDoi: ts.Node[] = [n];
    for (let i = 0; i < hangDoi.length && i < 300; i++) {
      const cur = hangDoi[i];
      if (cur === undefined) continue;
      if (chamBangTrucTiep(f, cur)) chamTrucTiep = true;
      for (const q of thamChieu(f, cur)) {
        nut.add(q);
        if (!q.startsWith(`${rel}#`)) continue;
        const ten = q.slice(rel.length + 1);
        // Khai báo CẤP FILE đã nằm trong bao đóng NGƯỢC toàn cục — mở rộng lại là thừa.
        if (capFile.has(ten) || daXet.has(ten)) continue;
        const than = noiBo.get(ten);
        if (than === undefined) continue;
        daXet.add(ten);
        hangDoi.push(than);
      }
    }
    return { nut, chamTrucTiep };
  };

  /**
   * Lời gọi này có nằm trên **đường ĐỌC** không — tức nó có phải nơi mà một danh tính đi vào thì
   * lượt đọc bị thu hẹp? Xem BẬC 2 ở docblock `danhTinhRoiTayRest` để biết vì sao ô này bắt buộc.
   *
   * ⚠ Chấp nhận CẢ HAI: (i) callee giải ra một nút trong bao đóng "đọc bảng tenant" (§B), và
   *   (ii) callee là một tên trong `TEN_PHAN_GIAI` — bộ phân giải phạm vi có thể tự nó không đọc
   *   bảng tenant nào (`phamViNhaMayCuaMay` đi qua ba phép tra khoá chính), nhưng nhận danh tính ở
   *   đó **là** một lượt thu hẹp.
   */
  const noiNhanLocCua = (f: string) => (goi: ts.CallExpression): boolean => {
    let co = false;
    for (const q of thamChieu(f, goi.expression)) {
      const t = q.split("#")[1];
      // ⚠⚠ BỘ PHÂN GIẢI **KHÔNG TÍNH** — xem BẬC 3 ở docblock `danhTinhRoiTayRest`.
      if (t !== undefined && TEN_PHAN_GIAI.has(t)) return false;
      if (docTenant.has(q)) co = true;
    }
    return co;
  };

  // ── D.3 — quét đăng ký tuyến ─────────────────────────────────────────────────────────────
  const tuyen: TuyenExpress[] = [];
  const tuyenTinh: string[] = [];
  for (const f of files) {
    const src = noiDung.get(f) ?? "";
    if (!/\.(get|post|put|patch|delete|head|options|all)\s*\(/.test(src) && !src.includes(".use(")) continue;
    const rel = duong(f);
    const sf = cay(f);

    const di = (x: ts.Node): void => {
      if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression)) {
        const m = x.expression.name.text.toLowerCase();
        const a0 = x.arguments[0];
        const cuoi = x.arguments[x.arguments.length - 1];

        // Cầu chì: `app.use("/x", express.static(…))` phục vụ BYTE TỆP, không đi qua một lượt đọc
        // bảng nào ⇒ bộ suy này KHÔNG phát biểu được gì về nó. Ghi ra để nó không im lặng.
        if (m === "use" && /\bstatic\s*\(/.test(x.getText(sf))) {
          tuyenTinh.push(
            `${rel}:${sf.getLineAndCharacterOfPosition(x.getStart(sf)).line + 1} — ${x.getText(sf).replace(/\s+/g, " ").slice(0, 120)}`,
          );
        }

        if (PHUONG_THUC_TUYEN.has(m) && x.arguments.length >= 2 && cuoi !== undefined) {
          const laHam =
            ts.isArrowFunction(cuoi) ||
            ts.isFunctionExpression(cuoi) ||
            ts.isIdentifier(cuoi) ||
            ts.isCallExpression(cuoi);
          if (laHam) {
            const duongTuyen = duongDangKy(a0, f, khai, khaiLong);
            if (duongTuyen !== null) {
              const than = cuoi;
              const { nut, chamTrucTiep } = moRong(f, than);
              const chamTenant = chamTrucTiep || [...nut].some((q) => docTenant.has(q));
              tuyen.push({
                file: rel,
                dong: sf.getLineAndCharacterOfPosition(x.getStart(sf)).line + 1,
                phuongThuc: m.toUpperCase(),
                duong: duongTuyen,
                bien: gocChuoi(x.expression) ?? "(?)",
                chungThuc: x.arguments
                  .slice(1, -1)
                  .map((a) => a.getText(sf).replace(/\s+/g, " ").slice(0, 60)),
                chamTenant,
                danhTinhRoiTay: danhTinhRoiTayRest(than, noiNhanLocCua(f)),
                tuPhanGiaiPhamVi:
                  [...nut].some((q) => hatPhamVi.has(q)) ||
                  [...nut].some((q) => {
                    const t = q.split("#")[1];
                    return t !== undefined && TEN_PHAN_GIAI.has(t);
                  }),
                uyQuyen: uyQuyenCua(than, nutCuaAlias),
                bangChung: [...nut].filter((q) => docTenant.has(q)).sort().slice(0, 4),
              });
            } else if (
              a0 !== undefined &&
              (ts.isArrowFunction(cuoi) || ts.isFunctionExpression(cuoi)) &&
              /^\s*(app|router|r|apiRouter|api|server)\b/.test(x.expression.getText(sf))
            ) {
              // Đường dẫn KHÔNG phải chuỗi hằng ⇒ bộ suy không đặt tên được tuyến ⇒ ô MÙ.
              mu.push(
                `${rel}:${sf.getLineAndCharacterOfPosition(x.getStart(sf)).line + 1} — \`${m}(…)\` với đường dẫn KHÔNG phải chuỗi hằng ⇒ tuyến này không vào được bản điều tra dân số`,
              );
            }
          }
        }
      }
      ts.forEachChild(x, di);
    };
    di(sf);
  }
  if (tuyen.length === 0) mu.push("không thấy tuyến Express nào — bộ suy đã mất hình dạng `app.get(\"/…\", …)`");

  return {
    thuTuc: thuTuc.sort((a, b) => khoaCua(a).localeCompare(khoaCua(b))),
    tuyen: tuyen.sort((a, b) => khoaTuyen(a).localeCompare(khoaTuyen(b))),
    tuyenTinh: tuyenTinh.sort(),
    mu,
    soFileDuyet: files.length,
    bang,
    soNutDocTenant: docTenant.size,
  };
}

/** Phương thức HTTP được coi là một ĐĂNG KÝ TUYẾN (không phải `req.get("host")`). */
const PHUONG_THUC_TUYEN = new Set(["get", "post", "put", "patch", "delete", "head", "options", "all"]);

/**
 * Đường dẫn của một lượt đăng ký tuyến — `null` nghĩa là *"đây không phải một tuyến đặt tên được"*.
 *
 * BA hình dạng có thật trong cây, và cả ba đều **bắt buộc** (đo 2026-08-18: bỏ hình dạng 2 hoặc 3
 * làm **4 tuyến** rơi ra khỏi bản điều tra dân số, trong đó **ba** là đường XUẤT dữ liệu kiểm hàng
 * loạt của `exportRouter`):
 *   1. chuỗi hằng — `app.get("/api/health", …)`;
 *   2. **regex** — `r.get(/^\/inspections\.(csv|json|xlsx|pdf)$/, …)`. Express nhận regex làm
 *      đường dẫn; nguồn regex là một khoá ổn định hệt như một chuỗi.
 *   3. **hằng có tên** — `app.post(CSP_REPORT_PATH, …)`, tra về khai báo `const … = "/…"`.
 */
function duongDangKy(
  a0: ts.Expression | undefined,
  f: string,
  khai: (f: string) => Map<string, ts.Node>,
  khaiLong: (f: string) => Map<string, ts.Node>,
): string | null {
  if (a0 === undefined) return null;
  if (ts.isStringLiteralLike(a0)) return a0.text.startsWith("/") ? a0.text : null;
  if (ts.isRegularExpressionLiteral(a0)) return a0.text;
  if (ts.isIdentifier(a0)) {
    const kh = khai(f).get(a0.text) ?? khaiLong(f).get(a0.text);
    if (kh !== undefined && ts.isStringLiteralLike(kh) && kh.text.startsWith("/")) return kh.text;
  }
  return null;
}

/** Phương thức ĐỌC — chỉ những tuyến này mới trả dữ liệu về cho người gọi. */
const PHUONG_THUC_DOC = new Set(["GET", "HEAD"]);

/**
 * Gốc của một biểu thức **danh tính đã được máy chủ xác thực** trong một tuyến REST.
 *
 * ⚠⚠ `input`/`req.query`/`req.body` **KHÔNG** có mặt ở đây, và đó là ranh giới load-bearing: một
 * `req.query.factoryId` là lời **TỰ KHAI** của người gọi, đúng thứ mà cả bản điều tra dân số này
 * tồn tại để bắt.
 */
const GOC_DANH_TINH_REST = [
  "req.user",
  "req.externalUser",
  "req.userId",
  // ⚠ `req.apiPrincipal` là hình dạng danh tính của **KHOÁ API** (`server/api/v1/auth.ts:200`),
  //   trục phạm vi của cả `/api/v1/**`, `/api/bi/**` và `/api/export/**`. Bỏ nó ra khỏi đây thì
  //   `GET /datasets/:name` của `biRouter` — bề mặt được thu hẹp KỸ NHẤT repo này có, kèm cả
  //   `dataset_not_tenant_scopable` — bị khai là **RÒ RỈ**. Đo được: một lượt ĐỎ GIẢ.
  "req.apiPrincipal",
  "req.apiKeyScope",
  "req.machine",
  "ctx",
] as const;

/**
 * Hàm phân giải một CHỨNG THỰC ĐƯỢC ĐỐI CHIẾU thành danh tính. Giá trị trả về của chúng là
 * "danh tính", nên một biến nhận giá trị ấy cũng là danh tính.
 *
 * ⚠ Ranh giới giống hệt `TEN_PHAN_GIAI`: chỉ những hàm đối chiếu với một BÍ MẬT / SỔ ĐĂNG KÝ
 * (`machines.apiKey` · `machines.code` · cookie phiên · `MASTER_API_KEY`). Một hàm nhận
 * `input.factoryId` rồi tra bảng KHÔNG đủ tiêu chuẩn.
 */
const HAM_DANH_TINH_REST = new Set([
  "authenticateRequest",
  "thuXacThucRest",
  "doiVaiDacQuyen",
  "createContext",
  "verifySession",
  "getUserByOpenId",
  "getMachineByApiKey",
  "getMachineByCode",
  // `authenticateExportRequest` (`server/api/export/exportRouter.ts:173`) tra khoá về hàng
  // `api_keys` qua `resolvePrincipal`, ĐÒI phạm vi đã khai (`isTenantScopeDeclared`, mig 0325) rồi
  // trả `principal.tenantScope`. Đúng tiêu chuẩn "chứng thực ĐƯỢC ĐỐI CHIẾU". Không khai tên này ⇒
  // ba đường XUẤT hàng loạt của `exportRouter` + `/api/reports/artifacts/:id/download` — bốn bề
  // mặt CÓ thu hẹp thật — bị khai là RÒ RỈ (đo được: bốn lượt ĐỎ GIẢ).
  "authenticateExportRequest",
  "resolvePrincipal",
  // `phamViGoiNgoai` (`server/routes/_phamViNgoai.ts`) đọc **`req.externalUser`** — thứ do
  // `validateExternalAuth` đặt SAU khi đối chiếu vé phiên (`verifySession` + `getUserByOpenId` +
  // ba phép chặn). Đủ tiêu chuẩn "chứng thực ĐƯỢC ĐỐI CHIẾU".
  // ⚠ Khai tên ở đây **KHÔNG** khẳng định "đã thu hẹp": hàm ấy trả `{kieu:"toanCuc"}` cho nhánh
  //   `x-master-key`. Bằng chứng thu hẹp vẫn là `danhTinhRoiTay` — giá trị phải ĐI VÀO lời gọi dữ
  //   liệu. Một tuyến gọi `phamViGoiNgoai(req)` rồi vứt kết quả đi vẫn ở nhóm **A**.
  "phamViGoiNgoai",
]);

/**
 * ★★★ §D-C — **DANH TÍNH CÓ ĐI VÀO LƯỢT ĐỌC KHÔNG.** Chặt hơn §C của tRPC HAI BẬC, mỗi bậc có một
 * lượt đột biến ĐÃ CHẠY làm bằng chứng.
 *
 * **BẬC 1.** §C (tRPC) coi *"gán ra một biến"* là đủ. Với tuyến REST thì **không đủ**: lỗ vừa vá ở
 * `publicProductApiRouter` có hình dạng chính xác là *"gọi `validateAccess(input)` rồi **VỨT** giá
 * trị trả về đi"* — danh tính ĐÃ nằm trong tay handler và không ai dùng. Một vị từ tính "đã gán"
 * là xanh sẽ khai đúng lỗ ấy là ĐÃ LỌC. ⇒ danh tính phải **ĐI VÀO một lời gọi** (ở bất kỳ độ sâu
 * nào trong đối số — điều này cũng vá ô mù `f({ actor: { id: ctx.user.id } })` đã ghi ở
 * `phamViDocCensus.test.ts`).
 *
 * **BẬC 2 — ĐO ĐƯỢC 2026-08-18, và bậc 1 MỘT MÌNH đã cho một lượt XANH GIẢ.** Đột biến: gỡ đúng
 * phép thu hẹp của `GET /api/external/stations` (`getStations(nguoiXem)` → `getStations()`) mà
 * **giữ nguyên** dòng nhãn `res.json({ scopeApplied: phamViDaAp(phamVi), … })`. Cổng vẫn **XANH**:
 * danh tính có đi vào một lời gọi (`phamViDaAp`), chỉ là lời gọi ấy **không đọc gì cả** — nó dựng
 * một cái NHÃN. Tức bậc 1 đo *"danh tính có được dùng ở đâu đó"*, không đo *"danh tính có thu hẹp
 * lượt đọc"*, và một handler chỉ cần in nhãn là thoát.
 *
 * ⇒ **Nơi NHẬN cũng phải nằm trên đường ĐỌC**: lời gọi nhận danh tính phải giải ra một nút trong
 *   bao đóng "đọc bảng tenant" (§B). Đó chính là `laNoiNhanLoc`. Với luật này, đột biến trên rơi
 *   về nhóm **A** — đã đo lại và xác nhận.
 *
 * **BẬC 3 — ĐO ĐƯỢC 2026-08-18, và bậc 2 MỘT MÌNH vẫn cho một lượt XANH GIẢ THỨ HAI.** Đột biến:
 * ở `GET /api/public/products/:productCode/reference-image-file` — chính tuyến là **lỗ thứ chín**
 * — vô hiệu hoá đúng cái cổng SQL (`if (…) → if (false && …)`, tức bỏ hẳn lời gọi
 * `sanPhamTrongNhaMay`), **giữ nguyên** lượt `phamViNhaMayCuaMay(machine)` phía trên. Cổng vẫn
 * **XANH**: `phamViNhaMayCuaMay` đọc `stations/production_lines/workshops` nên nó NẰM trong bao
 * đóng §B, và nó nhận danh tính. Tức bậc 2 đo *"handler có PHÂN GIẢI ra một phạm vi"*, không đo
 * *"handler có ÁP phạm vi ấy"* — và phân giải rồi vứt đi là **đúng hình dạng của lỗ gốc**
 * (`publicProductApiRouter` gọi `validateAccess` rồi bỏ giá trị trả về).
 *
 * ⇒ **Lời gọi là một BỘ PHÂN GIẢI (`TEN_PHAN_GIAI`) thì KHÔNG tính.** Bằng chứng thu hẹp phải là
 *   danh tính — hoặc thứ suy ra từ nó — đi vào một lượt đọc **KHÁC** bộ phân giải. Vì thế
 *   `danhTinhRoiTayRest` cũng phải theo được phép **GÁN LẠI** (`phamVi = await phamViNhaMayCuaMay(…)`,
 *   một `let` khởi tạo `null`), chứ không chỉ khai báo `const` — nếu không, chuỗi
 *   `machine → phamVi → factoryIdCong → sanPhamTrongNhaMay(…)` đứt ngay chặng đầu.
 */
function danhTinhRoiTayRest(than: ts.Node, laNoiNhanLoc: (goi: ts.CallExpression) => boolean): boolean {
  const bien = new Set<string>();
  const laDanhTinh = (n: ts.Node): boolean => {
    const p = duongTruyCap(n);
    if (p === null) return false;
    if (GOC_DANH_TINH_REST.some((g) => p === g || p.startsWith(`${g}.`))) return true;
    const goc = p.split(".")[0];
    return goc !== undefined && bien.has(goc);
  };
  const chuaDanhTinh = (n: ts.Node): boolean => {
    let thay = false;
    const di = (y: ts.Node): void => {
      if (thay) return;
      if (laDanhTinh(y)) {
        thay = true;
        return;
      }
      ts.forEachChild(y, di);
    };
    di(n);
    return thay;
  };
  /**
   * Vế phải này có làm vế trái mang danh tính không?
   * ⇒ hoặc bản thân nó CHỨA một biểu thức danh tính, hoặc nó gọi một hàm phân giải chứng thực.
   */
  const veTraiThanhDanhTinh = (init: ts.Node): boolean => {
    if (chuaDanhTinh(init)) return true;
    let la = false;
    const di = (y: ts.Node): void => {
      if (la) return;
      if (ts.isCallExpression(y)) {
        const e = y.expression;
        const ten = ts.isPropertyAccessExpression(e) ? e.name.text : ts.isIdentifier(e) ? e.text : "";
        if (HAM_DANH_TINH_REST.has(ten) || TEN_PHAN_GIAI.has(ten)) la = true;
      }
      ts.forEachChild(y, di);
    };
    di(init);
    return la;
  };
  // BA lượt: một biến danh tính có thể được suy ra từ một biến khai/gán SAU nó, và chuỗi thật dài
  // nhất đo được có ba chặng (`machine → phamVi → factoryIdCong`).
  for (let vong = 0; vong < 3; vong++) {
    const diKhai = (x: ts.Node): void => {
      // ⚠ PHÉP GÁN LẠI, không chỉ khai báo — xem BẬC 3 ở docblock: `let phamVi = null;` rồi
      //   `phamVi = await phamViNhaMayCuaMay(machine);` là khuôn CÓ THẬT của tuyến đã vá, và một
      //   vị từ chỉ nhìn `const … = …` sẽ đứt chuỗi ngay chặng đầu.
      if (
        ts.isBinaryExpression(x) &&
        x.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(x.left) &&
        veTraiThanhDanhTinh(boVo(x.right))
      ) {
        bien.add(x.left.text);
      }
      if (ts.isVariableDeclaration(x) && x.initializer !== undefined) {
        const init = boVo(x.initializer);
        // ⚠ Danh tính được **NHÀO LẠI** vẫn là danh tính. Khuôn có thật (`reportArtifactRoutes.ts:46`):
        //   `const viewer = auth.principal.kind === "session" ? { id: auth.principal.userId, … } : …`
        //   — gốc biểu thức là một `?:`, không phải một đường truy cập; chỉ hỏi ở GỐC thì `viewer`
        //   không phải danh tính, và `getDownloadTarget(id, viewer)` — bề mặt CÓ lọc theo người xem
        //   — bị khai là RÒ RỈ.
        const la = veTraiThanhDanhTinh(init);
        if (la) {
          if (ts.isIdentifier(x.name)) bien.add(x.name.text);
          else if (ts.isObjectBindingPattern(x.name)) {
            for (const el of x.name.elements) if (ts.isIdentifier(el.name)) bien.add(el.name.text);
          }
        }
      }
      ts.forEachChild(x, diKhai);
    };
    diKhai(than);
  }
  let roiTay = false;
  const diGoi = (x: ts.Node): void => {
    if (roiTay) return;
    if (ts.isCallExpression(x) && laNoiNhanLoc(x)) {
      for (const a of x.arguments) if (chuaDanhTinh(a)) roiTay = true;
    }
    ts.forEachChild(x, diGoi);
  };
  diGoi(than);
  return roiTay;
}

/**
 * Tuyến này có **UỶ QUYỀN** cho một thủ tục tRPC không — `caller.publicProductApi.listProducts(…)`.
 *
 * Trả về khoá `khoaCua()` của thủ tục đích khi giải được, để nhóm (U) là một **phép nối có kiểm
 * chứng** chứ không phải một cái nhãn: đích rơi vào nhóm (A) của bản điều tra dân số tRPC thì tuyến
 * REST ấy đang rò **qua** một món nợ đã có tên trong sổ, và cổng nói ra được điều đó.
 */
function uyQuyenCua(than: ts.Node, nutCuaAlias: ReadonlyMap<string, string>): string[] {
  const ra = new Set<string>();
  const di = (x: ts.Node): void => {
    if (ts.isCallExpression(x)) {
      const p = duongTruyCap(x.expression);
      if (p !== null) {
        const phan = p.split(".");
        if (phan.length >= 3 && phan[0] === "caller") {
          const seg = phan.slice(1);
          for (let k = seg.length - 1; k >= 1; k--) {
            const nut = nutCuaAlias.get(seg.slice(0, k).join("."));
            if (nut !== undefined) {
              ra.add(`${nut}.${seg.slice(k).join(".")}`);
              break;
            }
          }
        }
      }
    }
    ts.forEachChild(x, di);
  };
  di(than);
  return [...ra].sort();
}

/**
 * ★★★ Một tuyến **Express** tìm thấy trên đĩa — thứ mà bản điều tra dân số tRPC **không đếm được**.
 */
export interface TuyenExpress {
  /** Đường tương đối gốc repo, dấu `/`. */
  readonly file: string;
  readonly dong: number;
  /** `GET` · `POST` … (in hoa). */
  readonly phuongThuc: string;
  /**
   * Đường dẫn **như viết trong mã**. ⚠ CHƯA gắn tiền tố `app.use("/api/v1", …)`: bộ suy KHÔNG đi
   * tìm nơi gắn, vì đoán một tiền tố là bịa. Khoá vì thế mang cả `file` để vẫn duy nhất.
   */
  readonly duong: string;
  /** Biến nhận đăng ký (`app` · `r` · `router`). */
  readonly bien: string;
  /** Các đối số ĐỨNG GIỮA đường dẫn và handler — middleware xác thực, giới hạn, v.v. */
  readonly chungThuc: readonly string[];
  /** Handler với tới được một lượt ĐỌC bảng tenant không. */
  readonly chamTenant: boolean;
  /** Danh tính đã xác thực có ĐI VÀO một lời gọi không — xem `danhTinhRoiTayRest`. */
  readonly danhTinhRoiTay: boolean;
  /** Handler có gọi tới một bộ phân giải phạm vi (`TEN_PHAN_GIAI`) không. */
  readonly tuPhanGiaiPhamVi: boolean;
  /** Khoá `khoaCua()` của những thủ tục tRPC mà tuyến này uỷ quyền tới. */
  readonly uyQuyen: readonly string[];
  /** Bằng chứng: vài nút ĐỌC-TENANT mà handler chạm tới. */
  readonly bangChung: readonly string[];
}

/**
 * Năm nhóm của tuyến Express. Bốn nhóm đầu là **cùng khuôn** với bản tRPC; **(U)** là nhóm phải
 * TÁCH RA, và đây là lý do đo được chứ không phải cho gọn:
 *
 * Hơn một nửa tuyến `/api/**` của repo này chỉ dựng `createContext({req,res})` rồi gọi
 * `appRouter.createCaller(ctx).x.y(…)`. Gộp chúng vào **(S)** là khai *"đã lọc"* cho một tuyến mà
 * phán quyết phạm vi **nằm ở chỗ khác**; gộp vào **(A)** là ghi sổ **HAI LẦN** đúng một món nợ đã
 * có tên trong `phamViDocBaseline.ts`. Cả hai đều là con số đúng-về-thứ-khác. ⇒ (U) = *"phán quyết
 * của tuyến này ĐÚNG BẰNG phán quyết của thủ tục đích"*, và `uyQuyen` cho biết đích là ai.
 */
export type NhomTuyen = "A" | "C" | "D" | "S" | "U";

/**
 * ★★★ VỊ TỪ PHÁN QUYẾT cho tuyến Express — mỗi tuyến vào **ĐÚNG MỘT** nhóm.
 *
 *  • **D — GHI**: `POST`/`PUT`/`PATCH`/`DELETE`. Phạm vi ĐỌC không áp dụng.
 *  • **U — UỶ QUYỀN**: thân chỉ chuyển tiếp sang một thủ tục tRPC đã được đếm.
 *  • **C — KHÔNG THUỘC TENANT**: không với tới lượt đọc bảng tenant nào (health, metrics, tài liệu…).
 *  • **S — ĐÃ LỌC**: chạm dữ liệu tenant VÀ **danh tính đi vào một lời gọi**.
 *  • **A — RÒ RỈ**: chạm dữ liệu tenant, không tầng nào lọc.
 *
 * ⚠⚠⚠ **`tuPhanGiaiPhamVi` KHÔNG được tính là "đã lọc"** — đây là một lượt XANH GIẢ đã bắt được
 * tại chỗ, và nó là lý do ô ấy vẫn được ghi ra nhưng KHÔNG vào vị từ:
 *
 *     GET /api/external/oee/summary  →  getAllMachinesOEELive()      ← KHÔNG một đối số nào
 *     getAllMachinesOEELive(params?) →  resolveTenantFactoryScope(params)
 *     resolveTenantFactoryScope(undefined) → `{ factoryIds: null, labels: UNSCOPED_LABELS }`
 *                                            (`server/db/reportAggregators.ts:338`)
 *
 * ⇒ Hàm được gọi **CÓ** chứa một bộ phân giải phạm vi, và lượt gọi ấy vẫn trả **TOÀN BỘ đội máy
 *   của mọi nhà máy**, vì người gọi không đưa cho nó danh tính nào để phân giải. Một vị từ nhận
 *   *"có với tới bộ phân giải"* là đủ sẽ dán nhãn ĐÃ LỌC lên đúng một lỗ đang mở.
 * ⚠ Ngoại lệ DUY NHẤT đã biết đi theo hướng ngược lại — `phamViNhaMayCuaMay` tự đối chiếu chứng
 *   thực — vẫn xanh ở đây, nhưng qua `danhTinhRoiTay`: người gọi phải trao cho nó đối tượng máy
 *   đã phân giải từ `x-api-key`/`x-machine-code`, và đó **là** một lượt danh tính rời tay.
 */
export function nhomTuyenCua(t: TuyenExpress): NhomTuyen {
  if (!PHUONG_THUC_DOC.has(t.phuongThuc)) return "D";
  if (t.uyQuyen.length > 0) return "U";
  if (!t.chamTenant) return "C";
  if (t.danhTinhRoiTay) return "S";
  return "A";
}

/**
 * Khoá ỔN ĐỊNH của một tuyến trong bảng kê — **KHÔNG mang số dòng** (cùng lý lẽ với `khoaCua`).
 * Mang `file` vì đường dẫn literal chưa gắn tiền tố mount (`/models` của `openaiGateway` và
 * `/models` của một sub-router khác là hai tuyến khác nhau).
 */
export function khoaTuyen(t: Pick<TuyenExpress, "file" | "phuongThuc" | "duong">): string {
  return `${t.file}#${t.phuongThuc} ${t.duong}`;
}

/**
 * Năm nhóm của bản điều tra dân số.
 *
 * ⚠ Bản mô tả nhiệm vụ chỉ khai **bốn** (A/B/C/D). Nhóm **S** được TÁCH RA vì gộp nó vào (C)
 * *"không thuộc tenant"* là một lời khai SAI VỀ THẾ GIỚI: một thủ tục đọc bản ghi kiểm **có** đưa
 * danh tính rời tay vẫn đang trả **dữ liệu tenant** — nó chỉ đã được lọc. Gộp hai thứ ấy làm một
 * thì con số (C) không còn nói được điều gì, và một lượt gỡ bỏ phép lọc sẽ trượt từ S sang A mà
 * tổng (C) không đổi — đúng lớp lỗi "cộng trừ triệt tiêu" mà con số ghim sinh ra để chặn.
 */
export type NhomPhamVi = "A" | "B" | "C" | "D" | "S";

/**
 * ★★★ VỊ TỪ PHÁN QUYẾT — mỗi thủ tục vào **ĐÚNG MỘT** nhóm.
 *
 *  • **D — GHI**: `.mutation`/`.subscription`. Phạm vi ĐỌC không áp dụng (ghi xuyên tenant là một
 *    lớp lỗi KHÁC, được ghi riêng — xem báo cáo).
 *  • **C — KHÔNG THUỘC TENANT**: handler không với tới lượt đọc bảng tenant nào.
 *  • **S — ĐÃ LỌC TẠI ROUTER**: chạm dữ liệu tenant VÀ danh tính rời tay handler.
 *  • **B — ĐÃ LỌC Ở TẦNG DƯỚI**: không đưa danh tính, nhưng hàm nó gọi **tự** phân giải phạm vi.
 *  • **A — RÒ RỈ**: chạm dữ liệu tenant mà danh tính KHÔNG rời tay handler ⇒ không tầng nào lọc
 *    được (xem tiền đề "không có danh tính ngầm" ở đầu file).
 */
export function nhomCua(t: ThuTuc): NhomPhamVi {
  if (t.loai !== "query") return "D";
  if (!t.chamTenant) return "C";
  if (t.danhTinhRoiTay) return "S";
  if (t.tuPhanGiaiPhamVi) return "B";
  return "A";
}

/**
 * Khoá ỔN ĐỊNH của một thủ tục trong bảng kê.
 * ⚠ KHÔNG mang số dòng — dòng trôi ở mỗi lượt sửa, và một bảng kê khoá theo dòng sẽ đỏ vì những
 * lượt sửa chẳng liên quan gì tới phạm vi, rồi người sau sẽ tắt nó đi.
 */
export function khoaCua(t: Pick<ThuTuc, "file" | "duongRouter" | "ten">): string {
  return `${t.file}#${t.duongRouter}.${t.ten}`;
}
