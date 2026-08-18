/**
 * ★★★ G3-A — LƯỚI **LƯỢNG TỪ** CHO CỔNG QUYỀN CỦA SỔ ĐĂNG KÝ TOOL.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI: LỚP LỖI "N+1" ĐÃ TÁI DIỄN **17 LẦN** TRONG REPO NÀY.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Hình dạng luôn giống nhau: một danh sách tên được viết tay ("đã vá 19 tool"), rồi tool thứ 20
 * ra đời và **không ai nhớ**. Lưới theo DANH SÁCH xanh vĩnh viễn vì nó chỉ biết đúng những cái
 * người viết nó đã biết.
 *
 * ⇒ File này **KHÔNG liệt kê tool nào**. Nó duyệt `listTools()` **SỐNG** và phát biểu:
 *
 *     ∀ tool trong sổ đăng ký:  tool CÓ `requiredPermission`
 *                               HOẶC  tool nằm trong tập MIỄN TRỪ khai tên **kèm lý do**,
 *                                     và **tự chứng minh được** mình không đọc được dữ liệu.
 *
 * Thêm một tool mới mà quên gắn quyền ⇒ **ĐỎ ngay lượt chạy đầu**, kèm tên tool.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ BÀI HỌC MANG SANG TỪ `thinkingSurfaces.quantifier.test.ts` — **NEO VÀO THỨ CƯỠNG CHẾ,
 *    ĐỪNG NEO VÀO CHỮ.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ở lưới ấy một đột biến **sống sót** vì vị từ đọc **TÊN ĐỊNH DANH** chứ không đọc **thứ tên ấy
 * trỏ tới**. Ở đây cái bẫy tương đương là: *"tool có ô `requiredPermission` không?"* — một ô khai
 * `{module:"analytics_oee"}` **hoàn toàn có thể là trang trí** nếu handler chẳng bao giờ gọi
 * `checkPermission`, hoặc gọi với **một module KHÁC**. Repo đã có đúng lớp lỗi ấy: 30 read tool có
 * `requiredPermission` **nhưng `__authCtx` không bao giờ tới nơi** ⇒ "đồng hồ không kim".
 *
 * ⇒ §4 dưới đây **không đọc lời khai**. Nó **chặn `checkPermission`** và đọc **cặp (module, action)
 * THẬT SỰ đi tới cổng**, rồi bắt nó **bằng đúng** lời khai. Một handler quên gọi cổng ⇒ mảng ghi
 * nhận rỗng ⇒ ĐỎ. Một handler gọi cổng bằng module khác ⇒ ĐỎ, kèm cả hai giá trị.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { isValidPermissionModule } from "@shared/permissions";

// ── Chặn hai cạnh ngoài TRƯỚC khi sổ đăng ký được nạp (import "./index" có side-effect) ──
const H = vi.hoisted(() => ({
  /** Cổng RBAC trả gì trong lượt chạy hiện tại. */
  choQua: false,
  /** MỌI lượt gọi `checkPermission` thật sự xảy ra: [userId, role, module, action]. */
  goi: [] as Array<[number, string, string, string]>,
}));

vi.mock("../../_core/accessControl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../_core/accessControl")>();
  return {
    ...actual,
    checkPermission: async (userId: number, role: string, moduleName: string, action: string) => {
      H.goi.push([userId, role, moduleName, action]);
      return H.choQua;
    },
  };
});

/**
 * ⚠ CSDL bị **rút** trong cả file: mọi tool có cổng đều phải từ chối **TRƯỚC** khi chạm dữ liệu,
 * nên nhánh ÂM không cần DB; còn nhánh DƯƠNG (§9) chỉ cần chứng minh **cổng đã mở** — `getDb()`
 * trả `null` ⇒ tool trả `DB_UNAVAILABLE`, tức là nó **đã đi qua** cổng. Không truy vấn thật nào
 * chạy ⇒ lưới tất định và không phụ thuộc dữ liệu trong DB test.
 */
vi.mock("../../db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db/connection")>();
  return { ...actual, getDb: async () => null };
});

import "./index";
import { argsWithAuthCtx, assertExecutable, listTools, type Tool } from "./toolRegistry";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TẬP MIỄN TRỪ — khai TÊN kèm LÝ DO. Mỗi dòng phải tự chứng minh được ở §2.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠⚠ Miễn trừ **không phải** "tool này được tha". Nó là: *"tool này KHÔNG THỂ trả dữ liệu, nên
 * không có gì để canh."* §2 kiểm **cấu tạo** chứ không tin dòng chữ: một tool miễn trừ phải
 * `kind === "client"` và **KHÔNG có `handler`**. Ngày nào ai đó gắn `handler` cho `navigate` thì
 * §2 ĐỎ — miễn trừ không thể lặng lẽ biến thành một lỗ.
 */
