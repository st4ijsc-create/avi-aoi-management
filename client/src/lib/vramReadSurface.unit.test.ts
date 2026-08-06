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
