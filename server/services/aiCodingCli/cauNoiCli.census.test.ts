/**
 * ★★★ doc 83 — **ĐIỀU TRA DÂN SỐ CHO MẶT TIẾP XÚC MỚI (CLI · MCP).**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO LƯỚI NÀY TỒN TẠI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * CLI và MCP là **hai cửa MỚI mở vào đúng lớp ghi đĩa** mà doc 78/79 đã tôi qua hàng chục vòng
 * đột biến. Mọi hàng rào ở đó (hộp cát · băm TOCTOU mỗi tệp · tệp bẩn · `writeConfined` một điểm
 * gọi · HITL) chỉ còn nguyên nếu hai cửa mới **KHÔNG tự làm lấy việc gì** — nghĩa là chúng không
 * được có `fs`, không được có phép phán quyết đường dẫn, và không được có một đường tới `execute`
 * nào vòng qua `proposeAction`.
 *
 * Lưới này **không liệt kê cái bị cấm** — nó phát biểu **cái phải là**, rồi quét AST cả **thư
 * mục**, nên một FILE MỚI rơi vào tầm ngay (đúng bài học `programmingFileIo.census`: *"lưới theo
 * FILE, không theo ĐƯỜNG THOÁT"* đã tái diễn 13 lần).
 *
 * ⚠ Quét bằng **AST**, không so chuỗi: `grep "confirmAction"` bắt cả docblock (file này và
 *   `cauNoiCli.ts` đều nhắc tên ấy trong văn xuôi) và bỏ sót `x["confirmAction"]()`.
 */
import { describe, it, expect } from "vitest";
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const GOC = path.resolve(__dirname);

/** Mọi file SẢN XUẤT của thư mục (đệ quy), bỏ test/d.ts. */
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

const FILE = moiFileSanXuat(GOC).sort();
const TEN = (p: string): string => path.basename(p);

function nguon(p: string): ts.SourceFile {
  return ts.createSourceFile(p, fs.readFileSync(p, "utf8"), ts.ScriptTarget.Latest, true);
}

/** Tên hàm bao ngoài gần nhất — `"<đỉnh>"` khi không có. */
function hamBao(n: ts.Node): string {
  let c: ts.Node | undefined = n.parent;
  while (c) {
    if (ts.isFunctionDeclaration(c) && c.name) return c.name.text;
    if (ts.isMethodDeclaration(c) && ts.isIdentifier(c.name)) return c.name.text;
    if ((ts.isFunctionExpression(c) || ts.isArrowFunction(c)) && ts.isVariableDeclaration(c.parent) && ts.isIdentifier(c.parent.name)) {
      return c.parent.name.text;
    }
    c = c.parent;
  }
  return "<đỉnh>";
}

/** Tên được gọi ở một CallExpression: `f(...)`, `o.f(...)`, `o["f"](...)`. */
function tenGoi(e: ts.CallExpression): string | null {
  const x = e.expression;
  if (ts.isIdentifier(x)) return x.text;
  if (ts.isPropertyAccessExpression(x)) return x.name.text;
  if (ts.isElementAccessExpression(x)) {
    const a = x.argumentExpression;
    if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) return a.text;
  }
  return null;
}

interface DiemGoi {
  file: string;
  ham: string;
  goi: ts.CallExpression;
}

function moiDiemGoi(ten: string): DiemGoi[] {
  const ra: DiemGoi[] = [];
  for (const p of FILE) {
    const src = fs.readFileSync(p, "utf8");
    if (!src.includes(ten)) continue;
    const sf = nguon(p);
    const di = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && tenGoi(n) === ten) ra.push({ file: TEN(p), ham: hamBao(n), goi: n });
      n.forEachChild(di);
    };
    di(sf);
  }
  return ra;
}