const MIEN_TRU: ReadonlyMap<string, string> = new Map([
  [
    "navigate",
    "Tool CLIENT: không có `handler`, không chạm CSDL, không trả một byte dữ liệu nào. Nó chỉ phát " +
      "một chỉ thị `navigate` tới MỘT route trong danh sách trắng (`ALLOWED_CLIENT_ROUTES`); trình " +
      "duyệt mở route đó và **chính cổng route/nav của giao diện** (requiredPermission trong " +
      "`client/src/lib/navigation.tsx`) quyết định người dùng thấy gì. Gắn thêm một cổng ở đây là " +
      "dựng CƠ CHẾ THỨ HAI cho một sự thật đã có chủ, và hai cổng sẽ trôi khỏi nhau.",
  ],
  [
    "prefill_form",
    "Tool CLIENT: như `navigate` — không `handler`, không CSDL. Nó chỉ điền sẵn các ô của một biểu " +
      "mẫu trên route danh-sách-trắng bằng giá trị NGƯỜI DÙNG vừa nói; mọi hành vi GHI sau đó vẫn " +
      "phải đi qua write-tool/HITL với cổng quyền riêng của nó.",
  ],
]);

// ── tiện ích ────────────────────────────────────────────────────────────────────────────────────

const MOI_TOOL: Tool<any, any>[] = listTools();
const kindOf = (t: Tool<any, any>) => t.kind ?? "read";
const READ = () => MOI_TOOL.filter((t) => kindOf(t) === "read");
const WRITE = () => MOI_TOOL.filter((t) => kindOf(t) === "write");

/** Schema của tool có khai ô `__authCtx` không (⇔ `argsWithAuthCtx` bơm được danh tính vào). */
function khaiAuthCtx(t: Tool<any, any>): boolean {
  const shape = (t.parameters as unknown as { shape?: Record<string, unknown> })?.shape;
  return !!shape && Object.hasOwn(shape, "__authCtx");
}

const AUTH_THAT = { user: { id: 4242, role: "operator" }, lang: "vi" as const };

const KHONG_CO_DU_LIEU = /không có dữ liệu|chưa có dữ liệu|không tìm thấy dữ liệu|no data|暂无数据/i;
const NOI_VE_QUYEN = /quyền|permission|无权|权限/i;

