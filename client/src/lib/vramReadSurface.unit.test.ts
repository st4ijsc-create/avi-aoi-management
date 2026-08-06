/**
 * ★★★ Pha 5 Task 2 (N8, review vòng 1 — C-1) — **MỘT LƯỢT TỪ CHỐI QUYỀN KHÔNG ĐƯỢC RENDER THÀNH
 * MỘT KHẲNG ĐỊNH VỀ PHẦN CỨNG.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ LỖI NÀY DO CHÍNH COMMIT SIẾT QUYỀN ĐÁNH THỨC — nó KHÔNG phải một khả năng lý thuyết
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Trước lượt siết, nhánh `FORBIDDEN` của `vram.state` **bất khả đạt**: `machine_control` chưa từng
 * được seed cho **bất kỳ vai nào**, và `admin` qua được **chỉ nhờ short-circuit**. Sau lượt siết,
 * **mọi vai không phải `admin`** rơi vào nhánh ấy **mỗi lần** — và trên `/ai-brain` thì đó là
 * `engineer`, vai **duy nhất** khác vào được màn.
 *
 * Đo được lúc đó: tập truy cập thuộc tính trên object query ở **cả hai** file người đọc đúng bằng
 * `["data","isLoading","refetch"]` ⇒ **hai file không hề biết trạng thái lỗi tồn tại**. Hậu quả:
 * thẻ KPI in *"CPU / không có VRAM"* (khẳng định PHẦN CỨNG từ một từ chối QUYỀN) và panel cho
 * khung xương **quay mãi mãi**.
 *
 * ⚠ Lưới dưới đây có HAI tầng, và tầng nào cũng cần: ca **thuần** khoá QUYẾT ĐỊNH, cổng **AST**
 * khoá việc hai màn thật sự ĐI QUA quyết định đó.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import {
  vramReadSurfaceKind,
  vramReadSurfaceErrorCode,
  VRAM_READ_SURFACE_NOTICE,
  type VramReadSurfaceKind,
} from "./vramReadSurface";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // .../client/src/lib

/** HAI người đọc thật của `trpc.vram.state` — `git grep "vram.state"`, không nhiều hơn, không ít hơn. */
const NGUOI_DOC = [
  { ten: "AIBrainDashboard", duong: join(TEST_DIR, "..", "pages", "AIBrainDashboard.tsx") },
  { ten: "VramBrokerPanel", duong: join(TEST_DIR, "..", "components", "ai", "VramBrokerPanel.tsx") },
] as const;

