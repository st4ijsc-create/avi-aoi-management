/**
 * ★★★ Pha 4 Task 4 (re-review, N-1) — **`__authCtx` ĐẾN TỪ ĐẦU VÀO KHÔNG BAO GIỜ LÀ DANH TÍNH.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI: MỘT LƯỚI ĐÃ XANH VÌ **LÝ DO SAI** (lần thứ MƯỜI HAI)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ca vòng trước — *"không `execCtx` ⇒ TỪ CHỐI"* — xanh **vì `args` RỖNG**, không phải vì có phòng
 * thủ nào. Nhánh `if (!execCtx) return args` **trả lại NGUYÊN VĂN** một `__authCtx` bịa, và người
 * review đo được `checkPermission([999, "superadmin", …])` với **tool CHẠY**.
 *
 * ⚠ ĐƯỜNG VÀO THẬT (không phải giả định): `classifyToolIntentLLM()` → `tool.parameters.safeParse()`.
 * `__authCtx` là ô **ĐÃ KHAI** trong schema nên `safeParse` **GIỮ NGUYÊN** nó ⇒ args do một model
 * sinh ra mang được `__authCtx`. File này thay bộ phân loại bằng một seam trả **đúng hình dạng đó**
 * — tức mô phỏng **người sản xuất args KHÔNG TIN ĐƯỢC**, không phải mô phỏng lỗi.
 *
 * ⚠⚠ MỌI CA Ở ĐÂY ĐI QUA `tryExecuteTool()` THẬT (đường Agent), và đọc **ĐỐI SỐ THẬT** mà
 * `checkPermission` nhận — không đọc mã, không đọc cờ.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const checkPermissionMock = vi.fn();
vi.mock("../../_core/accessControl", () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
}));

/**
 * Seam **NGƯỜI SẢN XUẤT ARGS**: đứng đúng chỗ `classifyToolIntent`/`classifyToolIntentLLM` đứng.
 * ⚠ KHÔNG giả `toolRegistry`, KHÔNG giả tool, KHÔNG giả `argsWithAuthCtx` — thứ đang được kiểm là
 * đường đi của `tryExecuteTool()`, nên mọi mắt xích sau bộ phân loại phải là hàng THẬT.
 */
const classifier = vi.hoisted(() => ({
  args: {} as Record<string, unknown>,
}));
vi.mock("./intentClassifier", async (importOriginal) => {
  const that = await importOriginal<typeof import("./intentClassifier")>();
  return {
    ...that,
    classifyToolIntent: () => ({ tool: "get_vram_state", args: classifier.args, reason: "TEST_SEAM" }),
    classifyToolIntentLLM: async () => ({ tool: "get_vram_state", args: classifier.args, reason: "TEST_SEAM_LLM" }),
  };
});

import "./vramTools";
import { tryExecuteTool } from "./index";
import * as broker from "./../vram/vramBroker";

/** Danh tính BỊA — thứ một model (hoặc một payload) có thể nhét vào args. */
const BIA = { userId: 999, role: "superadmin" };
/** Danh tính PHIÊN — thứ máy chủ tự đọc, nguồn DUY NHẤT hợp lệ. */
const PHIEN = { user: { id: 7, role: "admin", name: "Tester" }, lang: "vi" as const };

beforeEach(() => {
  checkPermissionMock.mockReset();
  checkPermissionMock.mockResolvedValue(true);
  classifier.args = {};
  broker.__resetBrokerForTests();
});

