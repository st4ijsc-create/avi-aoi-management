/**
 * ★★★ Pha 5 Task 3 (N9) — **VAI NÀO VỚI TỚI MẶT LỆNH VRAM, VÀ AI NUÔI CÁI NÚT.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO LƯỚI NÀY TỒN TẠI: VỊ TỪ NÚT ĐÚNG ĐẾN MẤY CŨNG VÔ NGHĨA NẾU **CÁI NUÔI NÓ** SAI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `pages/AIBrainDashboard.tsx:114` khai `isOpsRole = role === "admin" || role === "engineer"` rồi
 * đổ **thẳng** vào prop nuôi **cả ba** nút lệnh của `VramBrokerPanel`. Hệ quả đo được:
 *  • `supervisor` — vai chủ dự án chọn cho mặt lệnh VRAM, và **đã có** trong `ACTUATION_ROLES`
 *    (`server/_core/trpc.ts:434`) — **KHÔNG BAO GIỜ** nhận `true`. Task 3 có viết vị từ hoàn hảo
 *    đến đâu thì tham số của nó vẫn bị một biểu thức **ở màn cha** khoá chết ⇒ *"neo sai một nấc"*.
 *  • `isOpsRole` **không phải** một câu về VRAM: nó là cổng của Agent Ops
 *    (`aiAgent.listAgentSessionsForOps`, sàn `admin|engineer`). Một ô trả lời **hai** câu hỏi khác
 *    nhau — bản sao dùng chung, lớp lỗi ngược của "hai bản sao một vị từ".
 *
 * ⚠⚠ **BA NÚT, HAI SÀN QUYỀN** (`server/routers/vramRouter.ts:66-70`): `preempt`/`releaseStale`
 * đứng trên `machine_control/canDelete`; `retryDeferred` đứng trên `canCreate`. `engineer` **có**
 * `canCreate`, **không có** `canDelete` (`server/routers/permissionsRouter.ts:288`). ⇒ Một boolean
 * cho cả ba nói dối theo **cả hai chiều**. Hai grant, mỗi nút khớp **đúng** sàn của nó.
 *
 * ⚠ Lưới ở đây có BỐN tầng, tầng nào cũng cần:
 *   1. ca **thuần** khoá QUYẾT ĐỊNH (bảng vai);
 *   2. ca **đối chiếu NGUỒN ĐỘC LẬP** (danh sách vai của máy chủ) — bảng khai không tự chứng minh
 *      được là nó **đủ**;
 *   3. cổng **AST** khoá `disabled` của **từng** nút LÀ một lời gọi, và khoá **cái nuôi** nó ở màn
 *      cha cũng LÀ một lời gọi;
 *   4. cổng **AST** khoá *"không có ô THỨ HAI"* — grant chỉ được đọc **trong** đối số của vị từ.
 *      ⚠ Tầng 4 phát biểu theo **NƠI XUẤT HIỆN của grant**, không liệt kê hình dạng rẽ nhánh: đó là
 *      bài học đã trả giá **ba lần** ở Task 2 (`?:` → trả về sớm → ngắn mạch `&&`) — liệt kê hình
 *      dạng thì hình dạng thứ N+1 **luôn** tồn tại.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import {
  vramCommandReach,
  vramDestructiveButtonDisabled,
  vramRetryButtonDisabled,
  VRAM_LENH_GATE,
  type VramCommandRole,
  type VramDeferRetryReachKind,
} from "./vramCommandReach";
import { VRAM_CONTROL_MODULE } from "@shared/permissions";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // .../client/src/lib
const GOC = join(TEST_DIR, "..", "..", ".."); // gốc repo
const CLIENT_SRC = join(GOC, "client", "src");
const PANEL = join(CLIENT_SRC, "components", "ai", "VramBrokerPanel.tsx");
const MAN_CHA = join(CLIENT_SRC, "pages", "AIBrainDashboard.tsx");
const AUTH_MAY_CHU = join(GOC, "server", "db", "auth.ts");

// ══════════════════════════════════════════════════════════════════════════════════════════════
// TẦNG 1 — QUYẾT ĐỊNH (vị từ thuần)
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ⚠ VÉT CẠN theo KIỂU: thêm một vai vào `VramCommandRole` mà quên khai ở đây ⇒ **`tsc` ĐỎ**, không
 * phải một nút hiện sai âm thầm. Hai cột = hai sàn quyền của máy chủ.
 */
const MONG_DOI: Record<VramCommandRole, { destructive: boolean; actuation: boolean }> = {
  admin: { destructive: true, actuation: true },
  supervisor: { destructive: true, actuation: true },
  engineer: { destructive: false, actuation: true },
  quality_inspector: { destructive: false, actuation: false },
  operator: { destructive: false, actuation: false },
  maintenance: { destructive: false, actuation: false },
  viewer: { destructive: false, actuation: false },
  user: { destructive: false, actuation: false },
};

