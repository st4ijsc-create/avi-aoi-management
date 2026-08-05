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
     * `get_today_stats` (họ `handlers.ts`) không khai `__authCtx`. Bất biến: `__authCtx` bịa **biến
     * mất**, và ta **không** nhét vào một khoá mà schema `.strict()` của nó không có.
     */
    classifier.args = { __authCtx: BIA };
    const { getTool } = await import("./toolRegistry");
    const t = getTool("get_today_stats");
    if (!t) return; // tool không có ở bản dựng này ⇒ bất biến không áp dụng
    const nhan: unknown[] = [];
    const goc = t.handler!;
    t.handler = async (p: unknown) => {
      nhan.push(p);
      return { type: "today_stats", title: "x", data: {}, textSummary: "x" } as never;
    };
    try {
      const mod = await import("./intentClassifier");
      const spy = vi.spyOn(mod, "classifyToolIntent").mockReturnValue({
        tool: "get_today_stats",
        args: classifier.args,
        reason: "TEST_SEAM",
      } as never);
      await tryExecuteTool("hôm nay thế nào", undefined, PHIEN);
      spy.mockRestore();
      expect(nhan.length).toBe(1);
      expect(Object.hasOwn(nhan[0] as object, "__authCtx"), "không khai ⇒ KHÔNG được nhét vào").toBe(false);
    } finally {
      t.handler = goc;
    }
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
    /** Văn bản NGUỒN của đối số thứ nhất — `""` khi gọi không đối số. */
    readonly doiSo1: string;
    readonly quaCong: boolean;
  }

  /**
   * ⚠ PHÉP PHÂN BIỆT **KHÔNG THEO TÊN BIẾN** (`tool` / `t` / `x` đều như nhau): một file chỉ có thể
   * gọi `Tool.handler` nếu nó **thấy được kiểu `Tool`**, tức có `import` từ `aiLocalTools/**` (hoặc
   * chính nó nằm trong thư mục đó). File không có cửa ấy thì `.handler(` của nó là thứ khác
   * (vd `sub.handler(msg)` của pub/sub trong `streaming/inProcessAdapter.ts`).
   */
  function thayKieuTool(sf: ts.SourceFile, file: string): boolean {
    if (file.split(path.sep).join("/").includes("/aiLocalTools/")) return true;
    let thay = false;
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
        if (st.moduleSpecifier.text.includes("aiLocalTools")) thay = true;
      }
    }
    return thay;
  }

  function quetDiemGoi(): DiemGoi[] {
    const ra: DiemGoi[] = [];
    for (const file of moiFileSanXuat(GOC)) {
      const src = fs.readFileSync(file, "utf8");
      if (!src.includes(".handler(")) continue;
      const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      if (!thayKieuTool(sf, file)) continue;
      const di = (n: ts.Node): void => {
        if (
          ts.isCallExpression(n) &&
          ts.isPropertyAccessExpression(n.expression) &&
          n.expression.name.text === "handler"
        ) {
          const a0 = n.arguments[0];
          const doiSo1 = a0 ? a0.getText(sf) : "";
          // BẤT BIẾN: đối số thứ nhất **PHẢI LÀ** một lời gọi `argsWithAuthCtx(...)`.
          // ⚠ Phát biểu về cái nó **PHẢI LÀ**, không phải "có chứa chuỗi" — một biến trung gian,
          // một `?:`, một `??`, một hàm khác đều làm nó **thôi LÀ** lời gọi ấy ⇒ lưới ĐỎ.
          const quaCong =
            !!a0 &&
            ts.isCallExpression(a0) &&
            ts.isIdentifier(a0.expression) &&
            a0.expression.text === "argsWithAuthCtx";
          ra.push({
            file: path.relative(GOC, file).split(path.sep).join("/"),
            dong: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
            doiSo1,
            quaCong,
          });
        }
        ts.forEachChild(n, di);
      };
      di(sf);
    }
    return ra;
  }

  it("★★★ KHÔNG điểm gọi nào nhận args CHƯA qua `argsWithAuthCtx(...)`", () => {
    const ho = quetDiemGoi().filter((d) => !d.quaCong);
    expect(
      ho,
      "một điểm gọi `Tool.handler(` bỏ qua `argsWithAuthCtx` là FAIL-OPEN: nó bỏ luôn bước XOÁ " +
        "`__authCtx` do đầu vào bịa ⇒ leo thang quyền. Sửa điểm gọi, KHÔNG nới lưới:\n" +
        ho.map((d) => `  ${d.file}:${d.dong} → handler(${d.doiSo1})`).join("\n"),
    ).toEqual([]);
  });

  it("★★ bản kiểm đếm khớp: đúng HAI đường thoát đã biết (tryExecuteTool + Agent tự trị)", () => {
    const tatCa = quetDiemGoi();
    const files = tatCa.map((d) => d.file).sort();
    expect(files, "thêm/bớt một điểm gọi phải được người viết nhìn thấy lưới này một lần").toEqual([
      "services/aiAgentOrchestrator.ts",
      "services/aiLocalTools/index.ts",
    ]);
    expect(tatCa.every((d) => d.quaCong)).toBe(true);
  });

  it("★★ LƯỚI-CHO-LƯỚI: năm hình dạng lách đều bị bắt (biến trung gian · ?: · ?? · && · hàm khác)", () => {
    /**
     * ⚠ Không có ca này thì lưới trên có thể là một phép so chuỗi lỏng lẻo mà chính nó không biết.
     * Ở đây ta dựng NĂM biến thể trên AST THẬT và khẳng định lưới **bắt cả năm** — đúng khuôn
     * "lưới-cho-lưới" mà N-2/N-5 của Task 4 đã phải dựng sau khi người review lách được.
     */
    const lach = [
      "const a = argsWithAuthCtx(tool, x, e); await tool.handler(a);",
      "await tool.handler(ok ? argsWithAuthCtx(tool, x, e) : x);",
      "await tool.handler(argsWithAuthCtx(tool, x, e) ?? x);",
      "await tool.handler(ok && argsWithAuthCtx(tool, x, e));",
      "await tool.handler(sanitize(x));",
      "await tool.handler(x);",
    ];
    for (const mau of lach) {
      const sf = ts.createSourceFile("t.ts", mau, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      let quaCong: boolean | null = null;
      const di = (n: ts.Node): void => {
        if (
          ts.isCallExpression(n) &&
          ts.isPropertyAccessExpression(n.expression) &&
          n.expression.name.text === "handler"
        ) {
          const a0 = n.arguments[0];
          quaCong =
            !!a0 &&
            ts.isCallExpression(a0) &&
            ts.isIdentifier(a0.expression) &&
            a0.expression.text === "argsWithAuthCtx";
        }
        ts.forEachChild(n, di);
      };
      di(sf);
      expect(quaCong, `hình dạng lách phải bị BẮT: ${mau}`).toBe(false);
    }
  });

  it("★ chiều DƯƠNG: hình dạng ĐÚNG được lưới cho qua (không phải lưới chặn tất)", () => {
    const sf = ts.createSourceFile(
      "t.ts",
      "await tool.handler(argsWithAuthCtx(tool, step.args ?? {}, exec));",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    let quaCong: boolean | null = null;
    const di = (n: ts.Node): void => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === "handler"
      ) {
        const a0 = n.arguments[0];
        quaCong =
          !!a0 && ts.isCallExpression(a0) && ts.isIdentifier(a0.expression) && a0.expression.text === "argsWithAuthCtx";
      }
      ts.forEachChild(n, di);
    };
    di(sf);
    expect(quaCong).toBe(true);
  });
});