describe("★★★ N-1 — `__authCtx` BỊA trong args KHÔNG BAO GIỜ trở thành danh tính", () => {
  it("★★★ KHÔNG có `execCtx` + args mang `__authCtx` BỊA ⇒ tool TỪ CHỐI, và `checkPermission` KHÔNG ĐƯỢC GỌI", async () => {
    /**
     * ⚠⚠ ĐÂY LÀ CA MÀ BẢN TRƯỚC KHÔNG CÓ. Ca cũ truyền `args = {}` nên nó xanh dù nhánh
     * `if (!execCtx) return args` **trả lại nguyên văn** mọi thứ. Nay args mang danh tính bịa.
     */
    classifier.args = { __authCtx: BIA };

    const r = await tryExecuteTool("còn bao nhiêu vram", undefined, undefined);

    expect(r.result, "tool vẫn phải chạy tới nơi, không nuốt lỗi").not.toBeNull();
    expect(r.result!.note, "không danh tính phiên ⇒ TỪ CHỐI").toBe("PERMISSION_DENIED");
    expect((r.result!.data as { state: unknown }).state).toBeNull();
    // Bằng chứng MẠNH nhất: cổng RBAC **không hề được hỏi** bằng danh tính bịa.
    expect(checkPermissionMock, "một lượt gọi với [999,'superadmin'] là LEO THANG QUYỀN").not.toHaveBeenCalled();
  });

  it("★★★ CÓ `execCtx` + args mang `__authCtx` BỊA ⇒ `checkPermission` nhận danh tính PHIÊN, không phải bịa", async () => {
    classifier.args = { __authCtx: BIA };

    await tryExecuteTool("còn bao nhiêu vram", undefined, PHIEN);

    const goi = checkPermissionMock.mock.calls.at(-1)!;
    expect(goi[0], "userId phải của PHIÊN").toBe(7);
    expect(goi[1], "role phải của PHIÊN").toBe("admin");
    expect(checkPermissionMock.mock.calls.some((c) => c[0] === 999 || c[1] === "superadmin")).toBe(false);
  });

  /**
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ★★★ N-4 (re-review vòng 2) — **DÒNG CHẶN NON-OBJECT TỪNG LÀ MỘT LỖ DANH TÍNH.**
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * Trong JS một **MẢNG** là `typeof "object"` nhưng bị `Array.isArray()` loại ⇒ dòng chặn đầu hàm
   * (`return args`) trả nó **NGUYÊN VĂN**, kèm mọi thuộc tính gắn trên nó. Người review đo được
   * `checkPermission(999, "superadmin", …)` với **tool CHẠY**.
   * ⚠ Chính docstring của `argsWithAuthCtx` đã cảnh báo *"một `return args` chen vào TRƯỚC bước (1)
   * là mở lại lỗ này"* — rồi **dòng đầu hàm đúng là như thế**. Một lời cảnh báo không tự thi hành;
   * ba ca dưới đây thi hành nó.
   */
  it("★★★ N-4 — MẢNG mang `__authCtx`, KHÔNG `execCtx` ⇒ `checkPermission` KHÔNG ĐƯỢC GỌI", async () => {
    const mang: unknown[] & { __authCtx?: unknown } = ["mot-doi-so"];
    mang.__authCtx = BIA;
    classifier.args = mang as unknown as Record<string, unknown>;

    const r = await tryExecuteTool("còn bao nhiêu vram", undefined, undefined);

    expect(r.result!.note).toBe("PERMISSION_DENIED");
    expect((r.result!.data as { state: unknown }).state).toBeNull();
    expect(checkPermissionMock, "một MẢNG cũng không được chở danh tính qua").not.toHaveBeenCalled();
  });

  it("★★★ N-4 — MẢNG mang `__authCtx` + CÓ `execCtx` ⇒ VẪN từ chối, và danh tính bịa KHÔNG tới cổng", async () => {
    /**
     * ⚠ Bất biến ở đây là **CHIỀU CHẶT**, và nó mạnh hơn *"phiên thắng bịa"*: một túi tham số MÉO
     * (`args` không phải object) **không mang được gì qua**, và cũng **không được nhận** danh tính
     * phiên — nó thành `{}`. Hợp lý: không schema `z.object().strict()` nào nhận một mảng, nên lượt
     * đó hỏng ở đâu cũng hỏng; thà từ chối sạch còn hơn chạy tiếp với một túi nửa vời.
     * ⚠ Kỳ vọng ĐẦU của tôi ở ca này SAI (tưởng nó sẽ chạy với danh tính phiên) — mã đúng, ca sai;
     * ghi lại để người sau không "sửa" mã theo kỳ vọng ấy.
     */
    const mang: unknown[] & { __authCtx?: unknown } = [];
    mang.__authCtx = BIA;
    classifier.args = mang as unknown as Record<string, unknown>;

    const r = await tryExecuteTool("còn bao nhiêu vram", undefined, PHIEN);

    expect(r.result!.note).toBe("PERMISSION_DENIED");
    expect(
      checkPermissionMock.mock.calls.some((c) => c[0] === 999 || c[1] === "superadmin"),
      "danh tính BỊA tuyệt đối không được chạm cổng RBAC",
    ).toBe(false);
  });

  it("★★ args là CHUỖI/`null`/số cũng thành túi RỖNG ⇒ từ chối sạch — chiều CHẶT", async () => {
    for (const bay of ["mot-chuoi", null, 42]) {
      checkPermissionMock.mockClear();
      classifier.args = bay as unknown as Record<string, unknown>;
      const r = await tryExecuteTool("còn bao nhiêu vram", undefined, undefined);
      expect(r.result!.note, `đầu vào ${String(bay)}`).toBe("PERMISSION_DENIED");
      expect(checkPermissionMock).not.toHaveBeenCalled();
    }
  });

  it("★★ args bịa KHÔNG rò xuống handler: tool chạy được ⇒ trạng thái THẬT (không phải TỪ CHỐI vì args bẩn)", async () => {
    classifier.args = { __authCtx: BIA };
    const r = await tryExecuteTool("còn bao nhiêu vram", undefined, PHIEN);
    expect(r.result!.note).not.toBe("PERMISSION_DENIED");
    expect((r.result!.data as { state: unknown }).state).not.toBeNull();
  });

  it("★ đường LLM fallback (bộ phân loại heuristic bỏ cuộc) cũng đi qua cùng phép làm sạch", async () => {
    /**
     * `classifyToolIntentLLM` là **người sản xuất args không tin được** trong mã thật. Ca này ép
     * đúng nhánh đó (heuristic trả `tool: null`), rồi khẳng định cùng bất biến.
     */
    classifier.args = { __authCtx: BIA };
    const mod = await import("./intentClassifier");
    const spy = vi.spyOn(mod, "classifyToolIntent").mockReturnValue({
      tool: null,
      args: {},
      reason: "TEST_NO_HEURISTIC",
    } as never);
    try {
      await tryExecuteTool("câu hỏi mơ hồ", undefined, PHIEN);
      const goi = checkPermissionMock.mock.calls.at(-1)!;
      expect(goi[0]).toBe(7);
      expect(goi[1]).toBe("admin");
    } finally {
      spy.mockRestore();
    }
  });

  it("★ tool KHÔNG khai `__authCtx` trong schema: args vẫn bị làm sạch, và không bị nhét khoá lạ", async () => {
    /**
     * ⚠⚠ ĐÍNH CHÍNH (G3-A): bản trước dùng **`get_today_stats`** làm ví dụ cho *"tool không khai
     * `__authCtx`"*. Tiền đề ấy **nay SAI** — G3-A đã gắn cổng quyền cho cả chín tool của
     * `handlers.ts`, nên chúng đều khai ô đó. Đây đúng là hình dạng *"ca xanh nhờ một sự thật về
     * MỘT TOOL CỤ THỂ, không nhờ bất biến"*: bất biến vẫn đúng nguyên vẹn, chỉ có **người mẫu**
     * không còn hợp lệ.
     *
     * ⇒ Ca này nay **tự dựng người mẫu** (một tool thăm dò có schema `.strict()` KHÔNG khai
     * `__authCtx`) để bất biến không còn phụ thuộc vào việc tool sản xuất nào tình cờ chưa có cổng.
     * Bất biến: `__authCtx` bịa **biến mất**, và ta **KHÔNG** nhét vào một khoá mà schema
     * `.strict()` không có (nhét vào là làm vỡ mọi `safeParse` về sau).
     */
    const { z } = await import("zod");
    const { registerTool, getTool } = await import("./toolRegistry");
    const nhan: unknown[] = [];
    registerTool({
      name: "__probe_khong_khai_authctx",
      description: "probe",
      parameters: z.object({ ghiChu: z.string().optional() }).strict(),
      triggers: [],
      handler: async (p: unknown) => {
        nhan.push(p);
        return { type: "action_result", title: "x", data: {}, textSummary: "x" } as never;
      },
    } as never);
    expect(getTool("__probe_khong_khai_authctx"), "tool thăm dò phải vào được sổ").toBeTruthy();

    classifier.args = { __authCtx: BIA, ghiChu: "xin chào" };
    const mod = await import("./intentClassifier");
    const spy = vi.spyOn(mod, "classifyToolIntent").mockReturnValue({
      tool: "__probe_khong_khai_authctx",
      args: classifier.args,
      reason: "TEST_SEAM",
    } as never);
    await tryExecuteTool("bất kỳ câu nào", undefined, PHIEN);
    spy.mockRestore();

    expect(nhan.length).toBe(1);
    expect(Object.hasOwn(nhan[0] as object, "__authCtx"), "không khai ⇒ KHÔNG được nhét vào").toBe(false);
    // …và phần args HỢP LỆ vẫn tới nơi (không "làm sạch" bằng cách vứt hết).
    expect((nhan[0] as Record<string, unknown>).ghiChu).toBe("xin chào");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ TASK 5 (review, CRITICAL) — **BẢN KIỂM ĐẾM MỌI ĐIỂM GỌI `Tool.handler(`**
// ════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠⚠ VÌ SAO LƯỚI NÀY TỒN TẠI: các ca ở TRÊN đi qua `tryExecuteTool()` — **một** đường thoát — nên
// chúng **XANH TRỌN VẸN** suốt thời gian `aiAgentOrchestrator` gọi thẳng `tool.handler(step.args)`
// và **FAIL-OPEN**. Đó là *"lưới theo FILE, không theo ĐƯỜNG THOÁT"*, lần thứ **MƯỜI MỘT**.
//
// ⇒ Lưới này phát biểu bất biến ở đúng mức của nó: **KHÔNG một điểm gọi `Tool.handler(` nào trong
// mã sản xuất được nhận args mà chưa qua `argsWithAuthCtx(...)`.** Nó **liệt kê bằng AST**, không
// bằng danh sách chép tay, nên một điểm gọi MỚI (file mới, tên biến khác, module khác) rơi vào lưới
// ngay — kể cả khi người viết chưa từng đọc file này.
//
// ⚠ VÌ SAO AST CHỨ KHÔNG REGEX: `git grep ".handler("` bắt cả **chú thích** (docstring của
// `index.ts` có đúng chuỗi `tool.handler(decision.args)`) và cả `sub.handler(msg)` của pub/sub.
// Cây cú pháp không có chú thích, và phép phân biệt dưới đây **không dựa vào tên biến**.
// ⚠ VÌ SAO KHÓA CẢ SỐ LƯỢNG: một điểm gọi mới ĐÃ ĐÚNG vẫn phải được người viết nhìn thấy lưới này
// một lần — cùng kỷ luật với `vramAllocationSites.test.ts`.
describe("★★★ MỌI điểm gọi `Tool.handler(` trong mã sản xuất đều đi qua `argsWithAuthCtx`", () => {
  const GOC = path.resolve(__dirname, "../..");
  /**
   * ★ I-3 (review TOÀN NHÁNH) — gốc quét cũ chỉ có `server/`. `shared/` và `scripts/` **không được
   * canh**, dù cả hai đều nhập được `toolRegistry`. Ba gốc, một phép quét.
   */
  const GOC_QUET = [GOC, path.resolve(GOC, "../shared"), path.resolve(GOC, "../scripts")].filter((p) =>
    fs.existsSync(p),
  );

  /**
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ★★★ I-3 (review TOÀN NHÁNH Pha 4) — **DANH SÁCH CHO PHÉP, KHÔNG PHẢI "FILE CÓ CẠNH NHẬP".**
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ⚠⚠⚠ VỊ TỪ CŨ SAI **LOẠI CÂU HỎI**, không phải thiếu một ca. Nó hỏi *"file này có cạnh NHẬP tới
   * `aiLocalTools` không"* — một câu trả lời về **sự hiện diện của một import** — trong khi bất
   * biến cần trả lời là *"lời gọi NÀY có trên một `Tool` không"*. TypeScript là **kiểu CẤU TRÚC**:
   * một file **không import gì cả** vẫn gọi được `t.handler(args)` chỉ bằng
   * `interface CoHandler { handler: (a: unknown) => Promise<unknown> }`. Người review dựng đúng thế
   * và đo được **12/12 XANH** trên một điểm gọi fail-open THẬT (bỏ bước XOÁ `__authCtx` ⇒ leo thang
   * quyền, đúng chuỗi CRITICAL mà Task 5 vừa vá).
   *
   * ⇒ **ĐỔI CHIỀU**: quét MỌI điểm chạm `.handler` trong mã sản xuất (chiều CHẶT), rồi **liệt kê
   * TƯỜNG MINH** những điểm đã biết KHÔNG phải `Tool` (chiều LỎNG, có tên có lý do). Một điểm gọi
   * mới — file mới, tên biến khác, không import gì — rơi vào lưới NGAY; muốn ra khỏi lưới thì phải
   * **viết tên mình vào đây**, tức phải đọc khối này một lần.
   *
   * ⚠ Danh sách này có lưới của riêng nó (ca cuối describe): một dòng trỏ file không còn tồn tại,
   * hoặc một dòng KHÔNG còn điểm chạm nào ⇒ ĐỎ. Danh sách chỉ được **co lại**.
   */
  const CHO_PHEP: ReadonlyMap<string, string> = new Map([
    [
      "services/streaming/inProcessAdapter.ts",
      "`sub.handler(msg)` — `sub` là một ĐĂNG KÝ pub/sub (`{ topic, handler }`), không phải `Tool`. " +
        "Không có `parameters`, không có `requiredPermission`, không nhận `__authCtx`.",
    ],
  ]);

  function moiFileSanXuat(dir: string, ra: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "dist") continue;
        moiFileSanXuat(p, ra);
      } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && !e.name.endsWith(".d.ts")) {
        ra.push(p);
      }
    }
    return ra;
  }

  interface DiemGoi {
    readonly file: string;
    readonly dong: number;
    /** Văn bản NGUỒN của đối số thứ nhất — `""` khi gọi không đối số / khi chỉ ĐỌC `.handler`. */
    readonly doiSo1: string;
    /** `"goi"` = `x.handler(...)` / `x["handler"](...)`; `"doc"` = lấy `.handler` ra khỏi ngữ cảnh gọi. */
    readonly hinhDang: "goi" | "doc";
    readonly quaCong: boolean;
  }

  /**
   * Điểm CHẠM `.handler`: cả `x.handler` (PropertyAccess) lẫn `x["handler"]` (ElementAccess với
   * chuỗi literal). ⚠ Bản trước chỉ bắt PropertyAccess ⇒ `tool["handler"](x)` vô hình.
   */
  function tenLaHandler(n: ts.Node): n is ts.PropertyAccessExpression | ts.ElementAccessExpression {
    if (ts.isPropertyAccessExpression(n)) return n.name.text === "handler";
    if (ts.isElementAccessExpression(n)) {
      const a = n.argumentExpression;
      return (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) && a.text === "handler";
    }
    return false;
  }

  /** BẤT BIẾN: đối số thứ nhất **PHẢI LÀ** một lời gọi `argsWithAuthCtx(...)` — không phải "có chứa chuỗi". */
  function laArgsWithAuthCtx(a0: ts.Expression | undefined): boolean {
    return !!a0 && ts.isCallExpression(a0) && ts.isIdentifier(a0.expression) && a0.expression.text === "argsWithAuthCtx";
  }

  function quetDiemGoi(): DiemGoi[] {
    const ra: DiemGoi[] = [];
    for (const goc of GOC_QUET) {
      for (const file of moiFileSanXuat(goc)) {
        const src = fs.readFileSync(file, "utf8");
        /**
         * ⚠ Lọc nhanh theo `"handler"` TRẦN, KHÔNG theo `".handler("`: bản trước bỏ file ngay khi
         * thiếu chuỗi `".handler("` ⇒ `tool["handler"](x)`, `.handler (x)` (có khoảng trắng), và
         * `const h = tool.handler; h(x)` đều lọt **trước khi** AST được dựng.
         */
        if (!src.includes("handler")) continue;
        const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        const rel = path.relative(GOC, file).split(path.sep).join("/");
        if (CHO_PHEP.has(rel)) continue;
        const di = (n: ts.Node): void => {
          if (tenLaHandler(n)) {
            const cha = n.parent;
            const laCallee = cha !== undefined && ts.isCallExpression(cha) && cha.expression === n;
            /**
             * ⚠ `typeof x.handler !== "function"` là một **phép canh**, không phải một lượt dùng —
             * nó không chở được args đi đâu. Hai điểm sản xuất hợp lệ dùng đúng hình dạng này
             * (`index.ts`, `aiAgentOrchestrator.ts`). Mọi hình dạng ĐỌC khác (gán vào biến, truyền
             * đi làm callback, `?.()`) là **đưa `handler` ra khỏi tầm lưới** ⇒ bị bắt.
             */
            const laTypeofGuard = cha !== undefined && ts.isTypeOfExpression(cha);
            if (laTypeofGuard) {
              ts.forEachChild(n, di);
              return;
            }
            const a0 = laCallee ? (cha as ts.CallExpression).arguments[0] : undefined;
            ra.push({
              file: rel,
              dong: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
              doiSo1: a0 ? a0.getText(sf) : "",
              hinhDang: laCallee ? "goi" : "doc",
              quaCong: laCallee && laArgsWithAuthCtx(a0),
            });
          }
          ts.forEachChild(n, di);
        };
        di(sf);
      }
    }
    return ra;
  }

  it("★★★ KHÔNG điểm gọi nào nhận args CHƯA qua `argsWithAuthCtx(...)`", () => {
    const ho = quetDiemGoi().filter((d) => !d.quaCong);
    expect(
      ho,
      "một điểm gọi `Tool.handler(` bỏ qua `argsWithAuthCtx` là FAIL-OPEN: nó bỏ luôn bước XOÁ " +
        "`__authCtx` do đầu vào bịa ⇒ leo thang quyền. Sửa điểm gọi, KHÔNG nới lưới " +
        "(nếu nó THẬT SỰ không phải `Tool`: thêm tên file + LÝ DO vào `CHO_PHEP`):\n" +
        ho.map((d) => `  ${d.file}:${d.dong} [${d.hinhDang}] → handler(${d.doiSo1})`).join("\n"),
    ).toEqual([]);
  });

  it("★★ bản kiểm đếm khớp: đúng HAI đường thoát đã biết (tryExecuteTool + Agent tự trị)", () => {
    const tatCa = quetDiemGoi();
    const files = [...new Set(tatCa.map((d) => d.file))].sort();
    expect(files, "thêm/bớt một điểm gọi phải được người viết nhìn thấy lưới này một lần").toEqual([
      "services/aiAgentOrchestrator.ts",
      "services/aiLocalTools/index.ts",
    ]);
    expect(tatCa.every((d) => d.quaCong)).toBe(true);
  });

  /**
   * ★★ LƯỚI CHO DANH SÁCH CHO PHÉP. Một dòng miễn trừ trỏ vào hư không là một lỗ **im lặng**: nó
   * không đỏ, không ai đọc, và nó dạy người sau rằng thêm một dòng vào đây là chuyện thường.
   */
  it("★★ mọi dòng trong `CHO_PHEP` đều TRỎ THẬT: file còn tồn tại VÀ vẫn có điểm chạm `.handler`", () => {
    for (const [rel, lyDo] of CHO_PHEP) {
      const p = path.join(GOC, rel);
      expect(fs.existsSync(p), `miễn trừ trỏ file không tồn tại: ${rel}`).toBe(true);
      expect(fs.readFileSync(p, "utf8"), `miễn trừ đã hết tác dụng, XOÁ dòng: ${rel}`).toMatch(/\bhandler\b/);
      expect(lyDo.length, "một miễn trừ không lý do là một lỗ").toBeGreaterThan(40);
    }
  });

  /**
   * ⚠⚠ Hai ca dưới chạy **ĐÚNG hai vị từ** mà `quetDiemGoi()` chạy (`tenLaHandler` +
   * `laArgsWithAuthCtx`), không chép lại chúng. Bản trước chép — nên khi vị từ thật đổi, "lưới cho
   * lưới" vẫn xanh trên vị từ CŨ, đúng lớp lỗi "hai bản sao một vị từ" mà cả nhánh đang gỡ.
   */
  function chamTrenNguon(nguon: string): { hinhDang: "goi" | "doc"; quaCong: boolean } | null {
    const sf = ts.createSourceFile("t.ts", nguon, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let ra: { hinhDang: "goi" | "doc"; quaCong: boolean } | null = null;
    const di = (n: ts.Node): void => {
      if (ra === null && tenLaHandler(n)) {
        const cha = n.parent;
        const laCallee = cha !== undefined && ts.isCallExpression(cha) && cha.expression === n;
        if (!(cha !== undefined && ts.isTypeOfExpression(cha))) {
          const a0 = laCallee ? (cha as ts.CallExpression).arguments[0] : undefined;
          ra = { hinhDang: laCallee ? "goi" : "doc", quaCong: laCallee && laArgsWithAuthCtx(a0) };
        }
      }
      ts.forEachChild(n, di);
    };
    di(sf);
    return ra;
  }

  it("★★ LƯỚI-CHO-LƯỚI: TÁM hình dạng lách đều bị bắt (kể cả kiểu CẤU TRÚC, `[\"handler\"]`, biến trung gian)", () => {
    /**
     * ⚠ Ba hình dạng CUỐI là những thứ bản trước **để lọt** và người review đã đo được (I-3):
     * `tool["handler"](x)` · `const h = tool.handler; h(x)` · và lời gọi từ một file **không import
     * gì** (kiểu CẤU TRÚC — không kiểm được trên một file lẻ, nên nó được kiểm bằng đột biến sản
     * xuất: thêm một file gọi `t.handler(args)` với `interface CoHandler` ⇒ ca ĐẦU của describe này
     * phải ĐỎ; đã chạy và ĐỎ).
     */
    const lach = [
      "const a = argsWithAuthCtx(tool, x, e); await tool.handler(a);",
      "await tool.handler(ok ? argsWithAuthCtx(tool, x, e) : x);",
      "await tool.handler(argsWithAuthCtx(tool, x, e) ?? x);",
      "await tool.handler(ok && argsWithAuthCtx(tool, x, e));",
      "await tool.handler(sanitize(x));",
      "await tool.handler(x);",
      'await tool["handler"](x);',
      "const h = tool.handler; await h(x);",
    ];
    for (const mau of lach) {
      const r = chamTrenNguon(mau);
      expect(r, `lưới phải THẤY điểm chạm: ${mau}`).not.toBeNull();
      expect(r!.quaCong, `hình dạng lách phải bị BẮT: ${mau}`).toBe(false);
    }
  });

  it("★ chiều DƯƠNG: hình dạng ĐÚNG được lưới cho qua, và `typeof` guard KHÔNG bị bắt oan", () => {
    const dung = chamTrenNguon("await tool.handler(argsWithAuthCtx(tool, step.args ?? {}, exec));");
    expect(dung).not.toBeNull();
    expect(dung!.quaCong).toBe(true);
    // Một lưới kêu oan bảy lần sẽ bị người sau tắt đi — `typeof x.handler !== "function"` phải im.
    expect(chamTrenNguon('if (typeof tool.handler !== "function") return null;')).toBeNull();
  });
});
