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
  vramStateShapeProblems,
  vramStateShapeUsable,
  VRAM_READ_SURFACE_NOTICE,
  VRAM_STATE_REQUIRED_PATHS,
  VRAM_STATE_GUARDED_PATHS,
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
      vramReadSurfaceKind({ isLoading: false, isError: true, errorCode: "FORBIDDEN", hasData: false, shapeUsable: false }),
    ).toBe("denied");
  });

  it("★★★ ĐANG LỖI mà vẫn còn dữ liệu CŨ ⇒ vẫn `denied` — `isError` thắng TRƯỚC `hasData`", () => {
    // ⚠ Chiều đắt: react-query giữ `data` của lượt trước khi lượt sau hỏng. Đọc `hasData` trước
    // `isError` ⇒ màn tiếp tục in số CŨ như thể vẫn còn quyền. Số cũ là một lời khẳng định.
    expect(
      vramReadSurfaceKind({ isLoading: false, isError: true, errorCode: "FORBIDDEN", hasData: true, shapeUsable: true }),
    ).toBe("denied");
  });

  it("★★ lỗi KHÁC (mã lạ / mạng / `null`) ⇒ `unreadable` — KHÔNG bịa ra chẩn đoán 'thiếu quyền'", () => {
    for (const code of ["INTERNAL_SERVER_ERROR", "TIMEOUT", "", null]) {
      expect(
        vramReadSurfaceKind({ isLoading: false, isError: true, errorCode: code, hasData: false, shapeUsable: false }),
        `mã ${String(code)}`,
      ).toBe("unreadable");
    }
  });

  it("có dữ liệu, không lỗi ⇒ `ready`", () => {
    expect(vramReadSurfaceKind({ isLoading: false, isError: false, errorCode: null, hasData: true, shapeUsable: true })).toBe(
      "ready",
    );
  });

  it("đang tải thật ⇒ `loading`", () => {
    expect(vramReadSurfaceKind({ isLoading: true, isError: false, errorCode: null, hasData: false, shapeUsable: false })).toBe(
      "loading",
    );
  });

  /**
   * ★★★ ĐÂY LÀ Ô ĐÃ CHO KHUNG XƯƠNG QUAY MÃI MÃI.
   * `isLoading === false`, `isError === false`, `data === undefined` — bản cũ viết
   * `state.isLoading || !s ? <Skeleton/>` nên vế thứ hai giữ khung xương **vĩnh viễn**.
   */
  it("★★★ hết tải, KHÔNG lỗi, VẪN không dữ liệu ⇒ `unreadable` — TUYỆT ĐỐI không `loading`", () => {
    expect(
      vramReadSurfaceKind({ isLoading: false, isError: false, errorCode: null, hasData: false, shapeUsable: false }),
    ).toBe("unreadable");
  });

  it("★★ VÉT CẠN: mọi tổ hợp của NĂM ô đều ra một trong ĐÚNG bốn phạm trù, không `undefined` nào lọt", () => {
    const HOP_LE: readonly VramReadSurfaceKind[] = ["ready", "loading", "denied", "unreadable"];
    const thay = new Set<string>();
    for (const isLoading of [true, false])
      for (const isError of [true, false])
        for (const errorCode of ["FORBIDDEN", "INTERNAL_SERVER_ERROR", null])
          for (const hasData of [true, false])
            for (const shapeUsable of [true, false]) {
              // ★★★ C-1 — ô thứ NĂM: `shapeUsable`. Vét cạn phải chạy trên nó, nếu không phạm trù
              //   "có dữ liệu nhưng KHÔNG đọc được hình dạng" là một ô chưa ai đi qua.
              const k = vramReadSurfaceKind({ isLoading, isError, errorCode, hasData, shapeUsable });
              expect(
                HOP_LE,
                `${String(isLoading)}/${String(isError)}/${String(errorCode)}/${String(hasData)}/${String(shapeUsable)}`,
              ).toContain(k);
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

// ══════════════════════════════════════════════════════════════════════════════════════════════
// TẦNG 3 — ★★★ C-1 (review TOÀN NHÁNH Pha 6): **HÌNH DẠNG PAYLOAD.**
//
// ⚠⚠⚠ VÌ SAO TẦNG NÀY TỒN TẠI: `tsc` BIÊN DỊCH CẢ HAI ĐẦU CÙNG LÚC; SẢN XUẤT THÌ KHÔNG.
// Task 2 đổi `headroom.effectiveBytes` → `headroom.effective.{…}`. Cả **bốn** đột biến của Task 2
// chạy **trong hệ kiểu**; không cái nào hỏi *"một người tiêu thụ **đã biên dịch TRƯỚC** đọc payload
// này thì sao"* — mà đó là **định nghĩa** của một thay đổi phá vỡ. Hậu quả đo được trên máy này:
// `s.headroom.effective === undefined` ⇒ `TypeError` ⇒ vì `VramBrokerPanel` **không** có boundary
// riêng ở `AIBrainDashboard`, throw leo lên boundary CẤP TRANG ⇒ **cả `/ai-brain` trắng**.
//
// Hai vế được canh ở đây:
//   (a) payload sai hình dạng ⇒ rơi vào **từ vựng đã có** (`unreadable`), KHÔNG thành `"ready"`;
//   (b) **lượng từ ∀ trên chính mã render**: mọi đường truy cập TRUNG GIAN của mọi người tiêu thụ
//       phải có mặt ở `VRAM_STATE_REQUIRED_PATHS` **hoặc** `VRAM_STATE_GUARDED_PATHS`. Một
//       `s.x.y.z` mới mà quên khai ⇒ ĐỎ, không im lặng thành `TypeError` trên bản đang phục vụ.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Ảnh chụp **ĐỦ HÌNH DẠNG** của bản HÔM NAY — nền của mọi ca dưới. Chỉ các NÚT là load-bearing. */
function anhChupDu(): Record<string, unknown> {
  return {
    atMs: 1,
    processKey: "p#1",
    headroom: {
      rawBytes: 1,
      effective: { bytesAtReadMs: 1, readMark: "p#1", readAtMs: 1, notAnInvariant: true },
      basis: "measured",
      blind: false,
      trusted: true,
      degradedReasons: [],
      usedBytes: 1,
      ceilingBytes: 2,
    },
    ledger: { localBytes: 0, localHolders: [], foreign: { known: false, meaning: "x" }, totalBytes: 0 },
    unledgered: { estimateBytes: 0, estimateUsable: true, unknownCount: 0, beginFailureCount: 0, lastReason: null },
    unattributed: { bytes: 0, excludesBaselineBytes: true, knownSiteRowCount: 1, wiredSiteCount: 1 },
    baseline: { verified: true, unverifiedReasons: null, origin: null },
    defer: { scope: "this-process", hosts: [] },
    nonFiniteFields: [],
  };
}

/** Payload của bản máy chủ **TRƯỚC Task 2** — đúng thứ đang phát trên máy này khi review đo. */
function anhChupCu(): Record<string, unknown> {
  const s = anhChupDu();
  const h = { ...(s.headroom as Record<string, unknown>) };
  delete h.effective;
  h.effectiveBytes = 12345; // ← ô CŨ
  s.headroom = h;
  return s;
}

describe("★★★ C-1 — payload SAI HÌNH DẠNG không được làm trắng trang", () => {
  it("★★★ ĐỘT BIẾN HÌNH DẠNG: payload CŨ (thiếu ô `effective`) ⇒ `unreadable`, TUYỆT ĐỐI không `ready`", () => {
    const loi = vramStateShapeProblems(anhChupCu());
    expect(loi, "payload thiếu `headroom.effective` phải bị NÊU ĐÍCH DANH").toContain("headroom.effective");
    const k = vramReadSurfaceKind({
      isLoading: false,
      isError: false,
      errorCode: null,
      hasData: true,
      shapeUsable: vramStateShapeUsable(anhChupCu()),
    });
    // ⚠ `"ready"` ở đây **CHÍNH LÀ** lỗi: nó là giấy phép cho phần thân truy cập sâu ⇒ `TypeError`
    //   ⇒ boundary CẤP TRANG ⇒ trang trắng. Ca này đỏ đúng lúc trang sẽ trắng.
    expect(k, "có dữ liệu mà KHÔNG đọc được hình dạng ⇒ phải nói 'chưa đọc được', không được render").toBe(
      "unreadable",
    );
  });

  it("★★★ ĐỐI CHỨNG DƯƠNG — ảnh chụp ĐỦ hình dạng ⇒ 0 lỗi và `ready` (bản vá KHÔNG chặn hết)", () => {
    expect(vramStateShapeProblems(anhChupDu())).toEqual([]);
    expect(
      vramReadSurfaceKind({
        isLoading: false,
        isError: false,
        errorCode: null,
        hasData: true,
        shapeUsable: vramStateShapeUsable(anhChupDu()),
      }),
    ).toBe("ready");
  });

  it("★★★ KHÔNG BẮT NHẦM — ô `null`/vắng HỢP LỆ (đã khai ở `VRAM_STATE_GUARDED_PATHS`) vẫn `ready`", () => {
    /**
     * ⚠ Không có ca này thì một bản vá **chặn hết** cũng xanh, và `/ai-brain` sẽ nói *"chưa đọc
     * được"* **mãi mãi** ở đúng cấu hình bình thường: `foreign.known === false` là trạng thái
     * THẬT (chưa làm mới sổ chung lần nào) và `lastReason`/`unverifiedReasons` `null` là mặc định.
     */
    const s = anhChupDu();
    (s.ledger as Record<string, unknown>).foreign = { known: false, meaning: "never-refreshed-blind-to-siblings" };
    (s.unledgered as Record<string, unknown>).lastReason = null;
    (s.baseline as Record<string, unknown>).unverifiedReasons = null;
    expect(vramStateShapeProblems(s), "ba ô này CÓ QUYỀN vắng/null — panel tự canh").toEqual([]);
  });

  it("★★ đầu vào rác (`null`/số/chuỗi/bool/`undefined`) ⇒ nêu lỗi, KHÔNG ném", () => {
    for (const x of [null, undefined, 0, "x", true]) {
      expect(vramStateShapeProblems(x).length, `đầu vào ${String(x)}`).toBeGreaterThan(0);
      expect(vramStateShapeUsable(x), `đầu vào ${String(x)}`).toBe(false);
    }
  });

  it("★★ cầu chì — hai bảng đường KHÔNG rỗng và KHÔNG giao nhau", () => {
    expect(VRAM_STATE_REQUIRED_PATHS.length).toBeGreaterThanOrEqual(8);
    const canh = Object.keys(VRAM_STATE_GUARDED_PATHS);
    expect(canh.length).toBeGreaterThanOrEqual(1);
    expect(
      VRAM_STATE_REQUIRED_PATHS.filter((d) => canh.includes(d)),
      "một đường không thể vừa BẮT BUỘC vừa CÓ CANH RIÊNG",
    ).toEqual([]);
    // ⚠ Mỗi đường CÓ-CANH-RIÊNG phải kèm **lý do có chữ** — một cửa miễn trừ không lý do là một cửa.
    for (const [d, ly] of Object.entries(VRAM_STATE_GUARDED_PATHS)) {
      expect(ly.trim().length, `${d} phải nêu LÝ DO nó được canh riêng`).toBeGreaterThan(15);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ C-1 (b) — LƯỢNG TỪ ∀ TRÊN CHÍNH MÃ RENDER
//
// ⚠⚠ Một bảng đường viết tay là một danh sách, và *"cái gì LIỆT KÊ thì luôn có phần tử thứ N+1"*.
// Cầu chì dưới đây **suy tập ra khỏi mã**: mọi chuỗi truy cập bắt nguồn từ biến giữ payload
// (`const s = state.data` · `const vb = vramState.data`, tìm trên CÂY chứ không đoán theo tên), và
// mọi **tiền tố TRUNG GIAN** của chúng — nút bị truy cập tiếp, hoặc bị spread — phải có mặt ở một
// trong hai bảng. Thêm `s.foo.bar` mới mà quên khai ⇒ **ĐỎ**.
//
// ⚠ Phạm vi được nói thẳng: cầu chì này canh chuỗi bắt nguồn từ **gốc payload**. Chuỗi bắt nguồn
//   từ một phần tử mảng trong `.map((h) => h.reclaim.kind)` **KHÔNG** thuộc phạm vi — `h` không
//   phải gốc payload. Đó là một ô còn mở, không phải một ô được coi là đã đóng.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Định danh của biến giữ **payload** (`const s = <bienQuery>.data`). Tìm trên CÂY. */
function tenBienPayload(sf: ts.SourceFile, bienQuery: string): string[] {
  const ra: string[] = [];
  for (const n of moiNut(sf)) {
    if (!ts.isVariableDeclaration(n) || n.initializer === undefined || !ts.isIdentifier(n.name)) continue;
    const kt = n.initializer;
    if (!ts.isPropertyAccessExpression(kt) || kt.name.text !== "data") continue;
    const goc = ts.isNonNullExpression(kt.expression) ? kt.expression.expression : kt.expression;
    if (ts.isIdentifier(goc) && goc.text === bienQuery) ra.push(n.name.text);
  }
  return ra;
}

/** Chuỗi `a.b.c` (bỏ `?.`, bỏ `!`) bắt nguồn từ `goc` → `"b.c"`; `null` nếu không phải chuỗi ấy. */
function duongTuGoc(n: ts.PropertyAccessExpression, goc: string): string | null {
  const doan: string[] = [];
  let cur: ts.Node = n;
  for (;;) {
    if (ts.isPropertyAccessExpression(cur)) {
      doan.unshift(cur.name.text);
      cur = cur.expression;
    } else if (ts.isNonNullExpression(cur) || ts.isParenthesizedExpression(cur)) {
      cur = cur.expression;
    } else break;
  }
  return ts.isIdentifier(cur) && cur.text === goc ? doan.join(".") : null;
}

describe("★★★ C-1 (b) — ∀ đường truy cập TRUNG GIAN trên payload VRAM phải được KHAI", () => {
  for (const { ten, duong } of NGUOI_DOC) {
    it(`★★★ ${ten}: mọi nút bị truy cập sâu / bị spread phải có ở BẮT BUỘC hoặc CÓ-CANH-RIÊNG`, () => {
      const sf = ast(duong);
      const bienQuery = tenBienQuery(sf);
      expect(bienQuery, `${ten}: không tìm thấy lời gọi trpc.vram.state.useQuery`).not.toBeNull();
      const goc = tenBienPayload(sf, bienQuery!);
      expect(
        goc.length,
        `${ten}: không tìm thấy biến giữ payload (\`const x = ${bienQuery!}.data\`)`,
      ).toBeGreaterThan(0);

      /** Mọi đường đầy đủ mà file này đọc, gộp cả hai (hoặc nhiều) biến payload. */
      const duongDay = new Set<string>();
      /** Nút bị spread — `[...s.ledger.localHolders]` ném `TypeError` nếu ô ấy vắng. */
      const biTrai = new Set<string>();
      for (const n of moiNut(sf)) {
        if (ts.isPropertyAccessExpression(n)) {
          for (const g of goc) {
            const d = duongTuGoc(n, g);
            if (d !== null && d !== "") duongDay.add(d);
          }
          continue;
        }
        if (ts.isSpreadElement(n) && ts.isPropertyAccessExpression(n.expression)) {
          for (const g of goc) {
            const d = duongTuGoc(n.expression, g);
            if (d !== null && d !== "") biTrai.add(d);
          }
        }
      }
      expect(duongDay.size, `${ten}: 0 đường truy cập ⇒ ca này là chân lý rỗng`).toBeGreaterThan(1);

      /** TRUNG GIAN = tiền tố THẬT SỰ của một đường dài hơn, hoặc bị spread. */
      const trungGian = new Set<string>(biTrai);
      for (const d of duongDay) {
        const doan = d.split(".");
        for (let i = 1; i < doan.length; i++) trungGian.add(doan.slice(0, i).join("."));
      }

      const khai = new Set<string>([...VRAM_STATE_REQUIRED_PATHS, ...Object.keys(VRAM_STATE_GUARDED_PATHS)]);
      /**
       * ⚠ Bỏ đoạn cuối là **tên phương thức** (`.map`/`.join`/`.length`/…): `headroom.degradedReasons
       * .map` cho tiền tố `headroom.degradedReasons` — đó mới là nút. Bản thân `….map` là một HÀM,
       * không phải một nút dữ liệu.
       */
      const PHUONG_THUC =
        /\.(map|filter|join|length|some|every|slice|includes|find|sort|flatMap|toFixed|toLocaleString)$/;
      const thieu = [...trungGian].filter((d) => !khai.has(d) && !PHUONG_THUC.test(d)).sort();
      expect(
        thieu.join(" · "),
        `${ten}: đường TRUNG GIAN chưa khai ⇒ một payload thiếu ô ấy sẽ ném TypeError và làm TRẮNG cả trang. Khai ở VRAM_STATE_REQUIRED_PATHS (kiểm ở runtime) hoặc VRAM_STATE_GUARDED_PATHS (kèm lý do)`,
      ).toBe("");
    });

    it(`★★★ ${ten}: ô \`shapeUsable\` PHẢI đến từ \`vramStateShapeUsable(...)\`, không phải một hằng`, () => {
      /**
       * ⚠ `tsc` đã ép **có** ô ấy (kiểu bắt buộc), nhưng `shapeUsable: true` cũng biên dịch được và
       * nó **khôi phục nguyên vẹn** lỗi C-1. Cổng này neo vào **GIÁ TRỊ**, không vào sự có mặt.
       */
      const sf = ast(duong);
      const goi = moiNut(sf).filter(
        (n): n is ts.CallExpression => ts.isCallExpression(n) && n.expression.getText(sf) === "vramReadSurfaceKind",
      );
      expect(goi.length, `${ten}: phải gọi vramReadSurfaceKind đúng 1 lần`).toBe(1);
      const arg = goi[0]!.arguments[0];
      expect(arg !== undefined && ts.isObjectLiteralExpression(arg), `${ten}: đối số phải là object literal`).toBe(true);
      const o = (arg as ts.ObjectLiteralExpression).properties.find(
        (p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === "shapeUsable",
      );
      expect(o !== undefined, `${ten}: thiếu ô shapeUsable`).toBe(true);
      expect(
        (o as ts.PropertyAssignment).initializer.getText(sf),
        `${ten}: shapeUsable phải là một PHÉP ĐO trên payload, không phải một hằng`,
      ).toContain("vramStateShapeUsable(");
    });
  }
});
