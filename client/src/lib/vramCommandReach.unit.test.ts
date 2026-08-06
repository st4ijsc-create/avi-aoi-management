/**
 * ★★★ Pha 4 Task 4 (review vòng 1, I-1) — **NÚT LỆNH KHÔNG ĐƯỢC HỨA NHIỀU HƠN LỆNH.**
 *
 * Bản đầu của `VramBrokerPanel` viết `retryReach === "reachable-here" || status === "deferring" || …`
 * ⇒ nút *"Thử lại ngay"* hiện cho **5/6 hộ** mà `vram.retryDeferred` **LUÔN** từ chối. Đó đúng lỗi
 * mà bàn giao (D) được dựng ra để đóng, chỉ khác là nó bò lên tầng UI và ghi đè đúng cái tín hiệu
 * (`retryReach`) vừa được dựng để trả lời câu ấy.
 *
 * ⚠ Vị từ nằm ở module THUẦN (`vramCommandReach.ts`) chứ không nằm trong `.tsx`: repo có **0 file
 * `*.test.tsx`** và không có harness render nào — một vị từ trong `.tsx` là vị từ **không ai kiểm
 * được**. Lưới canh việc panel THẬT SỰ gọi hàm này là cổng AST ở `errorCodes.vramCommands.unit.test.ts`
 * (cổng (ii) đã đổi sang AST sau khi bản regex bị lách bằng một dòng chú thích).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { vramRetryButtonEnabled, type VramDeferRetryReachKind } from "./vramCommandReach";

/** ⚠ VÉT CẠN theo KIỂU: thêm một phạm trù `retryReach` mà quên khai ⇒ `tsc` ĐỎ, không phải lọt. */
const MONG_DOI: Record<VramDeferRetryReachKind, boolean> = {
  "reachable-here": true,
  unreachable: false,
  unknown: false,
};