beforeEach(() => {
  H.goi.length = 0;
  H.choQua = false;
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ G3-A §0 — CẦU CHÌ: sổ đăng ký sống, và không phép lọc nào nuốt cả sổ", () => {
  it("sổ đăng ký không rỗng và ba loại tool đều có người thật", () => {
    expect(MOI_TOOL.length, "sổ đăng ký rỗng — `import ./index` đã hỏng?").toBeGreaterThanOrEqual(70);
    expect(READ().length, "không read tool nào — bộ lọc theo `kind` đã hỏng?").toBeGreaterThanOrEqual(40);
    expect(WRITE().length, "không write tool nào — bộ lọc theo `kind` đã hỏng?").toBeGreaterThanOrEqual(20);
    // Tên là DUY NHẤT — nếu không, `Map` của sổ đã nuốt mất một tool và mọi ∀ dưới đây đếm thiếu.
    expect(new Set(MOI_TOOL.map((t) => t.name)).size).toBe(MOI_TOOL.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ G3-A §1 — LUẬT CHÍNH (∀): mọi tool đứng sau MỘT cổng quyền, hoặc được MIỄN TRỪ có tên", () => {
  it("★★★ ∀ tool: có `requiredPermission` HOẶC nằm trong tập MIỄN TRỪ", () => {
    const vipham = MOI_TOOL.filter((t) => !t.requiredPermission && !MIEN_TRU.has(t.name)).map(
      (t) => `${t.name} (kind=${kindOf(t)})`,
    );
    expect(
      vipham.join("\n"),
      "TOOL KHÔNG CÓ CỔNG QUYỀN. Mọi tool đọc dữ liệu phải khai `requiredPermission` bằng ĐÚNG bộ " +
        "quyền mà màn hình tương ứng đang dùng (xem `client/src/lib/navigation.tsx` + " +
        "`shared/permissions.ts`) và phải CƯỠNG CHẾ nó trong handler qua `rbacGate`. Nếu tool thật " +
        "sự không đọc được dữ liệu, thêm nó vào `MIEN_TRU` KÈM LÝ DO — và §2 sẽ bắt lý do ấy phải đúng.",
    ).toBe("");
  });

  it("★★ CẢ HAI VẾ đều có người dùng thật (không vế nào là chân lý rỗng)", () => {
    expect(MOI_TOOL.filter((t) => !!t.requiredPermission).length).toBeGreaterThanOrEqual(70);
    expect(MIEN_TRU.size, "tập miễn trừ rỗng ⇒ vế thứ hai là trang trí").toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ G3-A §2 — MIỄN TRỪ PHẢI TỰ CHỨNG MINH (theo CẤU TẠO, không theo dòng chữ)", () => {
  it("★★★ mỗi tên miễn trừ: còn tồn tại · là tool CLIENT · KHÔNG có `handler` · có `buildClientAction`", () => {
    for (const [ten, lyDo] of MIEN_TRU) {
      const t = MOI_TOOL.find((x) => x.name === ten);
      expect(t, `"${ten}" nằm trong MIEN_TRU nhưng KHÔNG còn trong sổ đăng ký — miễn trừ chết phải bị xoá`).toBeTruthy();
      expect(kindOf(t!), `"${ten}": miễn trừ chỉ dành cho tool CLIENT`).toBe("client");
      expect(
        typeof t!.handler,
        `"${ten}": miễn trừ dựa trên "tool này KHÔNG trả được dữ liệu" — nay nó CÓ \`handler\` ⇒ lý do đã sai`,
      ).not.toBe("function");
      expect(typeof t!.buildClientAction, `"${ten}": tool client phải có \`buildClientAction\``).toBe("function");
      expect(lyDo.length, `"${ten}": lý do miễn trừ phải viết ra, không để trống`).toBeGreaterThan(40);
    }
  });

  it("★★ miễn trừ KHÔNG được nới ra ngoài loại 'client': mọi tool client đều phải có mặt trong bảng", () => {
    const clientThieu = MOI_TOOL.filter((t) => kindOf(t) === "client" && !MIEN_TRU.has(t.name) && !t.requiredPermission);
    expect(clientThieu.map((t) => t.name).join(", ")).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ G3-A §3 — MODULE KHAI RA PHẢI LÀ MODULE THẬT CỦA HỆ RBAC", () => {
  it("★★★ ∀ tool có cổng: `module` hợp lệ (sau khi áp alias) và `action` nằm trong 5 bit của bảng `permissions`", () => {
    const BIT = new Set(["canView", "canCreate", "canEdit", "canDelete", "canExport"]);
    const xau = MOI_TOOL.filter((t) => !!t.requiredPermission)
      .filter((t) => !isValidPermissionModule(t.requiredPermission!.module) || !BIT.has(t.requiredPermission!.action))
      .map((t) => `${t.name} → ${t.requiredPermission!.module}/${t.requiredPermission!.action}`);
    expect(
      xau.join("\n"),
      "module/action không tồn tại trong hệ RBAC ⇒ `checkPermission` không bao giờ tìm thấy hàng " +
        "quyền nào ⇒ MỌI người không-admin bị từ chối vĩnh viễn (một 'permission ma'). Dùng tên có " +
        "trong `PERMISSION_MODULES` hoặc khai alias.",
    ).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ G3-A §4 — CƯỠNG CHẾ THẬT: đọc cặp (module, action) ĐI TỚI CỔNG, không đọc lời khai", () => {
  it("★★★ ∀ read tool có cổng: schema PHẢI khai `__authCtx` (nếu không, cổng là ĐỒNG HỒ KHÔNG KIM)", () => {
    /**
     * `argsWithAuthCtx` **chỉ** gán danh tính phiên khi `tool.parameters.shape` có ô `__authCtx`
     * (mọi schema đều `.strict()` ⇒ nhét khoá lạ sẽ vỡ). Tool khai `requiredPermission` mà **không**
     * khai ô ấy thì danh tính THẬT không bao giờ tới nơi ⇒ hoặc nó fail-safe từ chối **tất cả**
     * (mã chết), hoặc nó **không cưỡng chế gì** (lỗ). Cả hai đều là hỏng.
     */
    const thieu = READ().filter((t) => !!t.requiredPermission && !khaiAuthCtx(t)).map((t) => t.name);
    expect(thieu.join(", "), "read tool khai quyền nhưng schema KHÔNG có ô `__authCtx`").toBe("");
  });

  it("★★★ ∀ read tool có cổng: cặp tới `checkPermission` PHẢI BẰNG ĐÚNG cặp đã khai", async () => {
    const xau: string[] = [];
    for (const t of READ()) {
      if (!t.requiredPermission) continue;
      H.goi.length = 0;
      H.choQua = false;
      const args = argsWithAuthCtx(t, {}, AUTH_THAT as any);
      let ket: any = null;
      try {
        ket = await t.handler!(args as any);
      } catch (e) {
        xau.push(`${t.name}: handler NÉM (${(e as Error).message?.slice(0, 80)}) thay vì trả kết quả TỪ CHỐI`);
        continue;
      }
      if (H.goi.length === 0) {
        xau.push(`${t.name}: KHÔNG gọi \`checkPermission\` lần nào ⇒ \`requiredPermission\` chỉ là TRANG TRÍ`);
        continue;
      }
      const [uid, role, mod, act] = H.goi[0]!;
      const khai = `${t.requiredPermission.module}/${t.requiredPermission.action}`;
      const that = `${mod}/${act}`;
      if (that !== khai) xau.push(`${t.name}: KHAI ${khai} nhưng CƯỠNG CHẾ ${that}`);
      if (uid !== AUTH_THAT.user.id || role !== AUTH_THAT.user.role) {
        xau.push(`${t.name}: danh tính tới cổng là [${uid}, ${role}] — không phải danh tính PHIÊN`);
      }
      if (ket?.note !== "PERMISSION_DENIED") {
        xau.push(`${t.name}: cổng trả FALSE mà tool vẫn trả note=${ket?.note ?? "(none)"} ⇒ không fail-safe`);
      }
    }
    expect(xau.join("\n")).toBe("");
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ G3-A §5 — FAIL-SAFE: THIẾU `__authCtx` ⇒ TỪ CHỐI (không phải 'cứ chạy đi')", () => {
  it("★★★ ∀ read tool có cổng: gọi handler KHÔNG kèm danh tính ⇒ TỪ CHỐI, và cổng KHÔNG được hỏi", async () => {
    const xau: string[] = [];
    for (const t of READ()) {
      if (!t.requiredPermission) continue;
      H.goi.length = 0;
      H.choQua = true; // ⚠ cổng mở TOANG — nếu tool vẫn từ chối thì đó là do THIẾU danh tính, đúng ý.
      let ket: any = null;
      try {
        ket = await t.handler!({} as any);
      } catch (e) {
        xau.push(`${t.name}: handler NÉM (${(e as Error).message?.slice(0, 80)})`);
        continue;
      }
      if (ket?.note !== "PERMISSION_DENIED") {
        xau.push(`${t.name}: thiếu \`__authCtx\` mà vẫn trả note=${ket?.note ?? "(none)"} ⇒ FAIL-OPEN`);
      }
      if (H.goi.length > 0) {
        xau.push(`${t.name}: hỏi \`checkPermission\` bằng một danh tính KHÔNG TỒN TẠI (${JSON.stringify(H.goi[0])})`);
      }
    }
    expect(xau.join("\n")).toBe("");
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ G3-A §6 — DANH TÍNH DO MODEL BỊA KHÔNG BAO GIỜ ĐƯỢC DÙNG", () => {
  it("★★★ ∀ read tool có cổng: `__authCtx` bịa trong args bị XOÁ, và tool TỪ CHỐI", async () => {
    const BIA = { userId: 1, role: "admin" };
    const xau: string[] = [];
    for (const t of READ()) {
      if (!t.requiredPermission) continue;
      H.goi.length = 0;
      H.choQua = true; // cổng mở TOANG: nếu danh tính bịa lọt qua thì tool sẽ TRẢ DỮ LIỆU ⇒ ĐỎ.
      // Không `execCtx` (đúng như đường Agent khi phiên chưa được nối) — args do model sản xuất.
      const args = argsWithAuthCtx(t, { __authCtx: BIA }, undefined);
      if (Object.hasOwn(args as object, "__authCtx")) {
        xau.push(`${t.name}: \`argsWithAuthCtx\` GIỮ LẠI \`__authCtx\` bịa`);
        continue;
      }
      let ket: any = null;
      try {
        ket = await t.handler!(args as any);
      } catch (e) {
        xau.push(`${t.name}: handler NÉM (${(e as Error).message?.slice(0, 80)})`);
        continue;
      }
      if (ket?.note !== "PERMISSION_DENIED") xau.push(`${t.name}: danh tính BỊA lọt qua (note=${ket?.note ?? "(none)"})`);
      if (H.goi.some(([u, r]) => u === BIA.userId && r === BIA.role)) {
        xau.push(`${t.name}: danh tính BỊA đi tới \`checkPermission\``);
      }
    }
    expect(xau.join("\n")).toBe("");
  }, 120_000);

  it("★★ …và khi CÓ phiên thật, `__authCtx` bịa bị THAY, không phải được cộng thêm", () => {
    const xau: string[] = [];
    for (const t of READ()) {
      if (!t.requiredPermission) continue;
      const args: any = argsWithAuthCtx(t, { __authCtx: { userId: 1, role: "admin" } }, AUTH_THAT as any);
      if (args.__authCtx?.userId !== AUTH_THAT.user.id || args.__authCtx?.role !== AUTH_THAT.user.role) {
        xau.push(`${t.name}: ${JSON.stringify(args.__authCtx)}`);
      }
    }
    expect(xau.join("\n")).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ G3-A §7 — TỪ CHỐI PHẢI TRUNG THỰC (không giả vờ 'không có dữ liệu')", () => {
  it("★★★ ∀ read tool có cổng: câu từ chối NÓI VỀ QUYỀN và KHÔNG nói 'không có dữ liệu'", async () => {
    const xau: string[] = [];
    for (const t of READ()) {
      if (!t.requiredPermission) continue;
      H.choQua = false;
      const ket: any = await t.handler!(argsWithAuthCtx(t, {}, AUTH_THAT as any) as any).catch(() => null);
      const s = String(ket?.textSummary ?? "");
      if (!NOI_VE_QUYEN.test(s)) xau.push(`${t.name}: câu từ chối KHÔNG nhắc tới quyền — ${JSON.stringify(s.slice(0, 90))}`);
      if (KHONG_CO_DU_LIEU.test(s)) {
        xau.push(
          `${t.name}: câu từ chối GIẢ VỜ KHÔNG CÓ DỮ LIỆU — dạy người dùng rằng hệ thống hỏng ` +
            `thay vì rằng họ thiếu quyền — ${JSON.stringify(s.slice(0, 90))}`,
        );
      }
    }
    expect(xau.join("\n")).toBe("");
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ G3-A §8 — TOOL GHI KHÔNG ĐƯỢC GÁC BẰNG QUYỀN XEM", () => {
  /**
   * ⚠⚠ Đây là **dạng lượng từ** của lỗi đã tìm thấy ở `run_rca_analysis` (`machine_monitoring/
   * canView`) và `request_threshold_review` (`settings_alerts/canView`): hai hành vi **INSERT** đứng
   * sau một bit **XEM**. `canView` là bit mà **gần như mọi vai** đều có ⇒ gác một lệnh ghi bằng nó
   * là **không gác gì cả**. Luật này bắt lớp lỗi ấy cho **mọi** write tool, hôm nay và mai sau.
   */
  it("★★★ ∀ write tool: `action` ∈ {canCreate, canEdit, canDelete} — KHÔNG BAO GIỜ là canView/canExport", () => {
    const BIT_GHI = new Set(["canCreate", "canEdit", "canDelete"]);
    const xau = WRITE()
      .filter((t) => !t.requiredPermission || !BIT_GHI.has(t.requiredPermission.action))
      .map((t) => `${t.name} → ${t.requiredPermission?.module}/${t.requiredPermission?.action}`);
    expect(
      xau.join("\n"),
      "WRITE-TOOL ĐANG ĐỨNG SAU MỘT BIT ĐỌC. `canView` là bit mọi vai đều có ⇒ nó không chặn ai. " +
        "Chọn bit theo HÀNH VI: tạo bản ghi ⇒ canCreate · sửa ⇒ canEdit · phá huỷ ⇒ canDelete.",
    ).toBe("");
  });

  it("★★ ∀ write tool: nối đủ (preview + execute + summarize + requiredPermission)", () => {
    for (const t of WRITE()) expect(() => assertExecutable(t), t.name).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ G3-A §9 — CHIỀU DƯƠNG: người có quyền HỢP LỆ vẫn nhận được dữ liệu", () => {
  it("★★★ ∀ read tool có cổng: cổng trả TRUE ⇒ tool KHÔNG BAO GIỜ trả PERMISSION_DENIED", async () => {
    /**
     * ⚠ Không khẳng định "có dữ liệu" — `getDb()` bị rút trong file này nên phần lớn tool trả
     * `DB_UNAVAILABLE`. Đó chính là bằng chứng cần: tool đã **đi qua** cổng và tới được đường dữ
     * liệu. Một handler NÉM ở đây cũng được chấp nhận (thiếu tham số bắt buộc) — cái DUY NHẤT bị
     * cấm là **từ chối vì quyền** khi quyền đã được cấp. Đây là lưới chống "vá an ninh bằng cách
     * chặn tất cả mọi người".
     */
    const xau: string[] = [];
    let quaCong = 0;
    for (const t of READ()) {
      if (!t.requiredPermission) continue;
      H.choQua = true;
      let ket: any = null;
      try {
        ket = await t.handler!(argsWithAuthCtx(t, {}, AUTH_THAT as any) as any);
      } catch {
        quaCong++; // ném vì thiếu tham số ⇒ vẫn là "đã qua cổng"
        continue;
      }
      if (ket?.note === "PERMISSION_DENIED") xau.push(`${t.name}: cổng TRẢ TRUE mà tool vẫn từ chối vì quyền`);
      else quaCong++;
    }
    expect(xau.join("\n")).toBe("");
    expect(quaCong, "không tool nào qua được cổng ⇒ ca này là chân lý rỗng").toBeGreaterThanOrEqual(40);
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ G3-A §10 — CHỐNG LÁCH: hai tool trả lời CÙNG MỘT CÂU phải đứng sau CÙNG MỘT bit", () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * ⚠⚠⚠ MỤC NÀY LÀ MỘT **DANH SÁCH**, VÀ ĐÓ LÀ HÌNH DẠNG ĐÚNG — ĐÂY LÀ LÝ DO.
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * §1–§9 đều là lượng từ vì thứ chúng canh **suy ra được từ cấu tạo**. Mục này canh một thứ
   * **KHÔNG suy ra được**: *"hai tool này trả lời cùng một câu hỏi của người dùng"* là một phán
   * đoán về **NGHĨA**, không có vị từ nào đọc ra từ mã.
   *
   * ⚠ ĐO ĐƯỢC, KHÔNG SUY ĐOÁN — **đột biến M10 SỐNG SÓT**: đổi **CẢ** lời khai **LẪN** phép cưỡng
   * chế của `get_oee` từ `analytics_oee` sang `dashboard_view` ⇒ **15/15 ca §0–§9 VẪN XANH**. Đúng
   * như thiết kế: §4 canh *"khai == cưỡng chế"*, §3 canh *"module có thật"* — **không mục nào**
   * canh *"module ĐÚNG"*. M10 vì thế là **đột biến tương đương** đối với luật §1–§9, không phải
   * bằng chứng lưới hỏng. Nhưng hậu quả của nó thì có thật: `get_oee` đứng sau `dashboard_view`
   * (bit **operator có**) trong khi `analytics_query_oee` đứng sau `analytics_oee` (bit operator
   * **không** có) ⇒ ai bị chặn ở tool này chỉ cần **hỏi tool kia**. Cửa sau nằm **bên trong chính
   * trợ lý**.
   *
   * ⇒ Thay vì nới §4 thành một **bảng tên-tool ↔ module kỳ vọng** (đó đúng là danh sách N+1 mà cả
   * file này tồn tại để tránh), ta **ghim đúng bất biến đã lý luận ra**: các cặp dưới đây trả cùng
   * một loại câu trả lời, nên bit của chúng phải **BẰNG NHAU sau khi áp alias**. Bảng chỉ cần dài
   * thêm khi ai đó **phát hiện** một cặp tương đương mới; và nó **không thể mục nát trong im lặng**
   * vì mỗi dòng bị kiểm là hai tool ấy **còn tồn tại**.
   *
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * ⚠⚠⚠ 2026-08-17 — CHỦ DỰ ÁN CHỐT "ĐỒNG BỘ VỀ `dashboard_view`". ĐO XONG: **KHÔNG cặp nào
   *     dưới đây đủ điều kiện.** Cả hai bị GIỮ NGUYÊN, có lý do đo được. ĐỌC TRƯỚC KHI SỬA.
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * Quyết định kèm điều kiện tường minh: *chỉ đồng bộ cặp THẬT SỰ trả cùng tập dữ liệu; nếu tool
   * `analytics_*` trả NHIỀU HƠN (thêm chiều nhà máy / lịch sử dài hơn) thì nó KHÔNG cùng tập.*
   * Phép đo (đọc thẳng zod schema + helper truy vấn của từng tool):
   *
   *   ① `get_top_defects` (`dashboard_view`) ↔ `analytics_defect_heatmap_summary`
   *      (`analytics_defect_heatmap`) — **KHÔNG cùng tập.**
   *        · cửa sổ lịch sử: 1..30 ngày  vs  **1..90 ngày**  (dài gấp 3)
   *        · độ sâu danh sách: limit 1..20  vs  topN 1..30
   *        · lát cắt: KHÔNG có  vs  **`machineId` + `productModelId`**
   *      ⇒ đồng bộ về `dashboard_view` sẽ cấp cho operator/maintenance/engineer/viewer/user
   *      một bề mặt **rộng hơn hẳn** con số 7-ngày mà `/dashboard` đang bày cho họ. Đúng vào
   *      mệnh đề loại trừ "lịch sử dài hơn" ⇒ GIỮ NGUYÊN.
   *
   *   ② trục SPC: `get_device_health` (`machine_status`) ↔ `analytics_spc_status`
   *      (`analytics_spc`) — **KHÔNG cùng tập, và chạm mệnh đề DỪNG.**
   *        · nguồn: `process_results.metrics[key]` I-MR của **MỘT máy** (`machineCode` BẮT BUỘC)
   *          vs `getYieldTrendData` trên **chuỗi yield của cả cụm** (`machineId` **tuỳ chọn** —
   *          bỏ trống ⇒ toàn nhà máy)
   *        · **`factoryCode`** — `analytics_spc_status` cắt theo NHÀ MÁY; `get_device_health`
   *          không có chiều ấy. Đây là "dữ liệu nhiều nhà máy" ⇒ mệnh đề DỪNG-VÀ-BÁO-CÁO.
   *        · cửa sổ: 1..30 ngày vs 1..90 ngày; thêm tham số `sigma` 1..4.
   *      ⇒ GIỮ NGUYÊN, đã báo cáo lên chủ dự án.
   *
   * ⚠ Nền của phép đo: `dashboard_view` được seed cho **CẢ 8 vai**; `analytics_defect_heatmap`
   * chỉ admin/supervisor/quality_inspector; `analytics_spc` thêm engineer. Nên "đồng bộ về
   * `dashboard_view`" luôn là hướng **NỚI LỎNG**, không bao giờ là hướng siết.
   */
  const CAP_TUONG_DUONG: ReadonlyArray<readonly [string, string, string]> = [
    ["get_oee", "analytics_query_oee", "Cùng trả lời 'OEE của máy/kỳ' — một cái lỏng hơn là cửa sau của cái kia."],
    ["get_line_balance", "analyze_line_bottleneck", "Cùng đọc chuỗi cân bằng chuyền (`getLineBalanceSeries`/`getLatestLineBalance`)."],
    ["get_device_health", "get_machine_health", "Cùng trả lời 'máy này có ổn không' (F7 vs P2bc) — phải bằng nhau SAU khi áp alias."],
  ];

  it("★★★ mỗi cặp: cả hai tool còn tồn tại, đều có cổng, và bit BẰNG NHAU sau khi áp alias", async () => {
    const { resolvePermissionModule } = await import("@shared/permissions");
    for (const [a, b, lyDo] of CAP_TUONG_DUONG) {
      const ta = MOI_TOOL.find((t) => t.name === a);
      const tb = MOI_TOOL.find((t) => t.name === b);
      expect(ta, `"${a}" không còn trong sổ — cập nhật bảng CAP_TUONG_DUONG`).toBeTruthy();
      expect(tb, `"${b}" không còn trong sổ — cập nhật bảng CAP_TUONG_DUONG`).toBeTruthy();
      const pa = ta!.requiredPermission!;
      const pb = tb!.requiredPermission!;
      expect(
        `${resolvePermissionModule(pa.module)}/${pa.action}`,
        `LÁCH ĐƯỢC: ${a} và ${b} — ${lyDo}\n  ${a} → ${pa.module}/${pa.action}\n  ${b} → ${pb.module}/${pb.action}`,
      ).toBe(`${resolvePermissionModule(pb.module)}/${pb.action}`);
    }
  });

  /**
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * §10b — CẶP **CỐ Ý KHÁC BIT**: ghim trạng thái đã ĐO, để "giữ nguyên" không thể bị hiểu nhầm
   *        thành "chưa ai nhìn tới".
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * Đây là mặt còn lại của cùng một đồng xu với `CAP_TUONG_DUONG` ở trên. Bảng trên chống việc
   * **tách** hai tool tương đương ra hai bit (mở cửa sau). Bảng dưới chống việc **gộp** lén hai
   * tool KHÔNG tương đương về một bit (nới quyền trong im lặng) — chính là hướng mà quyết định
   * 2026-08-17 đề xuất và phép đo ở trên đã bác bỏ cho cả hai cặp.
   *
   * ⚠ Ghim này KHÔNG nói "mãi mãi không được đồng bộ". Nó nói: **đồng bộ phải là một hành động
   * CÓ Ý THỨC** — ai gộp thì phải sửa cả bảng này và đối diện với lý do đã đo. Đó đúng là thứ
   * đã KHÔNG xảy ra trong 17 lần lặp của lớp lỗi "N+1".
   */
  const CAP_CO_Y_KHAC_BIT: ReadonlyArray<
    readonly [string, string, string, string, string]
  > = [
    [
      "get_top_defects", "dashboard_view",
      "analytics_defect_heatmap_summary", "analytics_defect_heatmap",
      "Đo 2026-08-17: heatmap có cửa sổ 1..90 ngày (vs 30), topN 30 (vs 20), thêm lát cắt " +
        "machineId + productModelId ⇒ TẬP LỚN HƠN, không phải cùng tập.",
    ],
    [
      "get_device_health", "machine_status",
      "analytics_spc_status", "analytics_spc",
      "Đo 2026-08-17: get_device_health là I-MR của MỘT máy trên process_results; " +
        "analytics_spc_status là SPC trên chuỗi yield, machineId TUỲ CHỌN và có factoryCode " +
        "⇒ dữ liệu NHIỀU NHÀ MÁY. Khác nguồn, khác phạm vi.",
    ],
  ];

  it("★★★ cặp CỐ Ý KHÁC BIT: vẫn còn tồn tại, và bit vẫn ĐÚNG như lúc đo (gộp lén ⇒ ĐỎ)", async () => {
    const { resolvePermissionModule } = await import("@shared/permissions");
    for (const [a, modA, b, modB, lyDo] of CAP_CO_Y_KHAC_BIT) {
      const ta = MOI_TOOL.find((t) => t.name === a);
      const tb = MOI_TOOL.find((t) => t.name === b);
      expect(ta, `"${a}" không còn trong sổ — cập nhật bảng CAP_CO_Y_KHAC_BIT`).toBeTruthy();
      expect(tb, `"${b}" không còn trong sổ — cập nhật bảng CAP_CO_Y_KHAC_BIT`).toBeTruthy();
      const pa = resolvePermissionModule(ta!.requiredPermission!.module);
      const pb = resolvePermissionModule(tb!.requiredPermission!.module);
      expect(pa, `"${a}" đã đổi bit — nếu là quyết định RBAC mới, sửa bảng này CÓ Ý THỨC.\n${lyDo}`).toBe(
        resolvePermissionModule(modA),
      );
      expect(pb, `"${b}" đã đổi bit — nếu là quyết định RBAC mới, sửa bảng này CÓ Ý THỨC.\n${lyDo}`).toBe(
        resolvePermissionModule(modB),
      );
      // …và hai bit ấy phải THẬT SỰ khác nhau, nếu không thì cặp này đã bị GỘP lén.
      expect(pa, `GỘP LÉN: ${a} và ${b} nay cùng bit "${pa}". ${lyDo}`).not.toBe(pb);
    }
  });

  it("★★ cả hai bảng đều có người thật (không bảng nào là chân lý rỗng)", () => {
    expect(CAP_TUONG_DUONG.length).toBeGreaterThanOrEqual(3);
    expect(CAP_CO_Y_KHAC_BIT.length).toBeGreaterThanOrEqual(2);
    // Một tên không được vừa nằm ở "phải bằng nhau" vừa ở "phải khác nhau" cùng một bạn nhảy.
    const key = (x: string, y: string) => [x, y].sort().join("↔");
    const bang = new Set(CAP_TUONG_DUONG.map(([a, b]) => key(a, b)));
    for (const [a, , b] of CAP_CO_Y_KHAC_BIT) {
      expect(bang.has(key(a, b)), `cặp ${a}↔${b} nằm ở CẢ HAI bảng — luật tự mâu thuẫn`).toBe(false);
    }
  });
});