describe("N9 — `vramCommandReach`: vai nào với tới mặt lệnh VRAM", () => {
  for (const [vai, mong] of Object.entries(MONG_DOI) as [VramCommandRole, { destructive: boolean; actuation: boolean }][]) {
    it(`${vai} ⇒ phá huỷ ${mong.destructive ? "ĐƯỢC" : "KHÔNG"} · actuation ${mong.actuation ? "ĐƯỢC" : "KHÔNG"}`, () => {
      const r = vramCommandReach(vai);
      expect(Boolean(r.destructive)).toBe(mong.destructive);
      expect(Boolean(r.actuation)).toBe(mong.actuation);
    });
  }

  it("★★★ QUYẾT ĐỊNH CỦA CHỦ DỰ ÁN — `supervisor` ⇒ hai nút PHÁ HUỶ BẬT (đây là cả lý do Task 3 tồn tại)", () => {
    expect(vramDestructiveButtonDisabled(vramCommandReach("supervisor"), false)).toBe(false);
  });

  it("★★★ `engineer` ⇒ hai nút PHÁ HUỶ TẮT — máy chủ chặn ĐỘC LẬP (`canDelete` không có; C3: OTP tươi vẫn 403)", () => {
    expect(vramDestructiveButtonDisabled(vramCommandReach("engineer"), false)).toBe(true);
  });

  it("★★★ `operator` ⇒ TẮT · `admin` ⇒ BẬT", () => {
    expect(vramDestructiveButtonDisabled(vramCommandReach("operator"), false)).toBe(true);
    expect(vramDestructiveButtonDisabled(vramCommandReach("admin"), false)).toBe(false);
  });

  it("★★ ĐÚNG HAI vai với tới lệnh PHÁ HUỶ — thêm một vai nữa là nới quyền, phải cố ý", () => {
    const cho = (Object.keys(MONG_DOI) as VramCommandRole[]).filter((v) => vramCommandReach(v).destructive);
    expect(cho.sort()).toEqual(["admin", "supervisor"]);
  });

  it("★★ BA vai với tới lệnh KHÔNG phá huỷ (`retryDeferred` = `canCreate`) — `engineer` NẰM TRONG", () => {
    // ⚠ Chiều NGƯỢC của lời nói dối: cắt nút này khỏi `engineer` là "hứa ÍT hơn máy chủ cho phép".
    const cho = (Object.keys(MONG_DOI) as VramCommandRole[]).filter((v) => vramCommandReach(v).actuation);
    expect(cho.sort()).toEqual(["admin", "engineer", "supervisor"]);
  });

  it("★★★ `unknown ⇒ false` chiều CHẶT — mọi đầu vào lạ đều KHÔNG mở nút", () => {
    const la: unknown[] = [
      undefined,
      null,
      "",
      "Admin",
      "ADMIN",
      "supervisor ",
      "sup",
      0,
      1,
      true,
      {},
      [],
      ["admin"],
      { role: "admin" },
      // ⚠ Khoá của `Object.prototype` — một bảng tra bằng `[key]` trần sẽ trả về HÀM (truthy).
      "toString",
      "constructor",
      "__proto__",
      "hasOwnProperty",
    ];
    for (const x of la) {
      const r = vramCommandReach(x);
      expect(Boolean(r.destructive), `destructive cho ${String(x)}`).toBe(false);
      expect(Boolean(r.actuation), `actuation cho ${String(x)}`).toBe(false);
    }
  });

  it("★★ `isPending` khoá nút kể cả với vai ĐỦ quyền (chống bấm đúp một lệnh phá huỷ)", () => {
    expect(vramDestructiveButtonDisabled(vramCommandReach("admin"), true)).toBe(true);
    expect(vramDestructiveButtonDisabled(vramCommandReach("supervisor"), true)).toBe(true);
  });

  it("★★ nút *Thử lại ngay* nhân BA điều kiện: tầm với vai × `retryReach` × `isPending`", () => {
    const KIND: VramDeferRetryReachKind[] = ["reachable-here", "unreachable", "unknown"];
    for (const vai of Object.keys(MONG_DOI) as VramCommandRole[]) {
      for (const k of KIND) {
        for (const pending of [true, false]) {
          const mong = !MONG_DOI[vai].actuation || pending || k !== "reachable-here";
          expect(
            vramRetryButtonDisabled(k, vramCommandReach(vai), pending),
            `${vai}/${k}/pending=${String(pending)}`,
          ).toBe(mong);
        }
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// TẦNG 2 — ĐỐI CHIẾU NGUỒN ĐỘC LẬP
//
// ⚠⚠ Bảng vai ở `vramCommandReach.ts` là **bản sao thứ hai** của danh sách vai (client không import
// được module máy chủ). Một bảng khai **không tự chứng minh được là nó ĐỦ**: thêm một vai ở
// `server/db/auth.ts` mà quên ở đây thì `tsc` im lặng và vai mới **rơi vào nhánh `unknown`** — đúng
// chiều an toàn, nhưng **âm thầm**, và lần sau người ta sẽ tưởng đã cân nhắc rồi. Vế đối chiếu phải
// đến từ nguồn ĐỘC LẬP (chính file máy chủ), không từ chính bảng khai.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("N9 — bảng vai phải PHỦ ĐÚNG danh sách vai của máy chủ (nguồn độc lập)", () => {
  it("★★★ `VramCommandRole` ≡ `UserRole` của `server/db/auth.ts` — không thiếu, không thừa", () => {
    const sf = ts.createSourceFile(
      AUTH_MAY_CHU,
      readFileSync(AUTH_MAY_CHU, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    let vaiMayChu: string[] | null = null;
    const di = (n: ts.Node): void => {
      if (ts.isTypeAliasDeclaration(n) && n.name.text === "UserRole" && ts.isUnionTypeNode(n.type)) {
        vaiMayChu = n.type.types
          .filter((t): t is ts.LiteralTypeNode => ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal))
          .map((t) => (t.literal as ts.StringLiteral).text);
      }
      ts.forEachChild(n, di);
    };
    di(sf);
    expect(vaiMayChu, "không đọc được `UserRole` ở server/db/auth.ts — file đã đổi hình dạng?").not.toBeNull();
    expect([...(vaiMayChu as unknown as string[])].sort()).toEqual(Object.keys(MONG_DOI).sort());
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// TẦNG 2b (Pha 5 Task 3b) — **CỔNG QUYỀN MÀ FILE NÀY KHAI PHẢI LÀ CỔNG MÀ MÁY CHỦ ĐANG ĐỨNG TRÊN.**
//
// ⚠⚠ Task 3b tách bit VRAM ra khỏi `machine_control` vì bit ấy dùng chung cho **10 thủ tục ở 8
// router**, **8/10 KHÔNG có 2FA** (nguy hiểm nhất: `programming.deleteProject` xoá CASCADE cây mã
// nguồn). `vramCommandReach.ts` phải **đọc bit MỚI** — nhưng "đọc bit nào" ở một bảng theo VAI là
// một câu **chỉ nằm trong lời văn**, tức không ai kiểm được. Ca dưới biến nó thành đếm được: vế đối
// chiếu đến từ **nguồn ĐỘC LẬP** — chính `server/routers/vramRouter.ts`, đọc bằng AST.
// ⇒ Đột biến *"trả `vramRouter` về `machine_control/canDelete`"* ⇒ **ĐỎ Ở ĐÂY**, kể cả khi bảng vai
// và mọi cổng AST khác vẫn xanh.
// ══════════════════════════════════════════════════════════════════════════════════════════════

const VRAM_ROUTER = join(GOC, "server", "routers", "vramRouter.ts");

describe("Task 3b — cổng quyền client KHAI phải trùng cổng máy chủ ĐỨNG TRÊN (nguồn độc lập)", () => {
  /**
   * Đọc **mọi** cặp `(module, action)` mà `vramRouter.ts` chain qua `requirePermission(...)`, phân
   * giải cả chuỗi trực tiếp lẫn hằng nhập từ `@shared/permissions`.
   */
  function cuaMayChu(): string[] {
    const ma = readFileSync(VRAM_ROUTER, "utf8");
    const sf = ts.createSourceFile(VRAM_ROUTER, ma, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const hang = new Map<string, string>([["VRAM_CONTROL_MODULE", VRAM_CONTROL_MODULE]]);
    const val = (n: ts.Node): string | null =>
      ts.isStringLiteral(n) ? n.text : ts.isIdentifier(n) ? (hang.get(n.text) ?? null) : null;
    const ra: string[] = [];
    const di = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "requirePermission") {
        const m = n.arguments[0] === undefined ? null : val(n.arguments[0]);
        const a = n.arguments[1] === undefined ? null : val(n.arguments[1]);
        ra.push(`${m}/${a}`);
      }
      ts.forEachChild(n, di);
    };
    di(sf);
    return ra;
  }

  it("★★★ hai cổng lệnh mà client khai (`VRAM_LENH_GATE`) đúng bằng hai cổng lệnh của `vramRouter`", () => {
    const may = cuaMayChu();
    expect(may.length, "không đọc được điểm gọi nào — vramRouter đã đổi hình dạng?").toBeGreaterThan(0);
    const khai = [
      `${VRAM_LENH_GATE.destructive.module}/${VRAM_LENH_GATE.destructive.action}`,
      `${VRAM_LENH_GATE.actuation.module}/${VRAM_LENH_GATE.actuation.action}`,
    ];
    for (const k of khai) {
      expect(may, `client khai cổng \`${k}\` nhưng vramRouter KHÔNG đứng trên nó (máy chủ: ${may.join(", ")})`).toContain(k);
    }
    // ⚠ Chiều ngược: máy chủ **không được** còn một cổng LỆNH nào ngoài hai cái đã khai. Mặt ĐỌC
    // (`machine_control/canView`) cố ý ở lại — loại nó ra tường minh, không im lặng.
    const conLai = may.filter((c) => !khai.includes(c) && c !== "machine_control/canView");
    expect(conLai.join(" · "), "vramRouter còn đứng trên một cổng mà client KHÔNG khai").toBe("");
  });

  it("★★★ module VRAM là bit RIÊNG — client TUYỆT ĐỐI không còn khai `machine_control` cho hai nút lệnh", () => {
    expect(VRAM_LENH_GATE.destructive.module).toBe(VRAM_CONTROL_MODULE);
    expect(VRAM_LENH_GATE.actuation.module).toBe(VRAM_CONTROL_MODULE);
    expect(VRAM_CONTROL_MODULE).not.toBe("machine_control");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// BỘ MÁY AST DÙNG CHUNG CHO TẦNG 3 + 4
//
// ⚠⚠ Quét theo **ĐƯỜNG THOÁT, không theo FILE**: mọi `.tsx` dưới `client/src` đều bị hỏi, nên dựng
// một điểm gọi MỚI trong một FILE MỚI (đột biến M3 của Global Constraints) vẫn bị bắt.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★★★ I-3 (review) — **NEO VÀO ĐƯỜNG THOÁT (`.mutate`), KHÔNG VÀO CÁI NHÃN.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ BẢN ĐẦU CỦA LƯỚI NÀY LỌT, VÀ LỌT ĐÚNG LỚP LỖI TASK 2, DỊCH LÊN MỘT NẤC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản đầu neo vào một **DANH SÁCH TRẮNG BA TÊN MARKER** (`vram-preempt` · `vram-release-stale` ·
 * `vram-retry`). Người review thêm một nút phá huỷ **THỨ TƯ không mang `data-testid`**, đi qua
 * step-up 2FA **đúng khuôn** (nên lưới F1 vẫn xanh), gọi `preempt.mutate(...)` và
 * `disabled={false}` ⇒ **một nút giết tiến trình mở cho MỌI vai đăng nhập**, mà:
 *   `…role.unit.test.ts` **42/42 XANH** · `client/src/lib/` **451 XANH** · `tsc` **0 lỗi** ⇒ ship được.
 *
 * Task 2 học *"đừng liệt kê HÌNH DẠNG"*; đây là *"liệt kê **DANH TÍNH**"* — cùng bệnh, khác trục, và
 * cái tên ấy do **chính người viết nút mới** quyết định. ⇒ Bất biến phải nói về **CÁI NÚT LÀM GÌ**:
 *
 *   > MỌI phần tử JSX mà thuộc tính của nó **dẫn tới** `.mutate(` của một mutation `trpc.vram.*`
 *   > thì `disabled` của nó **PHẢI LÀ** lời gọi vị từ ứng với **SÀN QUYỀN của thủ tục ấy**.
 *
 * ⚠ Khuôn này **ĐÃ CÓ SẴN trong repo** — `vramPanelStepUp.unit.test.ts` neo theo `.mutate(` và
 * **bắt được** biến thể "nút thứ tư thiếu step-up". Đây là mượn lại đúng bộ máy đó, không dựng cái
 * thứ hai: repo bắt được *"nút mới thiếu 2FA"* nhưng trước bản này **không** bắt được *"nút mới
 * thiếu gác QUYỀN"*.
 *
 * ⚠ Tập thủ tục được suy ra từ **`trpc.vram.<thủ tục>.useMutation`** trên CÂY, không từ tên biến:
 * đổi tên biến (`const p = trpc.vram.preempt.useMutation(...)`) không thoát được.
 */
const VI_TU_THEO_THU_TUC: Readonly<Record<string, string>> = {
  // `deployProcedure` + `machine_control/canDelete` — PHÁ HUỶ.
  preempt: "vramDestructiveButtonDisabled",
  releaseStale: "vramDestructiveButtonDisabled",
  // `actuationProcedure` + `machine_control/canCreate`.
  retryDeferred: "vramRetryButtonDisabled",
};
/** Tên component mang ba nút ấy — ô `commandReach` của nó là **cái NUÔI** cả ba. */
const PANEL_TAG = "VramBrokerPanel";
/** Vị từ duy nhất được phép sinh ra một `VramCommandReach`. */
const VI_TU_NUOI = "vramCommandReach";

function moiFileTsx(goc: string): string[] {
  const ra: string[] = [];
  const di = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) di(p);
      else if (e.name.endsWith(".tsx")) ra.push(p);
    }
  };
  di(goc);
  return ra;
}

function ast(duong: string, nguon?: string): ts.SourceFile {
  return ts.createSourceFile(
    duong,
    nguon ?? readFileSync(duong, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
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

type ThePhanTu = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

/** MỌI phần tử JSX mang `data-testid="<marker>"` — **không** dừng ở cái đầu tiên (xem M-7 dưới). */
function moiPhanTuCoMarker(sf: ts.SourceFile, marker: string): ThePhanTu[] {
  return moiNut(sf).filter(
    (n): n is ThePhanTu =>
      (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) &&
      n.attributes.properties.some(
        (a) =>
          ts.isJsxAttribute(a) &&
          a.name.getText(sf) === "data-testid" &&
          a.initializer !== undefined &&
          ts.isStringLiteral(a.initializer) &&
          a.initializer.text === marker,
      ),
  );
}

/** MỌI phần tử JSX có tên thẻ `<Ten …>`. */
function moiPhanTuTheoThe(sf: ts.SourceFile, ten: string): ThePhanTu[] {
  return moiNut(sf).filter(
    (n): n is ThePhanTu =>
      (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText(sf) === ten,
  );
}

/** Biểu thức của thuộc tính `ten` trên một phần tử. `null` ⇔ **không có** thuộc tính ấy. */
function bieuThucThuocTinh(el: ThePhanTu, sf: ts.SourceFile, ten: string): ts.Node | null {
  for (const a of el.attributes.properties) {
    if (!ts.isJsxAttribute(a) || a.name.getText(sf) !== ten || !a.initializer) continue;
    return ts.isJsxExpression(a.initializer) ? (a.initializer.expression ?? a.initializer) : a.initializer;
  }
  return null;
}

/** Nút này **LÀ** một lời gọi `ten(...)` — không phải một biểu thức ghép, không phải một biến. */
function laLoiGoi(n: ts.Node | null | undefined, ten: string): boolean {
  return !!n && ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === ten;
}

interface ViPham {
  readonly file: string;
  readonly dong: number;
  readonly noi: string;
}

/** Định danh TRÁI NHẤT của một chuỗi truy cập (`preempt.mutate` → `preempt`). Khuôn F1 Task 2. */
function gocCuaChuoi(n: ts.Node | undefined): string | null {
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

/** `biến ⇒ tên thủ tục` cho mọi `const x = trpc.vram.<thủ tục>.useMutation(...)` — hỏi trên CÂY. */
function bienMutationVram(sf: ts.SourceFile): Map<string, string> {
  const ra = new Map<string, string>();
  for (const n of moiNut(sf)) {
    if (!ts.isVariableDeclaration(n) || n.initializer === undefined || !ts.isIdentifier(n.name)) continue;
    if (!ts.isCallExpression(n.initializer)) continue;
    const m = /^trpc\.vram\.([A-Za-z0-9_]+)\.useMutation$/.exec(n.initializer.expression.getText(sf));
    if (m !== null) ra.set(n.name.text, m[1]);
  }
  return ra;
}

/**
 * Tập định danh **DẪN TỚI** một lệnh VRAM: bản thân biến mutation, **cộng** mọi hàm/biến mà thân nó
 * gọi tới (đóng BẮC CẦU).
 *
 * ⚠ Không có phép đóng này thì `onClick={handlePreempt}` (lệnh nằm trong một hàm khai bên trên) là
 * một lỗ y hệt cái vừa vá — chỉ dời thân lệnh ra khỏi thuộc tính.
 */
function datToiLenh(sf: ts.SourceFile): Map<string, Set<string>> {
  const goc = bienMutationVram(sf);
  const ra = new Map<string, Set<string>>();
  for (const [bien, thuTuc] of goc) ra.set(bien, new Set([thuTuc]));

  const goiTrong = (than: ts.Node): Set<string> => {
    const thay = new Set<string>();
    const di = (x: ts.Node) => {
      if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === "mutate") {
        const g = gocCuaChuoi(x.expression.expression);
        const tt = g === null ? undefined : goc.get(g);
        if (tt !== undefined) thay.add(tt);
      }
      if (ts.isIdentifier(x)) for (const tt of ra.get(x.text) ?? []) thay.add(tt);
      x.forEachChild(di);
    };
    di(than);
    return thay;
  };

  for (let vong = 0; vong < 10; vong++) {
    let doi = false;
    for (const n of moiNut(sf)) {
      let ten: string | null = null;
      let than: ts.Node | null = null;
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer !== undefined) {
        if (goc.has(n.name.text)) continue;
        ten = n.name.text;
        than = n.initializer;
      } else if (ts.isFunctionDeclaration(n) && n.name !== undefined && n.body !== undefined) {
        ten = n.name.text;
        than = n.body;
      }
      if (ten === null || than === null) continue;
      const thay = goiTrong(than);
      if (thay.size === 0) continue;
      const cu = ra.get(ten) ?? new Set<string>();
      const truoc = cu.size;
      for (const t of thay) cu.add(t);
      if (cu.size !== truoc) doi = true;
      ra.set(ten, cu);
    }
    if (!doi) break;
  }
  return ra;
}

/**
 * ★★★ TẦNG 3 — **NEO THEO ĐƯỜNG THOÁT.** Mọi phần tử JSX mà **thuộc tính** của nó dẫn tới một lệnh
 * `trpc.vram.*` đều là một **nút lệnh**, dù nó có nhãn hay không, dù nó tên gì.
 *
 * Trả về vi phạm + số nút đã soi (cầu chì chống lưới-mù).
 */
function soiNutTheoDuongThoat(sf: ts.SourceFile): { viPham: ViPham[]; soi: number } {
  const datToi = datToiLenh(sf);
  const goc = bienMutationVram(sf);
  const viPham: ViPham[] = [];
  let soi = 0;

  for (const n of moiNut(sf)) {
    if (!ts.isJsxOpeningElement(n) && !ts.isJsxSelfClosingElement(n)) continue;
    const el = n as ThePhanTu;
    // Thủ tục nào đạt tới được TỪ THUỘC TÍNH của phần tử này.
    const thuTuc = new Set<string>();
    const di = (x: ts.Node) => {
      if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === "mutate") {
        const g = gocCuaChuoi(x.expression.expression);
        const tt = g === null ? undefined : goc.get(g);
        if (tt !== undefined) thuTuc.add(tt);
      }
      if (ts.isIdentifier(x)) for (const tt of datToi.get(x.text) ?? []) thuTuc.add(tt);
      x.forEachChild(di);
    };
    di(el.attributes);
    if (thuTuc.size === 0) continue;

    soi++;
    const { line } = sf.getLineAndCharacterOfPosition(el.getStart(sf));
    const viTu = new Set([...thuTuc].map((t) => VI_TU_THEO_THU_TUC[t]).filter((v) => v !== undefined));
    if (viTu.size !== 1) {
      viPham.push({
        file: sf.fileName,
        dong: line + 1,
        noi: `một nút ra ${thuTuc.size} lệnh KHÁC SÀN QUYỀN (${[...thuTuc].join(", ")}) — không vị từ nào nói đúng cho cả hai`,
      });
      continue;
    }
    const can = [...viTu][0];
    const d = bieuThucThuocTinh(el, sf, "disabled");
    if (!laLoiGoi(d, can)) {
      viPham.push({
        file: sf.fileName,
        dong: line + 1,
        noi: `nút ra lệnh [${[...thuTuc].join(",")}] mà \`disabled\` KHÔNG LÀ \`${can}(...)\` — thấy: ${d === null ? "(KHÔNG CÓ thuộc tính `disabled`)" : d.getText(sf).slice(0, 90)}`,
      });
      continue;
    }
    // ⚠ Truy vết: một nút lệnh KHÔNG nhãn là một nút không ai chỉ mặt được trong e2e/log.
    const nhan = bieuThucThuocTinh(el, sf, "data-testid");
    if (nhan === null || !ts.isStringLiteral(nhan)) {
      viPham.push({ file: sf.fileName, dong: line + 1, noi: "nút ra lệnh VRAM mà KHÔNG mang `data-testid` chuỗi" });
    }
  }
  return { viPham, soi };
}

/** TẦNG 3b — `commandReach` truyền vào panel **PHẢI LÀ** lời gọi `vramCommandReach(...)`. */
function soiCaiNuoi(sf: ts.SourceFile): { viPham: ViPham[]; soi: number } {
  const viPham: ViPham[] = [];
  let soi = 0;
  for (const el of moiPhanTuTheoThe(sf, PANEL_TAG)) {
    soi++;
    const v = bieuThucThuocTinh(el, sf, "commandReach");
    if (!laLoiGoi(v, VI_TU_NUOI)) {
      const { line } = sf.getLineAndCharacterOfPosition(el.getStart(sf));
      viPham.push({
        file: sf.fileName,
        dong: line + 1,
        noi: `\`commandReach\` KHÔNG LÀ \`${VI_TU_NUOI}(...)\` — thấy: ${v === null ? "(không có thuộc tính)" : v.getText(sf).slice(0, 90)}`,
      });
    }
  }
  return { viPham, soi };
}

/**
 * TẦNG 4 — **KHÔNG CÓ Ô THỨ HAI.**
 *
 * ⚠⚠⚠ Bài học trả giá BA LẦN ở Task 2: lưới liệt kê **hình dạng rẽ nhánh** (`?:` → trả về sớm →
 * ngắn mạch) thì hình dạng thứ N+1 luôn tồn tại. ⇒ Đảo lượng từ: hỏi về **NƠI XUẤT HIỆN của
 * GRANT**, không về hình dạng của phép rẽ. Mọi tham chiếu tới `commandReach` **phải** nằm trong
 * đối số của một vị từ nút. Một `{commandReach.destructive && <Button …/>}`, một
 * `const c = commandReach; …`, một `<Row grant={commandReach}/>` (component con), một
 * `if (!commandReach.destructive) return null;` (trả về sớm) — **cả bốn** đều là một tham chiếu
 * NGOÀI vị từ ⇒ ĐỎ, không cần lưới biết chúng là hình dạng gì.
 *
 * ⚠ Vị trí **KHAI BÁO** (ô của interface, tham số destructure, TÊN thuộc tính JSX) không phải một
 * tham chiếu — bỏ qua, nếu không lưới sẽ tự bắt chính khai báo của mình.
 */
const VI_TU_NUT: readonly string[] = ["vramDestructiveButtonDisabled", "vramRetryButtonDisabled"];

function soiOThuHai(sf: ts.SourceFile, ten = "commandReach"): { viPham: ViPham[]; hopLe: number } {
  const trongViTu = new Set<ts.Node>();
  for (const n of moiNut(sf)) {
    if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression)) continue;
    if (!VI_TU_NUT.includes(n.expression.text)) continue;
    for (const arg of n.arguments) {
      const di = (x: ts.Node) => {
        trongViTu.add(x);
        x.forEachChild(di);
      };
      di(arg);
    }
  }

  const laKhaiBao = (n: ts.Identifier): boolean => {
    const p = n.parent;
    if (p === undefined) return false;
    if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return true;
    if (ts.isPropertySignature(p) && p.name === n) return true;
    if (ts.isBindingElement(p) && (p.name === n || p.propertyName === n)) return true;
    if (ts.isParameter(p) && p.name === n) return true;
    if (ts.isVariableDeclaration(p) && p.name === n) return true;
    if (ts.isPropertyAssignment(p) && p.name === n) return true;
    if (ts.isJsxAttribute(p) && p.name === n) return true; // TÊN thuộc tính, không phải giá trị
    if (ts.isPropertyAccessExpression(p) && p.name === n) return true; // `x.commandReach`
    return false;
  };

  const viPham: ViPham[] = [];
  let hopLe = 0;
  for (const n of moiNut(sf)) {
    if (!ts.isIdentifier(n) || n.text !== ten) continue;
    if (laKhaiBao(n)) continue;
    if (trongViTu.has(n)) {
      hopLe++;
      continue;
    }
    const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
    viPham.push({
      file: sf.fileName,
      dong: line + 1,
      noi: `Ô THỨ HAI — \`${ten}\` đọc NGOÀI đối số của vị từ nút: ${n.parent?.getText(sf).slice(0, 90) ?? ""}`,
    });
  }
  return { viPham, hopLe };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// TẦNG 3 — CỔNG AST TRÊN MÃ SẢN PHẨM
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("N9 (AST) — `disabled` của TỪNG nút lệnh, và CÁI NUÔI nó, đều PHẢI LÀ một lời gọi", () => {
  /** Quét **toàn bộ** `client/src/**.tsx`, lọc trước bằng văn bản thô cho nhanh. */
  const FILE_TSX = moiFileTsx(CLIENT_SRC);
  const NGUON = new Map<string, string>(FILE_TSX.map((f) => [f, readFileSync(f, "utf8")]));

  it("★ cầu chì — quét thấy đủ nhiều file `.tsx` (một glob rỗng làm mọi khẳng định dưới thành chân lý rỗng)", () => {
    expect(FILE_TSX.length).toBeGreaterThan(50);
    expect(FILE_TSX).toContain(PANEL);
    expect(FILE_TSX).toContain(MAN_CHA);
  });

  it("★★★ I-3 — MỌI phần tử JSX RA LỆNH `trpc.vram.*` (có nhãn hay không) phải có `disabled` LÀ vị từ của ĐÚNG sàn nó", () => {
    /**
     * ⚠⚠ Đây là bất biến **CHỦ** của nút lệnh. Bản trước neo vào ba tên marker và một nút phá huỷ
     * **thứ tư không nhãn** đi qua trọn vẹn. Nay tập phần tử được chọn bằng **đường thoát**
     * (`trpc.vram.<thủ tục>.useMutation` → `.mutate(` đạt tới từ thuộc tính, đóng bắc cầu qua hàm),
     * nên **kẻ viết nút mới không còn sở hữu cái tên mà lưới dựa vào**.
     */
    const viPham: ViPham[] = [];
    let soi = 0;
    for (const [f, src] of NGUON) {
      if (!src.includes("trpc.vram.")) continue;
      const r = soiNutTheoDuongThoat(ast(f, src));
      viPham.push(...r.viPham);
      soi += r.soi;
    }
    // ⚠ Cầu chì: BA nút lệnh phải đếm được — 0 nút thì mọi khẳng định trên là chân lý rỗng.
    expect(soi, "KHÔNG thấy nút RA LỆNH VRAM nào trong client/src ⇒ LƯỚI ĐANG MÙ").toBeGreaterThanOrEqual(3);
    expect(viPham.map((v) => `${v.file}:${v.dong} ${v.noi}`)).toEqual([]);
  });

  it("★★ cầu chì phụ — cả BA thủ tục lệnh đều có nút thật (một thủ tục không nút = một nửa bất biến không ai canh)", () => {
    const thay = new Set<string>();
    for (const [f, src] of NGUON) {
      if (!src.includes("trpc.vram.")) continue;
      for (const [, tt] of bienMutationVram(ast(f, src))) thay.add(tt);
    }
    expect([...thay].sort()).toEqual(Object.keys(VI_TU_THEO_THU_TUC).sort());
  });

  it(`★★★ MỌI \`<${PANEL_TAG} …>\` trong client/src: \`commandReach\` LÀ \`${VI_TU_NUOI}(...)\` (LỚP 3 — cái NUÔI nút)`, () => {
    const viPham: ViPham[] = [];
    let soi = 0;
    for (const [f, src] of NGUON) {
      if (!src.includes(PANEL_TAG)) continue;
      const r = soiCaiNuoi(ast(f, src));
      viPham.push(...r.viPham);
      soi += r.soi;
    }
    expect(soi, `KHÔNG thấy điểm dựng <${PANEL_TAG}> nào ⇒ LƯỚI ĐANG MÙ`).toBeGreaterThan(0);
    expect(viPham.map((v) => `${v.file}:${v.dong} ${v.noi}`)).toEqual([]);
  });

  it("★★★ KHÔNG CÓ Ô THỨ HAI — `commandReach` chỉ được đọc TRONG đối số của vị từ nút", () => {
    const viPham: ViPham[] = [];
    let hopLe = 0;
    for (const [f, src] of NGUON) {
      if (!src.includes("commandReach")) continue;
      const r = soiOThuHai(ast(f, src));
      viPham.push(...r.viPham);
      hopLe += r.hopLe;
    }
    expect(hopLe, "không thấy tham chiếu HỢP LỆ nào ⇒ LƯỚI ĐANG MÙ").toBeGreaterThanOrEqual(3);
    expect(viPham.map((v) => `${v.file}:${v.dong} ${v.noi}`)).toEqual([]);
  });

  it("★★ `isOpsRole` (cổng Agent Ops) KHÔNG còn chạm mặt lệnh VRAM ở màn cha", () => {
    /**
     * ⚠ Ca này neo vào **hai câu hỏi khác nhau không được dùng chung một ô**. `isOpsRole` vẫn phải
     * TỒN TẠI (nó là cổng đúng của `aiAgent.listAgentSessionsForOps`), nhưng nó không được xuất
     * hiện trong bất kỳ thuộc tính nào của `<VramBrokerPanel>`.
     */
    const sf = ast(MAN_CHA);
    const els = moiPhanTuTheoThe(sf, PANEL_TAG);
    expect(els.length, "màn cha phải dựng panel").toBeGreaterThan(0);
    for (const el of els) {
      expect(el.attributes.getText(sf)).not.toMatch(/\bisOpsRole\b|\bisAdmin\b/);
    }
    // Chiều DƯƠNG: `isOpsRole` vẫn còn dùng cho Agent Ops — bản vá không được xoá nhầm nó.
    expect(readFileSync(MAN_CHA, "utf8")).toMatch(/\bisOpsRole\b/);
  });

  it("★★ panel KHÔNG bị bọc trong một điều kiện suy ra từ VAI — ẩn panel là lặng lẽ đảo ngược lớp 3", () => {
    /**
     * Nếu ai viết `{isOpsRole && <VramBrokerPanel commandReach={vramCommandReach(user?.role)} …/>}`
     * thì ba cổng trên vẫn XANH, `tsc` sạch, và `supervisor` **không thấy gì cả** — quyết định của
     * chủ dự án bị đảo ngược mà không một lưới nào đỏ.
     *
     * ⇒ Tập "suy ra từ VAI" đóng **BẮC CẦU** dưới phép gán (`isOpsRole`/`isAdmin` đều sinh từ
     * `user?.role`), đúng bộ máy `vramReadSurface.unit.test.ts` đã dùng; **HÀNH ĐỘNG** (arrow /
     * `useMutation`) bị loại để lưới không nuốt `refreshAll` rồi chỉ đường tới bản vá SAI.
     */
    const sf = ast(MAN_CHA);
    const laHanhDong = (init: ts.Expression): boolean =>
      ts.isArrowFunction(init) ||
      ts.isFunctionExpression(init) ||
      (ts.isCallExpression(init) && /(^|\.)useMutation$/.test(init.expression.getText(sf)));

    const thuocVai = new Set<string>(["user"]);
    for (let vong = 0; vong < 10; vong++) {
      const truoc = thuocVai.size;
      for (const n of moiNut(sf)) {
        if (!ts.isVariableDeclaration(n) || n.initializer === undefined) continue;
        if (!ts.isIdentifier(n.name) || thuocVai.has(n.name.text)) continue;
        if (laHanhDong(n.initializer)) continue;
        const txt = n.initializer.getText(sf);
        if ([...thuocVai].some((v) => new RegExp(`\\b${v}\\b`).test(txt))) thuocVai.add(n.name.text);
      }
      if (thuocVai.size === truoc) break;
    }
    expect([...thuocVai], "cầu chì: phải bắt được ít nhất `isOpsRole` là dẫn xuất của `user`").toContain("isOpsRole");

    // Điểm rẽ: BA hình dạng cú pháp mà TypeScript có (`?:` · `if` · ngắn mạch) — không thiếu cái nào.
    interface DiemRe {
      readonly dieuKien: ts.Node;
      readonly nhanh: readonly ts.Node[];
    }
    const reBaoQuanh = new Map<ts.Node, DiemRe>();
    for (const n of moiNut(sf)) {
      let d: DiemRe | null = null;
      if (ts.isConditionalExpression(n)) d = { dieuKien: n.condition, nhanh: [n.whenTrue, n.whenFalse] };
      else if (ts.isIfStatement(n)) {
        d = { dieuKien: n.expression, nhanh: n.elseStatement ? [n.thenStatement, n.elseStatement] : [n.thenStatement] };
      } else if (
        ts.isBinaryExpression(n) &&
        [
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken,
        ].includes(n.operatorToken.kind)
      ) {
        d = { dieuKien: n.left, nhanh: [n.right] };
      }
      if (d !== null) for (const b of d.nhanh) reBaoQuanh.set(b, d);
    }

    const viPham: string[] = [];
    for (const el of moiPhanTuTheoThe(sf, PANEL_TAG)) {
      let con: ts.Node = el;
      let cur: ts.Node | undefined = el.parent;
      while (cur !== undefined) {
        const bao = reBaoQuanh.get(con);
        if (bao !== undefined) {
          const dk = bao.dieuKien.getText(sf);
          if ([...thuocVai].some((v) => new RegExp(`\\b${v}\\b`).test(dk))) {
            viPham.push(`panel bị bọc bởi điều kiện suy-ra-từ-VAI: [${dk.slice(0, 90)}]`);
          }
        }
        con = cur;
        cur = cur.parent;
      }
    }
    expect(viPham, viPham.join("\n  ")).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ LƯỚI CHO CHÍNH LƯỚI — CHÍN HÌNH DẠNG LÁCH, VÀ HAI CA "KHÔNG BẮT NHẦM"
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("N9 — lưới-cho-lưới: mọi hình dạng lách đều ĐỎ", () => {
  const NUT = (than: string) => `function C(){ return (<div>${than}</div>); }`;
  /** Đường thoát THẬT của một nút phá huỷ (đúng khuôn step-up 2FA đang chạy ở panel). */
  const RA_LENH = "onClick={() => stepUp.guard((totpCode) => preempt.mutate({ owner: h.owner, totpCode }))}";
  /** Khung nguồn có **khai** mutation ⇒ lưới nhận ra `preempt` là `trpc.vram.preempt`. */
  const KHUNG = (than: string, truoc = "") =>
    `const preempt = trpc.vram.preempt.useMutation({});\n${truoc}\n${NUT(than)}`;

  /**
   * Sáu hình dạng brief gọi tên + `||` ở điểm dùng + hai của tôi + **ba hình dạng I-3** (nút thứ tư
   * KHÔNG nhãn · marker đặt tên khác · lệnh dời vào một HÀM khai bên trên).
   * ⚠ Mọi mẫu đều mang `onClick` RA LỆNH THẬT — đó là thứ lưới dùng để nhận ra nó là nút lệnh.
   */
  const LACH: Record<string, string> = {
    "biến trung gian": KHUNG(
      `<Button data-testid="vram-preempt" ${RA_LENH} disabled={d} />`,
      "const d = !commandReach.destructive;",
    ),
    "toán tử ?:": KHUNG(`<Button data-testid="vram-preempt" ${RA_LENH} disabled={commandReach.destructive ? false : true} />`),
    "ngắn mạch &&": KHUNG(`<Button data-testid="vram-preempt" ${RA_LENH} disabled={p.isPending && !commandReach.destructive} />`),
    "ngắn mạch ??": KHUNG(`<Button data-testid="vram-preempt" ${RA_LENH} disabled={x ?? vramDestructiveButtonDisabled(commandReach, p)} />`),
    "hằng số": KHUNG(`<Button data-testid="vram-preempt" ${RA_LENH} disabled={false} />`),
    "hàm KHÁC": KHUNG(`<Button data-testid="vram-preempt" ${RA_LENH} disabled={motHamKhac(commandReach, p)} />`),
    "`||` ở ĐIỂM DÙNG (đúng cách lưới đời 2 bị lách)": KHUNG(
      `<Button data-testid="vram-preempt" ${RA_LENH} disabled={dis || false} />`,
      "const dis = vramDestructiveButtonDisabled(commandReach, p);",
    ),
    "★ của TÔI #1 — TRẢI túi props (`disabled` biến mất khỏi cây thuộc tính)": KHUNG(
      `<Button data-testid="vram-preempt" ${RA_LENH} {...{ disabled: false }} />`,
    ),
    "★ của TÔI #2 — đổi tên khi nhập (`as f`) rồi gọi `f(...)`": KHUNG(
      `<Button data-testid="vram-preempt" ${RA_LENH} disabled={f(commandReach, p)} />`,
    ),
    "★★★ I-3/R-1b — nút phá huỷ THỨ TƯ **KHÔNG `data-testid`**, `disabled={false}`": KHUNG(
      `<Button size="sm" variant="destructive" ${RA_LENH} disabled={false}>RV-1</Button>`,
    ),
    "★★★ I-3 — nút phá huỷ mang **marker TÊN KHÁC** (danh sách trắng vô dụng)": KHUNG(
      `<Button data-testid="nut-khac" ${RA_LENH} disabled={false} />`,
    ),
    "★★★ I-3 — nút ĐÚNG vị từ nhưng **KHÔNG NHÃN** (truy vết)": KHUNG(
      `<Button ${RA_LENH} disabled={vramDestructiveButtonDisabled(commandReach, p)} />`,
    ),
    "★★★ I-3 — lệnh dời vào một HÀM khai bên trên (`onClick={handlePreempt}`)": KHUNG(
      '<Button data-testid="vram-preempt" onClick={handlePreempt} disabled={false} />',
      "const handlePreempt = () => stepUp.guard((totpCode) => preempt.mutate({ owner, totpCode }));",
    ),
  };

  for (const [ten, nguon] of Object.entries(LACH)) {
    it(`bị BẮT: ${ten}`, () => {
      const r = soiNutTheoDuongThoat(ast("t.tsx", nguon));
      expect(r.soi, "lưới phải THẤY cái nút (nếu 0 thì nó mù, không phải nó sạch)").toBeGreaterThan(0);
      expect(r.viPham.length, `hình dạng lách phải bị bắt: ${nguon}`).toBeGreaterThan(0);
    });
  }

  it("chiều DƯƠNG — hình dạng ĐÚNG lọt qua (lưới không phải một cái cấm-tất-cả)", () => {
    const r = soiNutTheoDuongThoat(
      ast("t.tsx", KHUNG(`<Button data-testid="vram-preempt" ${RA_LENH} disabled={vramDestructiveButtonDisabled(commandReach, preempt.isPending)} />`)),
    );
    expect(r.soi).toBe(1);
    expect(r.viPham).toEqual([]);
  });

  it("★★ bị BẮT: MỘT nút ra HAI lệnh khác sàn quyền — không vị từ nào nói đúng cho cả hai", () => {
    const nguon =
      "const preempt = trpc.vram.preempt.useMutation({});\nconst retryDeferred = trpc.vram.retryDeferred.useMutation({});\n" +
      NUT('<Button data-testid="vram-preempt" onClick={() => { preempt.mutate({}); retryDeferred.mutate({}); }} disabled={vramDestructiveButtonDisabled(commandReach, p)} />');
    expect(soiNutTheoDuongThoat(ast("t.tsx", nguon)).viPham.length).toBeGreaterThan(0);
  });

  it("★★ đổi TÊN BIẾN mutation không thoát được (lưới đọc `trpc.vram.*.useMutation` trên CÂY)", () => {
    const nguon =
      "const zz = trpc.vram.preempt.useMutation({});\n" +
      NUT('<Button data-testid="vram-preempt" onClick={() => zz.mutate({})} disabled={false} />');
    expect(soiNutTheoDuongThoat(ast("t.tsx", nguon)).viPham.length).toBeGreaterThan(0);
  });

  /**
   * ★★★ HÌNH DẠNG CỦA TÔI #3 — **NÚT THỨ HAI MANG CÙNG MỘT MARKER.**
   *
   * ⚠⚠ Lỗ **THẬT trong bộ máy đang có ở HEAD**: `thuocTinh()` của `vramCommandReach.unit.test.ts`
   * dùng `ra ??=` ⇒ **dừng ở phần tử ĐẦU TIÊN**. Giữ nguyên nút đúng rồi **thêm** một nút thứ hai
   * cùng `data-testid` với `disabled={false}` thì lưới đời trước **XANH**, `tsc` sạch, ship được.
   * ⇒ Lưới ở file này lượng-từ-hoá bằng **MỌI**, không phải **CÓ MỘT** — và từ I-3, tập phần tử
   * còn được chọn theo **ĐƯỜNG THOÁT**, nên nút thứ hai không cần mang marker cũng bị bắt.
   */
  it("★★★ bị BẮT: nút THỨ HAI cùng marker (lỗ `ra ??=` của bộ máy đời trước — chứng minh bằng đối chứng)", () => {
    const nguon = KHUNG(
      `<Button data-testid="vram-preempt" ${RA_LENH} disabled={vramDestructiveButtonDisabled(commandReach, p)} />` +
        `<Button data-testid="vram-preempt" ${RA_LENH} disabled={false} />`,
    );
    const sf = ast("t.tsx", nguon);

    // Bộ máy ĐỜI TRƯỚC (first-match) — XANH, tức lách được.
    const doiTruoc = (marker: string, ten: string): ts.Node | null => {
      let ra: ts.Node | null = null;
      for (const el of moiPhanTuCoMarker(sf, marker)) {
        if (ra === null) ra = bieuThucThuocTinh(el, sf, ten);
      }
      return ra;
    };
    expect(
      laLoiGoi(doiTruoc("vram-preempt", "disabled"), "vramDestructiveButtonDisabled"),
      "đối chứng: bộ máy first-match KHÔNG thấy nút thứ hai",
    ).toBe(true);

    // Bộ máy của file này — ĐỎ.
    const r = soiNutTheoDuongThoat(sf);
    expect(r.soi).toBe(2);
    expect(r.viPham.length, "nút thứ hai PHẢI bị bắt").toBe(1);
  });

  it("★★★ bị BẮT: cái NUÔI bị lách — `commandReach={...}` thôi LÀ một lời gọi", () => {
    const LACH_NUOI: Record<string, string> = {
      "biến trung gian": `const r = vramCommandReach(user?.role); <${PANEL_TAG} commandReach={r} polling={p} />`,
      "`||` ghép thêm": `<${PANEL_TAG} commandReach={vramCommandReach(user?.role) || fallback} polling={p} />`,
      "?:": `<${PANEL_TAG} commandReach={isOpsRole ? A : B} polling={p} />`,
      "hàm KHÁC": `<${PANEL_TAG} commandReach={motHamKhac(user?.role)} polling={p} />`,
      "thiếu hẳn thuộc tính": `<${PANEL_TAG} polling={p} />`,
      "★ điểm dựng THỨ HAI ở FILE KHÁC (đột biến M3)": `<${PANEL_TAG} commandReach={vramCommandReach(u)} polling={p} /><${PANEL_TAG} commandReach={boss} polling={p} />`,
    };
    for (const [ten, than] of Object.entries(LACH_NUOI)) {
      const r = soiCaiNuoi(ast("t.tsx", NUT(than)));
      expect(r.soi, `${ten}: lưới phải THẤY panel`).toBeGreaterThan(0);
      expect(r.viPham.length, `${ten} PHẢI bị bắt`).toBeGreaterThan(0);
    }
  });

  it("★★★ bị BẮT: Ô THỨ HAI dưới MỌI hình dạng rẽ nhánh (lưới hỏi NƠI XUẤT HIỆN, không hỏi hình dạng)", () => {
    // ⚠ Nguồn ĐẦY ĐỦ, không phải một mảnh JSX: một câu lệnh nhét vào giữa `<div>…</div>` sẽ được
    //   phân tích thành **văn bản JSX** (không có node định danh nào) và ca sẽ xanh vì lý do sai.
    const O_THU_HAI: Record<string, string> = {
      "ngắn mạch && bọc render": NUT(
        '{commandReach.destructive && <Button data-testid="vram-preempt" disabled={vramDestructiveButtonDisabled(commandReach, p)} />}',
      ),
      "?: bọc render": NUT(
        '{commandReach.destructive ? <Button data-testid="vram-preempt" disabled={vramDestructiveButtonDisabled(commandReach, p)} /> : null}',
      ),
      "component CON nhận grant": NUT("<Row grant={commandReach} />"),
      "biến trung gian": "function C(){ const g = commandReach; return g.destructive ? null : null; }",
      "gán vào một ô của object khác": "const cfg = { grant: commandReach };",
      "so sánh trực tiếp trong JSX": NUT("{String(commandReach.actuation)}"),
    };
    for (const [ten, nguon] of Object.entries(O_THU_HAI)) {
      const r = soiOThuHai(ast("t.tsx", nguon));
      expect(r.viPham.length, `${ten} PHẢI bị bắt`).toBeGreaterThan(0);
    }
  });

  it("★★★ bị BẮT: TRẢ VỀ SỚM (hình dạng đã lách lưới Task 2 ở vòng thứ ba)", () => {
    const nguon = `function C(){ if (!commandReach.destructive) { return null; } return (<Button data-testid="vram-preempt" disabled={vramDestructiveButtonDisabled(commandReach, p)} />); }`;
    expect(soiOThuHai(ast("t.tsx", nguon)).viPham.length).toBeGreaterThan(0);
  });

  // ────────────────────────────────────────────────────────────────────────────────────────────
  // KHÔNG BẮT NHẦM — một lưới quá rộng chỉ đường tới bản vá SAI (bài học m2-2).
  // ────────────────────────────────────────────────────────────────────────────────────────────

  it("★★ KHÔNG BẮT NHẦM — nút/spinner của các query & lệnh KHÁC nằm ngoài phạm vi", () => {
    /**
     * ⚠⚠ Sau I-3 lưới rộng hơn (mọi phần tử ra lệnh, không chỉ ba marker) ⇒ ca này QUAN TRỌNG HƠN
     * TRƯỚC: một lệnh **KHÁC** (`tripMut` = `trpc.aiAgent.tripKillSwitch`) có `.mutate(` y hệt về
     * hình dạng. Lưới chỉ được nhận nó là nút lệnh khi mutation ấy là `trpc.vram.*`.
     */
    const nguon =
      "const preempt = trpc.vram.preempt.useMutation({});\nconst tripMut = trpc.aiAgent.tripKillSwitch.useMutation({});\nconst cancelMut = trpc.aiAgent.cancelSession.useMutation({});\n" +
      NUT(
        "<Button disabled={tripMut.isPending || reason.length < 3} onClick={() => tripMut.mutate({ reason })} />" +
          "<Button onClick={() => cancelMut.mutate({ id })} />" +
          "{preempt.isPending ? <Spinner /> : null}" +
          "{state.isLoading ? <Skeleton /> : null}" +
          '<Button data-testid="khac" disabled={x || y} />' +
          `<Button data-testid="vram-preempt" ${RA_LENH} disabled={vramDestructiveButtonDisabled(commandReach, preempt.isPending)} />`,
      );
    const sf = ast("t.tsx", nguon);
    const r = soiNutTheoDuongThoat(sf);
    expect(r.viPham, r.viPham.map((v) => v.noi).join("\n")).toEqual([]);
    // ⚠ Cầu chì HAI chiều: lưới phải thấy ĐÚNG MỘT nút — không 0 (mù), không 3 (bắt nhầm hai lệnh kia).
    expect(r.soi, "chỉ nút VRAM mới trong phạm vi; hai nút aiAgent phải ở NGOÀI").toBe(1);
    expect(soiOThuHai(sf).viPham).toEqual([]);
    // Cầu chì: nguồn thật sự CÓ những `.mutate(` và `disabled` không phải lời gọi vị từ.
    expect(nguon).toMatch(/disabled=\{tripMut\.isPending/);
    expect(nguon).toMatch(/tripMut\.mutate\(/);
  });

  it("★★ KHÔNG BẮT NHẦM — khai báo (`interface` · destructure · TÊN thuộc tính JSX) không phải tham chiếu", () => {
    const nguon =
      "interface Props { commandReach: VramCommandReach } " +
      "function P({ commandReach, polling }: Props){ return (<Button data-testid=\"vram-preempt\" disabled={vramDestructiveButtonDisabled(commandReach, p)} />); } " +
      `function Q(){ return (<${PANEL_TAG} commandReach={vramCommandReach(user?.role)} polling={p} />); }`;
    const r = soiOThuHai(ast("t.tsx", nguon));
    expect(r.viPham, r.viPham.map((v) => v.noi).join("\n")).toEqual([]);
    expect(r.hopLe, "phải đếm được tham chiếu HỢP LỆ").toBeGreaterThan(0);
  });

  it("★★ KHÔNG BẮT NHẦM — file `.tsx` không dính dáng gì tới VRAM cho 0 vi phạm", () => {
    const nguon = NUT('<Button disabled={a || b} onClick={() => m.mutate({})} />');
    const sf = ast("t.tsx", nguon);
    expect(soiNutTheoDuongThoat(sf).soi).toBe(0);
    expect(soiCaiNuoi(sf).soi).toBe(0);
    expect(soiOThuHai(sf).viPham).toEqual([]);
  });
});