describe("I-1 — nút `vram.retryDeferred` CHỈ hiện khi lệnh thật sự với tới", () => {
  for (const [kind, mong] of Object.entries(MONG_DOI) as [VramDeferRetryReachKind, boolean][]) {
    it(`${kind} ⇒ ${mong ? "CHO" : "KHÔNG cho"} bấm`, () => {
      expect(vramRetryButtonEnabled(kind)).toBe(mong);
    });
  }

  it("★★★ ĐÚNG MỘT phạm trù cho phép bấm — `||` thêm bất kỳ điều kiện nào là quay lại lỗi (D)", () => {
    const choPhep = (Object.keys(MONG_DOI) as VramDeferRetryReachKind[]).filter((k) => vramRetryButtonEnabled(k));
    expect(choPhep).toEqual(["reachable-here"]);
  });

  it('★★ "đang hoãn" KHÔNG phải một lý do cho bấm: hộ `unreachable` vẫn KHÔNG bấm được dù đang hoãn thật', () => {
    // Hai câu hỏi khác nhau: `status` = "nó có CHỜ không"; `retryReach` = "ta có GỌI DẬY được không".
    // Hộ đi qua `vramDefer` chờ TRONG ngăn xếp của chính job đó ⇒ không cơ chế nào đánh thức từ ngoài.
    expect(vramRetryButtonEnabled("unreachable")).toBe(false);
  });

  it('★★ `unknown` (ô trạng thái cron đọc không được) ⇒ KHÔNG bấm — chiều CHẶT, không đọc thành "được"', () => {
    expect(vramRetryButtonEnabled("unknown")).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ LƯỚI CẤU TRÚC — PHÁT BIỂU VỀ **CÁI NÓ PHẢI LÀ**, VÀ **NEO ĐÚNG NẤC**
//
// ⚠⚠⚠ HAI ĐỜI LƯỚI TRƯỚC ĐỀU BỊ LÁCH, và mỗi lần lách dạy một điều KHÁC NHAU:
//
//  • Đời 1 — cấm `||` chạm `retryReach`. Lách bằng **biến trung gian**:
//        const rk = h.retryReach.kind;
//        const canRetry = rk === "reachable-here" || h.status.kind === "deferring";
//    ⇒ BÀI HỌC 1: lưới nặn theo **CHỮ KÝ** của lỗi vừa rồi không canh được **BẤT BIẾN**
//    (`?:`, `&&`, `??`, một biến trung gian — mỗi cái là một chữ ký mới).
//
//  • Đời 2 — đòi *khởi tạo của `canRetry` PHẢI LÀ* lời gọi vị từ. Bất biến ĐÚNG, nhưng lách bằng
//    cách **giữ nguyên khai báo** rồi đặt `||` ở **ĐIỂM DÙNG**:
//        {canRetry || h.status.kind === "deferring" ? <Button …/> : null}
//    ⇒ BÀI HỌC 2: một bất biến đúng **NEO SAI MỘT NẤC** vẫn là lưới giả. Tính chất cần canh không
//    phải một **biến**, mà là **CÁI NÚT** — thứ người vận hành thật sự bấm được hay không.
//
//  ⇒ Đời 3 (dưới đây): neo vào **`disabled` của chính nút** (`data-testid="vram-retry"`), và đòi nó
//    **LÀ** một lời gọi `vramRetryButtonDisabled(...)`. Cộng thêm một ca cấm bọc nút trong điều
//    kiện render, để **KHÔNG CÒN ô thứ hai** nào quyết định việc bấm được.
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠⚠ m-1 (review Pha 5 Task 3) — **BẤT BIẾN DƯỚI ĐÂY ĐÃ CÓ CHỦ MỚI, MẠNH HƠN.**
 *
 * Khối này là **đời 3** và nó **YẾU** ở hai chỗ, cả hai đã được đo:
 *  • `thuocTinh()` dùng `ra ??=` ⇒ **dừng ở phần tử ĐẦU TIÊN**: thêm một nút thứ hai cùng
 *    `data-testid` với `disabled={false}` thì khối này **XANH** (đối chứng chạy được ở
 *    `vramCommandReach.role.unit.test.ts`).
 *  • Nó neo vào **MARKER** (`data-testid="vram-retry"`) — một cái tên mà **người viết nút mới sở
 *    hữu**: một nút lệnh **không nhãn** đi qua trọn vẹn (I-3, đo được: 42/42 xanh, `tsc` 0).
 *
 * ⇒ Chủ hiện tại của bất biến *"nút lệnh VRAM phải được gác quyền"* là
 * **`vramCommandReach.role.unit.test.ts` — ca `★★★ I-3`**, neo theo **ĐƯỜNG THOÁT**
 * (`trpc.vram.*.useMutation` → `.mutate(`), lượng-từ-hoá bằng **MỌI**. Khối dưới giữ lại như một
 * **hồ sơ lịch sử ba đời lưới** (mỗi đời một bài học khác nhau) và một ca hồi quy rẻ tiền cho nút
 * thử lại — **đừng** sửa nó rồi tưởng đã đóng bất biến chính.
 */
describe("N-5 — `disabled` của NÚT thử lại PHẢI LÀ lời gọi `vramRetryButtonDisabled` (neo vào CÁI NÚT)", () => {
  const HERE = fileURLToPath(new URL(".", import.meta.url)); // .../client/src/lib
  const PANEL = join(HERE, "..", "components", "ai", "VramBrokerPanel.tsx");

  function ast(nguon?: string): ts.SourceFile {
    return ts.createSourceFile(
      PANEL,
      nguon ?? readFileSync(PANEL, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
  }

  /** Thuộc tính JSX của phần tử mang `data-testid="<marker>"`. `null` ⇔ không có phần tử ấy. */
  function thuocTinh(sf: ts.SourceFile, marker: string, ten: string): ts.Node | null {
    let ra: ts.Node | null = null;
    const laMarker = (attrs: ts.JsxAttributes): boolean =>
      attrs.properties.some(
        (a) =>
          ts.isJsxAttribute(a) &&
          a.name.getText(sf) === "data-testid" &&
          a.initializer !== undefined &&
          ts.isStringLiteral(a.initializer) &&
          a.initializer.text === marker,
      );
    const di = (n: ts.Node): void => {
      if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) {
        if (laMarker(n.attributes)) {
          for (const a of n.attributes.properties) {
            if (ts.isJsxAttribute(a) && a.name.getText(sf) === ten && a.initializer) {
              ra ??= ts.isJsxExpression(a.initializer) ? (a.initializer.expression ?? a.initializer) : a.initializer;
            }
          }
        }
      }
      ts.forEachChild(n, di);
    };
    di(sf);
    return ra;
  }

  function laLoiGoi(n: ts.Node | null | undefined, ten: string): boolean {
    return !!n && ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === ten;
  }

  it("★★★ nút `vram-retry` TỒN TẠI và `disabled` của nó LÀ `vramRetryButtonDisabled(...)`", () => {
    const sf = ast();
    const d = thuocTinh(sf, "vram-retry", "disabled");
    expect(d, "phải có nút thử lại mang `data-testid=vram-retry`").not.toBeNull();
    expect(
      laLoiGoi(d, "vramRetryButtonDisabled"),
      "`disabled` phải LÀ một lời gọi `vramRetryButtonDisabled(...)`, không phải một biểu thức tự ghép",
    ).toBe(true);
  });

  it("★★★ (lưới cho chính lưới) NĂM hình dạng lách — kể cả `||` ở ĐIỂM DÙNG — đều bị bắt", () => {
    /**
     * ⚠ Biến thể 1 là **đúng cách người review đã lách lưới đời trước**: giữ nguyên khai báo
     * `canRetry` (hợp lệ) rồi đặt `||` ở ĐIỂM DÙNG. Lưới neo vào *khai báo* ⇒ XANH; lưới neo vào
     * *cái nút* ⇒ ĐỎ.
     */
    const bienThe: Record<string, string> = {
      "`||` ở ĐIỂM DÙNG (bọc render)":
        'const canRetry = vramRetryButtonEnabled(k); const x = <Button data-testid="vram-retry" disabled={!canRetry || s.kind === "deferring"} />;',
      "biến trung gian": 'const dis = false; const x = <Button data-testid="vram-retry" disabled={dis} />;',
      "toán tử ?:": 'const x = <Button data-testid="vram-retry" disabled={k === "unknown" ? false : true} />;',
      "hằng số": 'const x = <Button data-testid="vram-retry" disabled={false} />;',
      "hàm KHÁC": 'const x = <Button data-testid="vram-retry" disabled={motHamKhac(k)} />;',
    };
    for (const [ten, nguon] of Object.entries(bienThe)) {
      const sf = ast(nguon);
      expect(laLoiGoi(thuocTinh(sf, "vram-retry", "disabled"), "vramRetryButtonDisabled"), `${ten} PHẢI bị bắt`).toBe(
        false,
      );
    }
    // Hình dạng ĐÚNG lọt qua.
    const dung = ast('const x = <Button data-testid="vram-retry" disabled={vramRetryButtonDisabled(k, c, p)} />;');
    expect(laLoiGoi(thuocTinh(dung, "vram-retry", "disabled"), "vramRetryButtonDisabled")).toBe(true);
  });

  it("★★ nút KHÔNG được bọc trong một điều kiện render — trạng thái bấm-được CHỈ do `disabled` quyết", () => {
    /**
     * Nếu ai bọc lại `{cond && <Button data-testid="vram-retry" …/>}` thì có HAI ô quyết định, và
     * `cond` là ô KHÔNG được lưới nào canh — đúng cái nấc mà N-5 vừa gỡ.
     *
     * ⚠ PHẠM VI PHẢI ĐÚNG, không được rộng hơn: cả thân panel nằm trong một cổng NẠP hợp lệ
     * (`state.isLoading || !s ? <Skeleton/> : …`) — bản đầu của ca này bắt nhầm đúng cổng đó. Ta chỉ
     * xét những tổ tiên **BÊN TRONG hàm `.map()` của một hàng hộ nền**, tức từ `ArrowFunction` gần
     * nhất trở xuống: đó là phạm vi mà một điều kiện phụ thuộc TRẠNG THÁI HỘ có thể xuất hiện.
     */
    const sf = ast();
    let viPham: string | null = null;
    const di = (n: ts.Node, toTienDay: ts.Node[]): void => {
      // Cắt danh sách tổ tiên tại `ArrowFunction` gần nhất — cổng nạp của cả panel nằm NGOÀI nó.
      const iArrow = toTienDay.map((x) => ts.isArrowFunction(x)).lastIndexOf(true);
      const toTien = iArrow === -1 ? toTienDay : toTienDay.slice(iArrow);
      if (
        (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) &&
        n.attributes.properties.some(
          (a) =>
            ts.isJsxAttribute(a) &&
            a.name.getText(sf) === "data-testid" &&
            a.initializer &&
            ts.isStringLiteral(a.initializer) &&
            a.initializer.text === "vram-retry",
        )
      ) {
        for (const t of toTien) {
          if (ts.isConditionalExpression(t)) viPham ??= `bọc trong ?: — ${t.getText(sf).slice(0, 120)}`;
          if (ts.isBinaryExpression(t) && t.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
            viPham ??= `bọc trong && — ${t.getText(sf).slice(0, 120)}`;
          }
        }
      }
      ts.forEachChild(n, (c) => di(c, [...toTienDay, n]));
    };
    di(sf, []);
    expect(viPham, "nút phải LUÔN render; trạng thái bấm-được chỉ do `disabled`").toBeNull();
  });
});


// ════════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ I-1 (review Task 5) — **ĐỐI SỐ `owner` CỦA `retryDeferred.mutate` PHẢI LÀ MỘT DANH TÍNH DO
// MẶT ĐỌC PHÁT RA, KHÔNG PHẢI MỘT CHUỖI NÀO ĐÓ TRÊN CÙNG ĐỐI TƯỢNG.**
//
// ⚠⚠⚠ VÌ SAO KHÔNG ĐÓNG ĐƯỢC BẰNG KIỂU (đo được ở review):
//   `mutate({ owner: h.ownerPattern })`            ⇒ tsc TS2322  ✅ (đổi kiểu Task 5 chặn)
//   `mutate({ owner: h.ownerPattern.patternText })` ⇒ tsc 0 lỗi  ❌
//   `mutate({ owner: h.host })`                     ⇒ tsc 0 lỗi  ❌  ← **ĐÚNG ĐƯỜNG ĐÃ ĐI THẬT**
// `input` của `vram.retryDeferred` là `z.string()` ⇒ **mọi** `string` lọt. Đổi kiểu chặn được cái
// chưa ai viết, KHÔNG chặn được cái người ta **đã** viết. Chặn đầu vào bằng brand (`z.custom<…>`)
// thì đổi kiểu `input` ở **hàng chục** điểm gọi (gồm bộ test của ba router) — nợ đã khai.
//
// ⇒ Ở đây dùng **đúng bộ máy AST của lưới `disabled`** (cùng file, ngay trên): neo vào **CÁI NÚT**,
// và phát biểu ở chiều **PHẢI-LÀ** — *"`owner` PHẢI LÀ `….retryReach.owner`"* — chứ không liệt kê
// những thứ bị cấm. Mọi hình dạng khác (`h.host`, `patternText`, hằng, biến trung gian) **đều** rơi.
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ I-1 — `owner` gửi cho `vram.retryDeferred` PHẢI LÀ `retryReach.owner` (neo AST)", () => {
  const HERE = fileURLToPath(new URL(".", import.meta.url));
  const PANEL = join(HERE, "..", "components", "ai", "VramBrokerPanel.tsx");

  function ast(nguon?: string): ts.SourceFile {
    return ts.createSourceFile(PANEL, nguon ?? readFileSync(PANEL, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  }

  /** Mọi biểu thức được truyền làm `owner` cho một lời gọi `<gì đó>.retryDeferred.mutate(...)`. */
  function doiSoOwner(sf: ts.SourceFile): ts.Expression[] {
    const ra: ts.Expression[] = [];
    /** `retryDeferred.mutate(...)` — đúng cái tên hook mà panel đặt cho mutation của lệnh này. */
    const laMutateCuaRetryDeferred = (e: ts.Expression): boolean =>
      ts.isPropertyAccessExpression(e) &&
      e.name.text === "mutate" &&
      ts.isIdentifier(e.expression) &&
      e.expression.text === "retryDeferred";
    const di = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && laMutateCuaRetryDeferred(n.expression)) {
        for (const a of n.arguments) {
          if (!ts.isObjectLiteralExpression(a)) continue;
          for (const p of a.properties) {
            if (ts.isPropertyAssignment(p) && !ts.isComputedPropertyName(p.name) && p.name.getText(sf) === "owner") {
              ra.push(p.initializer);
            }
          }
        }
      }
      ts.forEachChild(n, di);
    };
    di(sf);
    return ra;
  }

  /** PHẢI-LÀ: `<bất kỳ>.retryReach.owner`. Không liệt kê cái bị cấm — hỏi cái nó phải là. */
  function laDanhTinhCuaMatDoc(e: ts.Expression): boolean {
    return (
      ts.isPropertyAccessExpression(e) &&
      e.name.text === "owner" &&
      ts.isPropertyAccessExpression(e.expression) &&
      e.expression.name.text === "retryReach"
    );
  }

  it("★★★ panel THẬT: có ít nhất một lời gọi, và MỌI `owner` gửi đi đều là `retryReach.owner`", () => {
    const sf = ast();
    const args = doiSoOwner(sf);
    // Lưới của lưới: không tìm thấy lời gọi nào ⇒ ca dưới xanh vì rỗng.
    expect(args.length, "không thấy `retryDeferred.mutate({ owner })` nào — lưới đang mù").toBeGreaterThanOrEqual(1);
    for (const a of args) {
      expect(
        laDanhTinhCuaMatDoc(a),
        `\`owner\` PHẢI LÀ \`….retryReach.owner\` (danh tính DO MẶT ĐỌC phát ra ở đúng nhánh ` +
          `lệnh với tới được), không phải \`${a.getText(sf).slice(0, 60)}\``,
      ).toBe(true);
    }
  });

  it("★★★ (lưới cho chính lưới) BỐN hình dạng — kể cả `h.host`, ĐƯỜNG ĐÃ ĐI THẬT — đều bị bắt", () => {
    const bienThe: Record<string, string> = {
      "`h.host` (đường đã đi thật, tsc XANH)": "retryDeferred.mutate({ owner: h.host });",
      "bóc vỏ `patternText` (tsc XANH)": "retryDeferred.mutate({ owner: h.ownerPattern.patternText });",
      "hằng chuỗi": 'retryDeferred.mutate({ owner: "cron:kb-sync" });',
      "biến trung gian": "const o = h.host; retryDeferred.mutate({ owner: o });",
    };
    for (const [ten, nguon] of Object.entries(bienThe)) {
      const sf = ast(nguon);
      const args = doiSoOwner(sf);
      expect(args.length, `${ten}: phải tìm thấy lời gọi`).toBe(1);
      expect(laDanhTinhCuaMatDoc(args[0]!), `${ten} PHẢI bị bắt`).toBe(false);
    }
    // Hình dạng ĐÚNG lọt qua — đối chứng DƯƠNG (không phải một lưới "cấm tất").
    const dung = ast("retryDeferred.mutate({ owner: h.retryReach.owner });");
    expect(laDanhTinhCuaMatDoc(doiSoOwner(dung)[0]!)).toBe(true);
  });
});