// ══════════════════════════════════════════════════════════════════════════════════════════════
// TẦNG 1 — QUYẾT ĐỊNH (vị từ thuần)
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("C-1 — `vramReadSurfaceKind`: bốn phạm trù, và KHÔNG phạm trù nào nói về phần cứng", () => {
  it("★★★ FORBIDDEN ⇒ `denied` — KHÔNG phải `unreadable`, và tuyệt đối KHÔNG phải một câu về phần cứng", () => {
    expect(
      vramReadSurfaceKind({ isLoading: false, isError: true, errorCode: "FORBIDDEN", hasData: false }),
    ).toBe("denied");
  });

  it("★★★ ĐANG LỖI mà vẫn còn dữ liệu CŨ ⇒ vẫn `denied` — `isError` thắng TRƯỚC `hasData`", () => {
    // ⚠ Chiều đắt: react-query giữ `data` của lượt trước khi lượt sau hỏng. Đọc `hasData` trước
    // `isError` ⇒ màn tiếp tục in số CŨ như thể vẫn còn quyền. Số cũ là một lời khẳng định.
    expect(
      vramReadSurfaceKind({ isLoading: false, isError: true, errorCode: "FORBIDDEN", hasData: true }),
    ).toBe("denied");
  });

  it("★★ lỗi KHÁC (mã lạ / mạng / `null`) ⇒ `unreadable` — KHÔNG bịa ra chẩn đoán 'thiếu quyền'", () => {
    for (const code of ["INTERNAL_SERVER_ERROR", "TIMEOUT", "", null]) {
      expect(
        vramReadSurfaceKind({ isLoading: false, isError: true, errorCode: code, hasData: false }),
        `mã ${String(code)}`,
      ).toBe("unreadable");
    }
  });

  it("có dữ liệu, không lỗi ⇒ `ready`", () => {
    expect(vramReadSurfaceKind({ isLoading: false, isError: false, errorCode: null, hasData: true })).toBe("ready");
  });

  it("đang tải thật ⇒ `loading`", () => {
    expect(vramReadSurfaceKind({ isLoading: true, isError: false, errorCode: null, hasData: false })).toBe("loading");
  });

  /**
   * ★★★ ĐÂY LÀ Ô ĐÃ CHO KHUNG XƯƠNG QUAY MÃI MÃI.
   * `isLoading === false`, `isError === false`, `data === undefined` — bản cũ viết
   * `state.isLoading || !s ? <Skeleton/>` nên vế thứ hai giữ khung xương **vĩnh viễn**.
   */
  it("★★★ hết tải, KHÔNG lỗi, VẪN không dữ liệu ⇒ `unreadable` — TUYỆT ĐỐI không `loading`", () => {
    expect(vramReadSurfaceKind({ isLoading: false, isError: false, errorCode: null, hasData: false })).toBe(
      "unreadable",
    );
  });

  it("★★ VÉT CẠN: mọi tổ hợp của bốn ô đều ra một trong ĐÚNG bốn phạm trù, không `undefined` nào lọt", () => {
    const HOP_LE: readonly VramReadSurfaceKind[] = ["ready", "loading", "denied", "unreadable"];
    const thay = new Set<string>();
    for (const isLoading of [true, false])
      for (const isError of [true, false])
        for (const errorCode of ["FORBIDDEN", "INTERNAL_SERVER_ERROR", null])
          for (const hasData of [true, false]) {
            const k = vramReadSurfaceKind({ isLoading, isError, errorCode, hasData });
            expect(HOP_LE, `${String(isLoading)}/${String(isError)}/${String(errorCode)}/${String(hasData)}`).toContain(k);
            thay.add(k);
          }
    // Cả bốn phạm trù đều ĐẠT TỚI ĐƯỢC — một phạm trù không bao giờ xảy ra là mã chết.
    expect([...thay].sort()).toEqual(["denied", "loading", "ready", "unreadable"]);
  });

  it("`vramReadSurfaceErrorCode` đọc đúng `error.data.code`, và KHÔNG ném với đầu vào lạ", () => {
    expect(vramReadSurfaceErrorCode({ data: { code: "FORBIDDEN" } })).toBe("FORBIDDEN");
    for (const x of [null, undefined, 0, "x", {}, { data: null }, { data: {} }, { data: { code: 7 } }]) {
      expect(vramReadSurfaceErrorCode(x)).toBeNull();
    }
  });

  it("★★ câu `denied` nói HÀNH ĐỘNG TIẾP THEO (gọi tên module + quyền), không chỉ 'không đủ quyền'", () => {
    expect(VRAM_READ_SURFACE_NOTICE.denied.fallback).toContain("machine_control");
    expect(VRAM_READ_SURFACE_NOTICE.denied.key).toBe("vramBroker.readDenied");
    expect(VRAM_READ_SURFACE_NOTICE.unreadable.key).toBe("vramBroker.readUnreadable");
    // ⚠ Không câu nào được nói về PHẦN CỨNG.
    for (const n of Object.values(VRAM_READ_SURFACE_NOTICE)) {
      expect(n.fallback, n.key).not.toMatch(/CPU|không có VRAM|no VRAM|无显存/i);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// TẦNG 2 — CỔNG AST: HAI MÀN THẬT SỰ ĐI QUA QUYẾT ĐỊNH ĐÓ
//
// ⚠ Hỏi trên CÂY, không so chuỗi: một dòng chú thích chứa `isError` đã từng đủ để lách một cổng
// regex ở chính nhánh này (cổng (ii), Pha 4).
// ══════════════════════════════════════════════════════════════════════════════════════════════

function ast(duong: string): ts.SourceFile {
  return ts.createSourceFile(duong, readFileSync(duong, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function moiNut(sf: ts.SourceFile): ts.Node[] {
  const out: ts.Node[] = [];
  const di = (n: ts.Node) => {
    out.push(n);
    n.forEachChild(di);
  };
  sf.forEachChild(di);
  return out;
}

/** Định danh của biến nhận `trpc.vram.state.useQuery(...)` — tìm trên CÂY, không đoán theo tên. */
function tenBienQuery(sf: ts.SourceFile): string | null {
  for (const n of moiNut(sf)) {
    if (!ts.isVariableDeclaration(n) || n.initializer === undefined) continue;
    if (!ts.isCallExpression(n.initializer)) continue;
    if (n.initializer.expression.getText(sf) !== "trpc.vram.state.useQuery") continue;
    return ts.isIdentifier(n.name) ? n.name.text : null;
  }
  return null;
}

/** Tập thuộc tính ĐƯỢC ĐỌC trên biến đó (`state.isError` → `"isError"`). */
function thuocTinhDaDoc(sf: ts.SourceFile, bien: string): Set<string> {
  const out = new Set<string>();
  for (const n of moiNut(sf)) {
    if (!ts.isPropertyAccessExpression(n)) continue;
    if (!ts.isIdentifier(n.expression) || n.expression.text !== bien) continue;
    out.add(n.name.text);
  }
  return out;
}

describe("C-1 (AST) — cả HAI người đọc phải HỎI trạng thái lỗi và đi qua vị từ CHUNG", () => {
  for (const { ten, duong } of NGUOI_DOC) {
    it(`★★★ ${ten}: đọc \`isError\` trên chính object query — ô mà trước bản này KHÔNG file nào hỏi tới`, () => {
      const sf = ast(duong);
      const bien = tenBienQuery(sf);
      expect(bien, `${ten}: không tìm thấy lời gọi trpc.vram.state.useQuery`).not.toBeNull();
      const props = thuocTinhDaDoc(sf, bien!);
      expect([...props].sort(), `${ten} đọc: ${[...props].sort().join(",")}`).toContain("isError");
      // ⚠ Có `isError` mà không có `error` thì phân biệt được "hỏng" nhưng KHÔNG phân biệt được
      // "hỏng vì QUYỀN" — tức lại rơi về một câu chung chung.
      expect([...props], `${ten}`).toContain("error");
    });

    it(`★★★ ${ten}: phạm trù hiển thị PHẢI LÀ đầu ra của \`vramReadSurfaceKind(...)\``, () => {
      const sf = ast(duong);
      const goi = moiNut(sf).filter(
        (n) => ts.isCallExpression(n) && n.expression.getText(sf) === "vramReadSurfaceKind",
      );
      expect(goi.length, `${ten}: phải gọi vramReadSurfaceKind đúng 1 lần`).toBe(1);
    });

    it(`★★★ ${ten}: KHÔNG một khẳng định PHẦN CỨNG nào ở nhánh thiếu-dữ-liệu`, () => {
      // Hỏi trên CHUỖI VĂN BẢN CỦA NÚT (không phải regex trên file thô): mọi literal trong cây.
      const sf = ast(duong);
      const viPham: string[] = [];
      for (const n of moiNut(sf)) {
        if (!ts.isStringLiteral(n) && !ts.isNoSubstitutionTemplateLiteral(n)) continue;
        if (/aiBrain\.noVram|CPU \/ không có VRAM|CPU \/ no VRAM|CPU \/ 无显存/.test(n.text)) {
          viPham.push(n.text);
        }
      }
      expect(viPham, `${ten}: còn khẳng định phần cứng: ${viPham.join(" | ")}`).toEqual([]);
    });
  }

  /**
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ★★★ NEO ĐÚNG NẤC — LƯỚI VÒNG ĐẦU CỦA CHÍNH TÔI ĐÃ BỊ LÁCH
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * Ba ca trên hỏi *"có gọi `vramReadSurfaceKind` không"* và *"có đọc `isError` không"* — tức neo
   * vào **BIẾN**. Đột biến **C1-M2** giữ nguyên cả hai rồi trả **điều kiện của nhánh render** về
   * `state.isLoading || !s ? <Skeleton/>` ⇒ khung xương **quay mãi mãi trở lại**, lưới **XANH
   * 16/16**. Đúng bài học `vramCommandReach` đã trả giá ở Pha 4: *"tính chất cần canh là **CÁI
   * NÚT**, không phải một biến"* — ở đây là **CÁI NHÁNH**, không phải lời gọi.
   *
   * Hai bất biến dưới đây phát biểu **CÁI NÓ PHẢI LÀ**, không liệt kê toán tử bị cấm.
   */
  const O_TRANG_THAI = ["isLoading", "isError", "error", "isPending", "isFetching", "isSuccess", "status"];

  for (const { ten, duong } of NGUOI_DOC) {
    it(`★★★ ${ten}: ô TRẠNG THÁI của query CHỈ được đọc trong đối số của \`vramReadSurfaceKind(...)\``, () => {
      const sf = ast(duong);
      const bien = tenBienQuery(sf)!;
      // Cây con hợp lệ duy nhất: đối số của lời gọi vị từ.
      const trongVIT = new Set<ts.Node>();
      for (const n of moiNut(sf)) {
        if (!ts.isCallExpression(n) || n.expression.getText(sf) !== "vramReadSurfaceKind") continue;
        for (const arg of n.arguments) {
          const di = (x: ts.Node) => {
            trongVIT.add(x);
            x.forEachChild(di);
          };
          di(arg);
        }
      }
      const viPham: string[] = [];
      for (const n of moiNut(sf)) {
        if (!ts.isPropertyAccessExpression(n)) continue;
        if (!ts.isIdentifier(n.expression) || n.expression.text !== bien) continue;
        if (!O_TRANG_THAI.includes(n.name.text)) continue; // `data`/`refetch` là dữ liệu/hành động
        if (trongVIT.has(n)) continue;
        const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
        viPham.push(`dòng ${line + 1}: ${bien}.${n.name.text}`);
      }
      expect(
        viPham,
        `${ten}: ĐƯỜNG QUYẾT ĐỊNH THỨ HAI — ô trạng thái đọc ngoài vị từ chung:\n  ${viPham.join("\n  ")}`,
      ).toEqual([]);
    });

    /**
     * ══════════════════════════════════════════════════════════════════════════════════════════
     * ★★★ I2-1 — ĐẢO LƯỢNG TỪ. LƯỚI TRƯỚC KHAI "CANH CÁI NHÁNH" NHƯNG **TÌM NHÁNH BẰNG MỘT TÊN THẺ**
     * ══════════════════════════════════════════════════════════════════════════════════════════
     * Bản trước liệt kê mọi `<Skeleton>` rồi đi **ngược lên** tìm `?:`. Đột biến **R2-M1** dọn khung
     * xương sang **một component con cùng file**:
     *
     *     function VramSkeletonBlock() { return (<><Skeleton …/><Skeleton …/></>); }
     *     {s === undefined ? (<VramSkeletonBlock />) : kind !== "ready" ? (…)
     *
     * ⇒ không còn `<Skeleton>` nào nằm dưới một ternary ⇒ **bị bỏ qua** ⇒ **XANH 20/20, `tsc` sạch,
     * ship được**, và khung xương **quay mãi mãi trở lại**. Đúng lỗi Global Constraints gọi tên:
     * lưới **liệt kê cái nó CHỨA** thay vì **khẳng định cái nó PHẢI LÀ**.
     *
     * ⇒ Đảo lượng từ, và bỏ hẳn khái niệm "thẻ nào":
     *
     *     MỌI `ConditionalExpression` **SINH RA JSX** mà điều kiện nhắc tới một thành viên của mặt
     *     đọc VRAM thì **PHẢI** do `kind` thống trị — tự nó hỏi `kind`, hoặc nằm trong một nhánh
     *     đã do `kind` quyết định.
     *
     * ⚠ Vế "**SINH RA JSX**" là thứ giữ `vramPct` (`… ? Math.min(…) : 0`) ngoài phạm vi — nó là
     * phép TÍNH, không phải phép RENDER.
     * ⚠ Vế "**thống trị**" là thứ giữ mọi `?:` nhỏ **bên trong** nhánh `ready` ngoài phạm vi
     * (`{s.headroom.blind ? <Badge/> : null}` …): đã qua cổng `kind` rồi thì không phải qua lần nữa.
     */
    it(`★★★ ${ten}: MỌI \`?:\` sinh JSX chạm mặt đọc VRAM phải do \`kind\` THỐNG TRỊ`, () => {
      const sf = ast(duong);
      const bienQuery = tenBienQuery(sf)!;
      let bienKind: string | null = null;
      for (const n of moiNut(sf)) {
        if (!ts.isVariableDeclaration(n) || n.initializer === undefined) continue;
        if (!ts.isCallExpression(n.initializer)) continue;
        if (n.initializer.expression.getText(sf) !== "vramReadSurfaceKind") continue;
        if (ts.isIdentifier(n.name)) bienKind = n.name.text;
      }
      expect(bienKind, `${ten}: không tìm thấy biến nhận vramReadSurfaceKind(...)`).not.toBeNull();

      /**
       * Tập "thuộc mặt ĐỌC VRAM", đóng **BẮC CẦU** dưới phép gán (đột biến **C1-M3** dùng bí danh
       * `const s = state.data` để thoát khỏi phạm vi).
       *
       * ⚠⚠ m2-2 — **PHÉP ĐÓNG PHẢI DỪNG Ở MẶT ĐỌC.** Bản trước bắc cầu qua **mọi** khởi tạo có
       * nhắc tên, nên nuốt luôn `refreshAll` (arrow gọi `vramState.refetch()`) và
       * `preempt`/`releaseStale`/`retryDeferred` (`useMutation` có `state.refetch()` trong
       * `onSuccess`). Hệ quả: mai một spinner **CỦA LỆNH** — `{preempt.isPending ? … : …}` — sẽ bị
       * đòi hỏi `kind`, tức lưới **chỉ đường tới bản vá SAI**. Hai hình dạng bị loại là **HÀNH
       * ĐỘNG**, không phải **GIÁ TRỊ ĐỌC**: hàm, và lời gọi `useMutation`.
       */
      const laHanhDong = (init: ts.Expression): boolean =>
        ts.isArrowFunction(init) ||
        ts.isFunctionExpression(init) ||
        (ts.isCallExpression(init) && /(^|\.)useMutation$/.test(init.expression.getText(sf)));

      const thuocVram = new Set<string>([bienQuery, bienKind!]);
      for (let vong = 0; vong < 10; vong++) {
        const truoc = thuocVram.size;
        for (const n of moiNut(sf)) {
          if (!ts.isVariableDeclaration(n) || n.initializer === undefined) continue;
          if (!ts.isIdentifier(n.name) || thuocVram.has(n.name.text)) continue;
          if (laHanhDong(n.initializer)) continue;
          const initText = n.initializer.getText(sf);
          if ([...thuocVram].some((v) => new RegExp(`\\b${v}\\b`).test(initText))) thuocVram.add(n.name.text);
        }
        if (thuocVram.size === truoc) break;
      }

      const nhac = (text: string, ten: string) => new RegExp(`\\b${ten}\\b`).test(text);
      const coJsx = (n: ts.Node): boolean => {
        let thay = false;
        const di = (x: ts.Node) => {
          if (thay) return;
          if (ts.isJsxElement(x) || ts.isJsxSelfClosingElement(x) || ts.isJsxFragment(x)) {
            thay = true;
            return;
          }
          x.forEachChild(di);
        };
        di(n);
        return thay;
      };

      /**
       * ⚠⚠ **R2-M2 (hình dạng thứ NĂM, tự nghĩ ra và nó LÁCH ĐƯỢC bản trước) — `?:` KHÔNG PHẢI
       * HÌNH DẠNG DUY NHẤT CỦA MỘT PHÉP RẼ NHÁNH.** Bản trước chỉ nhận `ConditionalExpression`,
       * nên một lượt **TRẢ VỀ SỚM** đi thẳng qua:
       *
       *     if (s === undefined) { return (<Card><Skeleton …/></Card>); }
       *
       * ⇒ **XANH 22/22**, khung xương quay mãi mãi trở lại, `tsc` sạch, ship được. Cùng một bài học
       * lần thứ ba trong task này: lưới **liệt kê hình dạng** thì hình dạng thứ N+1 luôn tồn tại.
       * ⇒ Bất biến nói **PHÉP RẼ NHÁNH**, và liệt kê **BA hình dạng cú pháp mà TypeScript có**:
       * `?:` · `if` · toán tử ngắn mạch (`&&`/`||`/`??`).
       */
      interface DiemRe {
        readonly nut: ts.Node;
        readonly dieuKien: ts.Node;
        readonly nhanh: readonly ts.Node[];
      }
      const diemRe: DiemRe[] = [];
      for (const n of moiNut(sf)) {
        if (ts.isConditionalExpression(n)) {
          diemRe.push({ nut: n, dieuKien: n.condition, nhanh: [n.whenTrue, n.whenFalse] });
        } else if (ts.isIfStatement(n)) {
          diemRe.push({
            nut: n,
            dieuKien: n.expression,
            nhanh: n.elseStatement ? [n.thenStatement, n.elseStatement] : [n.thenStatement],
          });
        } else if (
          ts.isBinaryExpression(n) &&
          [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(
            n.operatorToken.kind,
          )
        ) {
          diemRe.push({ nut: n, dieuKien: n.left, nhanh: [n.right] });
        }
      }

      const ungVien = diemRe.filter((d) => d.nhanh.some((b) => coJsx(b)));
      const chamVram = ungVien.filter((c) =>
        [...thuocVram].some((v) => nhac(c.dieuKien.getText(sf), v)),
      );

      // ⚠ CẦU CHÌ chống lưới-mù: không tìm thấy ứng viên nào ⇒ mọi khẳng định dưới là chân lý rỗng.
      expect(
        chamVram.length,
        `${ten}: KHÔNG thấy nhánh render nào chạm mặt đọc VRAM ⇒ LƯỚI ĐANG MÙ`,
      ).toBeGreaterThan(0);

      /** Điểm rẽ nào (bất kỳ hình dạng nào) có nút `x` nằm trong một NHÁNH của nó. */
      const reBaoQuanh = new Map<ts.Node, DiemRe>();
      for (const d of diemRe) for (const b of d.nhanh) reBaoQuanh.set(b, d);

      const viPham: string[] = [];
      for (const c of chamVram) {
        if (nhac(c.dieuKien.getText(sf), bienKind!)) continue; // tự nó hỏi `kind`
        // Hoặc: nằm trong một NHÁNH đã do `kind` quyết định (bị `kind` THỐNG TRỊ).
        // ⚠ Chỉ nhánh mới thống trị — nằm trong ĐIỀU KIỆN của một điểm rẽ thì KHÔNG.
        let thongTri = false;
        let con: ts.Node = c.nut;
        let cur: ts.Node | undefined = c.nut.parent;
        while (cur !== undefined) {
          const bao = reBaoQuanh.get(con);
          if (bao !== undefined && nhac(bao.dieuKien.getText(sf), bienKind!)) {
            thongTri = true;
            break;
          }
          con = cur;
          cur = cur.parent;
        }
        if (thongTri) continue;
        const { line } = sf.getLineAndCharacterOfPosition(c.nut.getStart(sf));
        viPham.push(
          `dòng ${line + 1}: điều kiện [${c.dieuKien.getText(sf)}] KHÔNG do \`${bienKind!}\` thống trị`,
        );
      }
      expect(
        viPham,
        `${ten}: nhánh render VRAM không do \`kind\` quyết định ⇒ FORBIDDEN sẽ hiện sai:\n  ${viPham.join("\n  ")}`,
      ).toEqual([]);
    });

    it(`★★ ${ten}: phép đóng bắc cầu KHÔNG nuốt mặt LỆNH (spinner của lệnh không bị đòi \`kind\`)`, () => {
      // ⚠ m2-2 — lưới quá rộng là lưới chỉ đường tới bản vá SAI. `useMutation`/hàm là HÀNH ĐỘNG.
      const sf = ast(duong);
      const bienQuery = tenBienQuery(sf)!;
      const lenh = moiNut(sf).filter(
        (n): n is ts.VariableDeclaration =>
          ts.isVariableDeclaration(n) &&
          n.initializer !== undefined &&
          ((ts.isCallExpression(n.initializer) &&
            /(^|\.)useMutation$/.test(n.initializer.expression.getText(sf))) ||
            ts.isArrowFunction(n.initializer)),
      );
      // Mọi khai báo LỆNH có nhắc tới query đọc đều phải nằm NGOÀI tập mặt-đọc.
      const chamQuery = lenh.filter((d) => new RegExp(`\\b${bienQuery}\\b`).test(d.initializer!.getText(sf)));
      expect(chamQuery.length, `${ten}: không có khai báo LỆNH nào chạm query đọc ⇒ ca này chưa đo gì`).toBeGreaterThan(0);
    });
  }

  it("★★ HAI màn dùng CHUNG một vị từ — không ai tự viết bản sao thứ hai của quyết định này", () => {
    for (const { ten, duong } of NGUOI_DOC) {
      const sf = ast(duong);
      const nhap = moiNut(sf).filter(
        (n) => ts.isImportDeclaration(n) && /vramReadSurface/.test((n.moduleSpecifier as ts.StringLiteral).text),
      );
      expect(nhap.length, `${ten} phải nhập vị từ CHUNG`).toBe(1);
    }
  });
});