describe("doc 83 · điều tra dân số cửa CLI/MCP", () => {
  it("★ vũ trụ quét không rỗng và gồm đúng năm file sản xuất", () => {
    expect(FILE.map(TEN)).toEqual(["batDau.ts", "cauNoiCli.ts", "cli.ts", "danhTinhCli.ts", "mcpServer.ts"]);
  });

  /**
   * ★★★ `dotenv` CHỈ ĐƯỢC nằm ở vỏ chạy. Một `import "dotenv/config"` trong `cli.ts` sẽ nạp toàn
   * bộ `.env` sản xuất vào **mọi tiến trình vitest nào import `./cli`** — tức làm hỏng những lưới
   * KHÁC, ở những file KHÁC, theo một cách không truy ngược về đây được. Xem docblock `batDau.ts`.
   */
  it("§0 ★★★ chỉ `batDau.ts` được nhập `dotenv`", () => {
    const co: string[] = [];
    for (const p of FILE) {
      const sf = nguon(p);
      for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st)) continue;
        if (/^dotenv/.test((st.moduleSpecifier as ts.StringLiteral).text)) co.push(TEN(p));
      }
    }
    expect(co).toEqual(["batDau.ts"]);
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // §1 — `confirmAction` CÓ ĐÚNG MỘT ĐIỂM GỌI, VÀ NÓ NẰM SAU CỔNG NGƯỜI-DUYỆT
  // ════════════════════════════════════════════════════════════════════════════════════════════
  it("§1 ★★★ `confirmAction(` có ĐÚNG MỘT điểm gọi, trong `duyetVaGhi` của `cauNoiCli.ts`", () => {
    const d = moiDiemGoi("confirmAction");
    expect(d.map((x) => `${x.file} [${x.ham}]`)).toEqual(["cauNoiCli.ts [duyetVaGhi]"]);
  });

  it("§1.2 ★★★ `duyetVaGhi` mở đầu bằng CỔNG `dongY !== true` và cổng ấy TRẢ VỀ NGAY", () => {
    const p = FILE.find((f) => TEN(f) === "cauNoiCli.ts")!;
    const sf = nguon(p);
    let thay = false;
    const di = (n: ts.Node): void => {
      if (ts.isIfStatement(n) && hamBao(n) === "duyetVaGhi") {
        const e = n.expression;
        if (
          ts.isBinaryExpression(e) &&
          e.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken &&
          ts.isIdentifier(e.left) &&
          e.left.text === "dongY" &&
          e.right.kind === ts.SyntaxKind.TrueKeyword
        ) {
          // Nhánh `then` phải KẾT THÚC bằng `return` — một cổng không dừng là một cổng trang trí.
          const t = n.thenStatement;
          const dsCau = ts.isBlock(t) ? [...t.statements] : [t];
          if (dsCau.some((c) => ts.isReturnStatement(c))) thay = true;
        }
      }
      n.forEachChild(di);
    };
    di(sf);
    expect(thay, "phải có `if (dongY !== true) { … return … }` trong duyetVaGhi").toBe(true);
  });

  it("§1.3 ★★★ KHÔNG người gọi nào truyền hằng `true` vào ô `dongY` của `duyetVaGhi`", () => {
    const xau = moiDiemGoi("duyetVaGhi")
      .filter((d) => d.goi.arguments.length >= 3 && d.goi.arguments[2].kind === ts.SyntaxKind.TrueKeyword)
      .map((d) => `${d.file} [${d.ham}]`);
    expect(xau, "một hằng `true` ở đây là tự-duyệt trá hình").toEqual([]);
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // §2 — KHÔNG CÓ CỬA ĐĨA THỨ HAI
  // ════════════════════════════════════════════════════════════════════════════════════════════
  it("§2 ★★★ KHÔNG file nào nhập `fs` — mọi byte vẫn đi qua hai cửa của `readToolsProgramming`", () => {
    const xau: string[] = [];
    for (const p of FILE) {
      const sf = nguon(p);
      for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st)) continue;
        const m = (st.moduleSpecifier as ts.StringLiteral).text;
        if (/^(node:)?fs(\/promises)?$/.test(m)) xau.push(`${TEN(p)} → ${m}`);
      }
      const di = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "require") {
          const a = n.arguments[0];
          if (a && ts.isStringLiteral(a) && /^(node:)?fs/.test(a.text)) xau.push(`${TEN(p)} → require(${a.text})`);
        }
        n.forEachChild(di);
      };
      di(sf);
    }
    expect(xau).toEqual([]);
  });

  it("§2.2 ★★ KHÔNG file nào chạm `.handler` — điểm gọi handler vẫn ĐÚNG HAI file của repo", () => {
    const xau: string[] = [];
    for (const p of FILE) {
      const src = fs.readFileSync(p, "utf8");
      if (!src.includes("handler")) continue;
      const sf = nguon(p);
      const di = (n: ts.Node): void => {
        if (ts.isPropertyAccessExpression(n) && n.name.text === "handler") xau.push(`${TEN(p)} [${hamBao(n)}]`);
        n.forEachChild(di);
      };
      di(sf);
    }
    expect(xau, "chạm `.handler` là vòng qua `argsWithAuthCtx` — xem authCtxInjection.test.ts").toEqual([]);
  });

  /**
   * ★★★ §2.2b — **ĐƯỜNG VÒNG QUA `proposeAction`.** `.handler` là cửa của READ tool; cửa của WRITE
   * tool là `preview()`/`execute()`. Một `tool.execute(args, ctx)` gọi thẳng từ đây sẽ **ghi đĩa mà
   * không có hàng `ai_pending_actions` nào, không có người nào bấm** — và §2.2 mù với nó vì tên
   * thuộc tính khác. Cấm theo **LỜI GỌI** (không cấm truy cập thuộc tính), vì `pending.preview` là
   * một ô DỮ LIỆU hợp lệ của DTO mà CLI phải đọc để vẽ thẻ duyệt.
   */
  it("§2.2b ★★★ KHÔNG lời gọi `execute(`/`preview(`/`writeConfined(`/`ghiTheoPhanQuyet(` nào", () => {
    const cam = ["execute", "preview", "writeConfined", "ghiTheoPhanQuyet", "phanQuyet"];
    const xau: string[] = [];
    for (const t of cam) for (const d of moiDiemGoi(t)) xau.push(`${d.file} [${d.ham}] ${t}(`);
    expect(xau, "cửa write tool phải luôn đi qua proposeAction/confirmAction").toEqual([]);
  });

  it("§2.3 ★★ `cauNoiCli.ts` KHÔNG nhập một module hàng-rào nào (không có bản sao vị từ an toàn)", () => {
    const p = FILE.find((f) => TEN(f) === "cauNoiCli.ts")!;
    const sf = nguon(p);
    const nhap = sf.statements
      .filter(ts.isImportDeclaration)
      .map((s) => (s.moduleSpecifier as ts.StringLiteral).text)
      .sort();
    expect(nhap).toEqual([
      "../aiCopilotActions",
      "../aiLocalKnowledgeService",
      "../aiLocalTools",
      "../aiLocalTools/repoProjects",
      "./danhTinhCli",
    ]);
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // §3 — KHÔNG CÓ CỜ NÀO BỎ QUA BƯỚC DUYỆT
  // ════════════════════════════════════════════════════════════════════════════════════════════
  it("§3 ★★★ tập cờ dòng lệnh của CLI ĐÚNG BẰNG sổ khai — không cờ tự-duyệt, không cờ mật khẩu", () => {
    const p = FILE.find((f) => TEN(f) === "cli.ts")!;
    const sf = nguon(p);
    const co = new Set<string>();
    const di = (n: ts.Node): void => {
      // Chỉ đếm chuỗi ở nhãn `case` — tức tập cờ mà bộ phân tích THỰC SỰ nhận.
      if (ts.isCaseClause(n) && ts.isStringLiteral(n.expression) && n.expression.text.startsWith("-")) {
        co.add(n.expression.text);
      }
      n.forEachChild(di);
    };
    di(sf);
    expect([...co].sort()).toEqual([
      /**
       * ★★★ 2026-08-23 — **`--duyet <id>` LÀ CỜ NGUY HIỂM NHẤT TRONG BẢNG NÀY, VÀ NÓ ĐƯỢC PHÉP TỒN
       * TẠI VÌ NÓ **KHÔNG** DUYỆT.** Nó chỉ *mở* một đề xuất: `chayCli` gọi `hoiRoiDuyet` — đúng
       * hàm mà đường hội thoại dùng — nên nó **vẽ lại đủ diff, cảnh báo, băm neo** rồi mới hỏi `y`
       * ở một dấu nhắc TƯƠI. Một bản "cho nhanh" gọi thẳng `duyetVaGhi(…, true)` sẽ biến hộp thư
       * thành **đường đi vòng qua bước xem diff** — trông y hệt trên màn hình, và
       * `cliVongThat.test.ts` §5B canh đúng chỗ ấy bằng byte trên đĩa.
       * ⚠ Trước khi thêm bất kỳ cờ nào vào danh sách này: nó có nhận `y` thay cho người không?
       *   Nếu có, câu trả lời là KHÔNG THÊM.
       */
      "--danh-sach-de-xuat",
      "--du-an",
      "--duyet",
      "--giup",
      "--help",
      "--lenh",
      "--liet-ke-du-an",
      "--nguoi-dung",
      "-h",
    ]);
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // §4 — MCP KHÔNG CÓ TOOL DUYỆT (bên kia đường ống là một TÁC NHÂN, không phải một người)
  // ════════════════════════════════════════════════════════════════════════════════════════════
  it("§4 ★★★ `mcpServer.ts` KHÔNG nhập `confirmAction`/`duyetVaGhi`", () => {
    const p = FILE.find((f) => TEN(f) === "mcpServer.ts")!;
    const sf = nguon(p);
    const ten: string[] = [];
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !st.importClause?.namedBindings) continue;
      const nb = st.importClause.namedBindings;
      if (ts.isNamedImports(nb)) for (const s of nb.elements) ten.push(s.name.text);
    }
    expect(ten).not.toContain("confirmAction");
    expect(ten).not.toContain("duyetVaGhi");
  });

  it("§4.2 ★★★ không tool MCP nào mang nghĩa 'duyệt', và mọi tool đều trỏ vào 5 tool ĐÃ ĐĂNG KÝ", async () => {
    const { SO_TOOL_MCP } = await import("./mcpServer");
    const ten = SO_TOOL_MCP.map((m) => m.ten);
    expect(ten.filter((t) => /confirm|approve|duyet|duyệt|xac_?nhan|commit|write|ghi/i.test(t))).toEqual([]);
    const that = SO_TOOL_MCP.map((m) => m.toolThat).filter((x): x is string => x !== null).sort();
    expect(that).toEqual(["apply_diff", "grep_repo", "list_files", "read_file", "run_command"]);
    /**
     * ⚠ 2026-08-23 — HẠN GIỜ TƯỜNG MINH, và nó KHÔNG phải để "cho qua một ca chậm". Ca này ĐỎ ở
     *   **5025ms/5000ms** khi chạy chung 52 tệp lưới, XANH khi chạy riêng — tức nó đỏ vì tranh chấp
     *   máy, không vì phát biểu sai. Thứ tốn thời gian là `await import("./mcpServer")`: lượt nhập
     *   ĐẦU kéo theo cả đồ thị phụ thuộc (CSDL, Redis, sổ đăng ký tool). Mệnh đề ở đây là về **dân
     *   số tool**, không về tốc độ — để hạn mặc định là dựng một cổng đỏ ngẫu nhiên, và một cổng đỏ
     *   ngẫu nhiên dạy người ta bỏ qua màu đỏ.
     */
  }, 30_000);

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // §5 — GỐC DỰ ÁN CHỈ ĐẾN TỪ DANH SÁCH TRẮNG; KHÔNG MẶT TIẾP XÚC NÀO NHẬN MỘT ĐƯỜNG DẪN GỐC
  // ════════════════════════════════════════════════════════════════════════════════════════════
  it("§5 ★★★ không lược đồ MCP nào có ô mang nghĩa 'gốc/đường dẫn tuyệt đối'", async () => {
    const { SO_TOOL_MCP } = await import("./mcpServer");
    const cam = /^(root|projectRoot|goc|gocDuAn|cwd|dir|directory|sandboxRoot|basePath|absolutePath)$/i;
    const xau: string[] = [];
    for (const m of SO_TOOL_MCP) {
      const props = (m.luoc as { properties?: Record<string, unknown> }).properties ?? {};
      for (const k of Object.keys(props)) if (cam.test(k)) xau.push(`${m.ten}.${k}`);
    }
    expect(xau).toEqual([]);
    // ⚠ Cùng lý do §4.2: ca này đo 3522ms trong bộ lớn — sát trần mặc định 5000ms.
  }, 30_000);

  it("§5.2 ★★★ `cauNoiCli.ts` KHÔNG tự đọc biến danh sách gốc — nó đi qua `phanGiaiGoc`", () => {
    const src = fs.readFileSync(FILE.find((f) => TEN(f) === "cauNoiCli.ts")!, "utf8");
    // Chuỗi tên biến chỉ được phép xuất hiện trong VĂN XUÔI (thông điệp lỗi), không trong một
    // lượt đọc `process.env` — quét AST cho chắc.
    const sf = nguon(FILE.find((f) => TEN(f) === "cauNoiCli.ts")!);
    const docEnv: string[] = [];
    const di = (n: ts.Node): void => {
      if (
        ts.isPropertyAccessExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        ts.isIdentifier(n.expression.expression) &&
        n.expression.expression.text === "process" &&
        n.expression.name.text === "env"
      ) {
        docEnv.push(n.name.text);
      }
      if (
        ts.isElementAccessExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        ts.isIdentifier(n.expression.expression) &&
        n.expression.expression.text === "process" &&
        n.expression.name.text === "env"
      ) {
        const a = n.argumentExpression;
        docEnv.push(ts.isStringLiteral(a) ? a.text : "<động>");
      }
      n.forEachChild(di);
    };
    di(sf);
    // ★ Đúng MỘT lượt ghi env: chốt VRAM. Không lượt ĐỌC nào.
    expect(docEnv).toEqual(["LLAMA_SERVER_STRICT"]);
    expect(src.includes("phanGiaiGoc")).toBe(true);
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // §6 — CHỐT VRAM Ở CẢ HAI ĐIỂM VÀO
  // ════════════════════════════════════════════════════════════════════════════════════════════
  it("§6 ★★ `chotAnToanTienTrinh()` được gọi ở CẢ BA đường vào (vỏ chạy · CLI · MCP)", () => {
    const file = new Set(moiDiemGoi("chotAnToanTienTrinh").map((d) => d.file));
    expect([...file].sort()).toEqual(["batDau.ts", "cli.ts", "mcpServer.ts"]);
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // §7 — DANH TÍNH: KHÔNG CÓ CỬA THỨ HAI DỰNG NÊN MỘT `userId`
  // ════════════════════════════════════════════════════════════════════════════════════════════
  it("§7 ★★★ `user: { id: … }` của `ToolExecContext` chỉ dựng được từ `danhTinh.userId`", () => {
    const p = FILE.find((f) => TEN(f) === "cauNoiCli.ts")!;
    const sf = nguon(p);
    const nguonId: string[] = [];
    const di = (n: ts.Node): void => {
      if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "id") {
        nguonId.push(n.initializer.getText(sf));
      }
      n.forEachChild(di);
    };
    di(sf);
    // Hai chỗ: `execCtx.user.id` lúc mở phiên, và `CopilotUser.id` lúc duyệt (lấy LẠI từ phiên).
    expect(nguonId.sort()).toEqual(["p.danhTinh.userId", "phien.execCtx.user.id"]);
  });

  it("§7.2 ★★★ `moPhienCli` KHÔNG có quá tải nào nhận `userId` trần", () => {
    const src = fs.readFileSync(FILE.find((f) => TEN(f) === "cauNoiCli.ts")!, "utf8");
    const sf = nguon(FILE.find((f) => TEN(f) === "cauNoiCli.ts")!);
    let oThamSo = "";
    const di = (n: ts.Node): void => {
      if (ts.isFunctionDeclaration(n) && n.name?.text === "moPhienCli") {
        oThamSo = n.parameters.map((x) => x.getText(sf)).join(" | ");
      }
      n.forEachChild(di);
    };
    di(sf);
    expect(oThamSo).toContain("danhTinh: DanhTinhCli");
    expect(/userId\s*[?:]/.test(oThamSo), "không được có ô userId trần trong tham số").toBe(false);
    expect(src.includes("import type { DanhTinhCli }")).toBe(true);
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // §8 — HỘP THƯ ĐỀ XUẤT: "KHÔNG ĐỌC ĐƯỢC" ≠ "KHÔNG CÓ GÌ"
  // ════════════════════════════════════════════════════════════════════════════════════════════
  /**
   * ★★★ 2026-08-23 — **ĐỘT BIẾN M-D SỐNG SÓT, VÀ ĐÓ LÀ CÁCH CA NÀY RA ĐỜI.** Đổi
   * `if (!db) throw …` thành `if (!db) return []` trong `listPendingActionsForUser` ⇒ **38/38 vẫn
   * XANH**. Tức đúng cái tôi vừa viết hẳn một đoạn giải thích ("trả rỗng là nói dối") lại **không
   * có phép đo nào**, và một người sau hoàn toàn có thể "dọn dẹp" nó đi mà không cổng nào kêu.
   *
   * Hậu quả của bản đột biến ấy: CSDL vắng ⇒ CLI in *"(không có đề xuất nào đang chờ bạn duyệt)"*
   * cho một người ĐANG có đề xuất chờ thật — cùng lớp *"cổng chạy đúng mà báo cáo sai"* đã phải vá
   * hai lần trong doc này (`ConfirmResult.ok`, nhãn `CMD_TIMEOUT`).
   *
   * ⚠ Phát biểu bằng **AST trên nhánh `!db`** chứ không bằng một lượt chạy: mô phỏng "CSDL vắng"
   *   đòi mock `getDb`, mà `cliVongThat.test.ts` cố ý dùng **CSDL THẬT** — mock nó ở đó là gỡ mất
   *   chính thứ đang được đo ở 37 ca còn lại.
   */
  it("§8 ★★★ hai hàm hộp thư: nhánh CSDL-vắng phải NÉM, tuyệt đối không `return`", () => {
    const p = path.resolve(GOC, "..", "aiCopilotActions.ts");
    const sf = nguon(p);
    const CAN = ["listPendingActionsForUser", "getPendingActionForUser"];
    const thay: string[] = [];
    const di = (n: ts.Node): void => {
      if (
        (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) &&
        n.name !== undefined &&
        CAN.includes(n.name.getText())
      ) {
        const ten = n.name.getText();
        thay.push(ten);
        // Tìm mọi `if (!db) …` trong thân hàm và soi nhánh THEN của nó.
        const soi = (m: ts.Node): void => {
          if (ts.isIfStatement(m) && /^!\s*db$/.test(m.expression.getText().trim())) {
            const than = m.thenStatement.getText();
            expect(
              /\bthrow\b/.test(than),
              `${ten}: nhánh "CSDL vắng" phải NÉM. Trả về một giá trị bình thường ở đây là nói với ` +
                `người dùng "không có đề xuất nào" trong khi sự thật là "không đọc được" — hai câu ` +
                `có hậu quả NGƯỢC nhau.`,
            ).toBe(true);
            expect(/\breturn\b/.test(than), `${ten}: nhánh "CSDL vắng" KHÔNG được \`return\``).toBe(false);
          }
          m.forEachChild(soi);
        };
        soi(n);
      }
      n.forEachChild(di);
    };
    di(sf);
    // ⚠ Chống tự thoả: không tìm thấy hàm nào thì mọi `expect` bên trên không hề chạy.
    expect(thay.sort(), "phải TÌM THẤY cả hai hàm — nếu chúng bị đổi tên, ca này im lặng hoá vô nghĩa").toEqual(CAN.slice().sort());
  });
});
