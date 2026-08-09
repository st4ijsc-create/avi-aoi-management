/**
 * ★★★ Pha 5 Task 3 (N9) — **VAI NÀO VỚI TỚI MẶT LỆNH VRAM, VÀ AI NUÔI CÁI NÚT.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO LƯỚI NÀY TỒN TẠI: VỊ TỪ NÚT ĐÚNG ĐẾN MẤY CŨNG VÔ NGHĨA NẾU **CÁI NUÔI NÓ** SAI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `pages/AIBrainDashboard.tsx:114` khai `isOpsRole = role === "admin" || role === "engineer"` rồi
 * đổ **thẳng** vào prop nuôi **cả ba** nút lệnh của `VramBrokerPanel`. Hệ quả đo được:
 *  • `supervisor` — vai chủ dự án chọn cho mặt lệnh VRAM, và **đã có** trong `ACTUATION_ROLES`
 *    (`server/_core/trpc.ts:495`) — **KHÔNG BAO GIỜ** nhận `true`. Task 3 có viết vị từ hoàn hảo
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
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import {
  vramCommandReach,
  vramDestructiveButtonDisabled,
  vramRetryButtonDisabled,
  VRAM_LENH_GATE,
  type CoBitQuyen,
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

/**
 * ★ Task 3b (I-2) — người đọc bit quyền **CẤP ĐỦ MỌI THỨ**. Dùng cho mọi ca của TẦNG 1: nó cô lập
 * đúng **vế VAI**, để những khẳng định N9 vốn có giữ nguyên nghĩa. Vế **BIT** có bộ ca riêng ngay
 * dưới — trộn hai vế vào một ca thì không ca nào còn nói được về vế nào.
 */
const CO_DU_BIT: CoBitQuyen = () => true;

describe("N9 — `vramCommandReach`: vai nào với tới mặt lệnh VRAM", () => {
  for (const [vai, mong] of Object.entries(MONG_DOI) as [VramCommandRole, { destructive: boolean; actuation: boolean }][]) {
    it(`${vai} ⇒ phá huỷ ${mong.destructive ? "ĐƯỢC" : "KHÔNG"} · actuation ${mong.actuation ? "ĐƯỢC" : "KHÔNG"}`, () => {
      const r = vramCommandReach(vai, CO_DU_BIT);
      expect(Boolean(r.destructive)).toBe(mong.destructive);
      expect(Boolean(r.actuation)).toBe(mong.actuation);
    });
  }

  it("★★★ QUYẾT ĐỊNH CỦA CHỦ DỰ ÁN — `supervisor` ⇒ hai nút PHÁ HUỶ BẬT (đây là cả lý do Task 3 tồn tại)", () => {
    expect(vramDestructiveButtonDisabled(vramCommandReach("supervisor", CO_DU_BIT), false)).toBe(false);
  });

  it("★★★ `engineer` ⇒ hai nút PHÁ HUỶ TẮT — máy chủ chặn ĐỘC LẬP (`canDelete` không có; C3: OTP tươi vẫn 403)", () => {
    expect(vramDestructiveButtonDisabled(vramCommandReach("engineer", CO_DU_BIT), false)).toBe(true);
  });

  it("★★★ `operator` ⇒ TẮT · `admin` ⇒ BẬT", () => {
    expect(vramDestructiveButtonDisabled(vramCommandReach("operator", CO_DU_BIT), false)).toBe(true);
    expect(vramDestructiveButtonDisabled(vramCommandReach("admin", CO_DU_BIT), false)).toBe(false);
  });

  it("★★ ĐÚNG HAI vai với tới lệnh PHÁ HUỶ — thêm một vai nữa là nới quyền, phải cố ý", () => {
    const cho = (Object.keys(MONG_DOI) as VramCommandRole[]).filter((v) => vramCommandReach(v, CO_DU_BIT).destructive);
    expect(cho.sort()).toEqual(["admin", "supervisor"]);
  });

  it("★★ BA vai với tới lệnh KHÔNG phá huỷ (`retryDeferred` = `canCreate`) — `engineer` NẰM TRONG", () => {
    // ⚠ Chiều NGƯỢC của lời nói dối: cắt nút này khỏi `engineer` là "hứa ÍT hơn máy chủ cho phép".
    const cho = (Object.keys(MONG_DOI) as VramCommandRole[]).filter((v) => vramCommandReach(v, CO_DU_BIT).actuation);
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
      const r = vramCommandReach(x, CO_DU_BIT);
      expect(Boolean(r.destructive), `destructive cho ${String(x)}`).toBe(false);
      expect(Boolean(r.actuation), `actuation cho ${String(x)}`).toBe(false);
    }
  });

  it("★★ `isPending` khoá nút kể cả với vai ĐỦ quyền (chống bấm đúp một lệnh phá huỷ)", () => {
    expect(vramDestructiveButtonDisabled(vramCommandReach("admin", CO_DU_BIT), true)).toBe(true);
    expect(vramDestructiveButtonDisabled(vramCommandReach("supervisor", CO_DU_BIT), true)).toBe(true);
  });

  it("★★ nút *Thử lại ngay* nhân BA điều kiện: tầm với vai × `retryReach` × `isPending`", () => {
    const KIND: VramDeferRetryReachKind[] = ["reachable-here", "unreachable", "unknown"];
    for (const vai of Object.keys(MONG_DOI) as VramCommandRole[]) {
      for (const k of KIND) {
        for (const pending of [true, false]) {
          const mong = !MONG_DOI[vai].actuation || pending || k !== "reachable-here";
          expect(
            vramRetryButtonDisabled(k, vramCommandReach(vai, CO_DU_BIT), pending),
            `${vai}/${k}/pending=${String(pending)}`,
          ).toBe(mong);
        }
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// TẦNG 1b (Task 3b · I-2) — **VẾ THỨ HAI: BIT PER-USER.**
//
// ⚠⚠ Vai KHÔNG phải thẩm quyền. Trước 3b bit là `machine_control` — module ấy **có** trong
// `DEFAULT_ROLE_PERMISSIONS`, nên "supervisor ⇒ bấm được" gần đúng. Sau 3b bit là `vram_control`,
// module **cố ý không bao giờ vào khuôn vai** ⇒ nếu quyết định vẫn chỉ theo vai thì
// `supervisor` **chưa được cấp tay** vẫn thấy nút bấm được cho một lệnh chắc chắn 403 —
// **sai VĨNH VIỄN**, đúng lớp lỗi "mặt đọc hứa nhiều hơn mặt lệnh" mà Pha 5 đang đóng.
// ⇒ Quyết định phải là **phép HỘI** của đúng hai cổng máy chủ có, và bộ ca dưới khoá cả hai chiều.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("Task 3b (I-2) — nút VRAM đòi ĐỦ HAI vế: sàn VAI **và** bit PER-USER `vram_control`", () => {
  /** Người đọc quyền chỉ cấp đúng những cặp được liệt kê; mọi cặp khác ⇒ `false`. */
  function chiCap(...cap: { module: string; action: string }[]): CoBitQuyen {
    return (m, a) => cap.some((c) => c.module === m && c.action === a);
  }

  it("★★★ supervisor CÓ vai nhưng CHƯA được cấp bit ⇒ **cả hai nút TẮT** (không hứa quá mặt lệnh)", () => {
    const r = vramCommandReach("supervisor", () => false);
    expect(Boolean(r.destructive)).toBe(false);
    expect(Boolean(r.actuation)).toBe(false);
    expect(vramDestructiveButtonDisabled(r, false), "nút phá huỷ PHẢI khoá").toBe(true);
  });

  it("★★★ supervisor được cấp ĐÚNG `vram_control/canDelete` ⇒ nút phá huỷ BẬT; chỉ `canCreate` ⇒ TẮT", () => {
    const chiXoa = vramCommandReach("supervisor", chiCap(VRAM_LENH_GATE.destructive));
    expect(Boolean(chiXoa.destructive)).toBe(true);
    expect(Boolean(chiXoa.actuation), "không có canCreate ⇒ *Thử lại ngay* phải tắt").toBe(false);

    const chiTao = vramCommandReach("supervisor", chiCap(VRAM_LENH_GATE.actuation));
    expect(Boolean(chiTao.destructive), "không có canDelete ⇒ hai nút phá huỷ phải tắt").toBe(false);
    expect(Boolean(chiTao.actuation)).toBe(true);
  });

  it("★★★ bit được hỏi phải ĐÚNG cặp `(vram_control, canDelete|canCreate)` — không phải `machine_control`", () => {
    const hoi: string[] = [];
    vramCommandReach("supervisor", (m, a) => {
      hoi.push(`${m}/${a}`);
      return true;
    });
    expect([...new Set(hoi)].sort()).toEqual(["vram_control/canCreate", "vram_control/canDelete"]);
  });

  it("★★★ CÓ ĐỦ BIT nhưng vai KHÔNG trong sàn actuation ⇒ vẫn TẮT (bit không mua được sàn vai)", () => {
    for (const vai of ["operator", "viewer", "maintenance", "quality_inspector", "user"] as VramCommandRole[]) {
      const r = vramCommandReach(vai, CO_DU_BIT);
      expect(Boolean(r.destructive), `${vai} destructive`).toBe(false);
      expect(Boolean(r.actuation), `${vai} actuation`).toBe(false);
    }
  });

  it("★★★ người đọc quyền HỎNG ⇒ chiều CHẶT: thiếu · không phải hàm · ném · trả thứ không phải `true`", () => {
    const hong: unknown[] = [
      undefined,
      null,
      "khong-phai-ham",
      () => {
        throw new Error("người đọc quyền vỡ");
      },
      () => 1,
      () => "true",
      () => ({}),
    ];
    for (const h of hong) {
      const r = vramCommandReach("supervisor", h as CoBitQuyen);
      expect(Boolean(r.destructive), `destructive với ${String(h)}`).toBe(false);
      expect(Boolean(r.actuation), `actuation với ${String(h)}`).toBe(false);
    }
  });

  it("★★ `VRAM_LENH_GATE` có NGƯỜI ĐỌC SẢN PHẨM — không phải đồng hồ không kim", () => {
    // ⚠ Cầu chì cho chính lưới này: nếu vị từ thôi đọc `VRAM_LENH_GATE` thì đổi module ở đó sẽ
    // KHÔNG đổi cặp được hỏi ⇒ ca dưới ĐỎ. (Luật Task 4 Pha 4: có người đọc thật, hoặc bị xoá.)
    const hoi: string[] = [];
    vramCommandReach("admin", (m, a) => {
      hoi.push(`${m}/${a}`);
      return true;
    });
    expect(hoi).toContain(`${VRAM_LENH_GATE.destructive.module}/${VRAM_LENH_GATE.destructive.action}`);
    expect(hoi).toContain(`${VRAM_LENH_GATE.actuation.module}/${VRAM_LENH_GATE.actuation.action}`);
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

/** Khoá router của **mặt ĐỌC** — cố ý ở lại `machine_control/canView` (N8), không có nút nào. */
const MAT_DOC = "state";

/**
 * ★★★ C-1 (review TOÀN NHÁNH) — nửa còn lại của ÁNH XẠ. `VI_TU_THEO_THU_TUC` (dưới) nói *"nút của
 * thủ tục nào dùng vị từ nào"*; bảng này nói *"vị từ ấy hỏi bit nào"*. Ghép hai bảng lại thì
 * **thủ tục máy chủ → bit mà client thật sự hỏi** trở thành một hàm tính được, và so được với
 * **thủ tục máy chủ → bit máy chủ đứng trên**.
 */
const CONG_CUA_VI_TU: Readonly<Record<string, { readonly module: string; readonly action: string }>> = {
  vramDestructiveButtonDisabled: VRAM_LENH_GATE.destructive,
  vramRetryButtonDisabled: VRAM_LENH_GATE.actuation,
};

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠⚠ C-1 — VÌ SAO BỘ QUÉT NÀY **CỐ Ý** KHÔNG DÙNG LẠI BỘ QUÉT CỦA `vramPermissionSplit.test.ts`
//
// Cả pha này dựng hai cổng và gọi chúng là *"nguồn ĐỘC LẬP"*. Review toàn nhánh đo được rằng độc
// lập về **mã** mà **trùng về LƯỢNG TỪ** thì cả hai cùng mù: cả hai rút ra một **TẬP** chuỗi
// `module/action` rồi so tập, nên **hoán vị** `canDelete` ↔ `canCreate` giữa hai thủ tục giữ
// nguyên tập ⇒ **cả hai XANH**, và bản vá ấy **ship được**.
// ⇒ Sửa **lượng từ** (nay là ÁNH XẠ theo khoá router), **giữ** sự độc lập của mã: gộp hai bộ quét
// thành một hàm dùng chung sẽ làm client và máy chủ **đồng ý theo cấu tạo**, tức xoá sạch cái duy
// nhất khiến câu *"gương khớp máy chủ"* có nghĩa.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Đọc `vramRouter.ts` ra **ánh xạ khoá-router → cổng `module/action`**, phân giải qua biến, qua
 * alias, và qua chuỗi viết inline.
 *
 * ⚠ Không phân giải được ⇒ vào `mu` (ĐỎ), **không** bỏ qua im lặng.
 */
function congTheoThuTuc(nguon?: string): { anhXa: Record<string, string>; mu: string[] } {
  const ma = nguon ?? readFileSync(VRAM_ROUTER, "utf8");
  const sf = ts.createSourceFile(VRAM_ROUTER, ma, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hang = new Map<string, string>([["VRAM_CONTROL_MODULE", VRAM_CONTROL_MODULE]]);
  const val = (n: ts.Node | undefined): string | null =>
    n === undefined ? null : ts.isStringLiteral(n) ? n.text : ts.isIdentifier(n) ? (hang.get(n.text) ?? null) : null;

  /** MỌI `requirePermission(M, A)` nằm trong một biểu thức. */
  const congTrong = (n: ts.Node): string[] => {
    const ra: string[] = [];
    const di = (x: ts.Node): void => {
      if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === "requirePermission") {
        ra.push(`${val(x.arguments[0]) ?? "?"}/${val(x.arguments[1]) ?? "?"}`);
      }
      ts.forEachChild(x, di);
    };
    di(n);
    return ra;
  };

  const bien = new Map<string, { cong: string[]; goc: string | null }>();
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const d of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.initializer === undefined) continue;
      bien.set(d.name.text, { cong: congTrong(d.initializer), goc: gocCuaChuoi(d.initializer) });
    }
  }
  /** Leo ngược chuỗi biến, gom mọi cổng gặp trên đường (alias không giấu được cổng của gốc). */
  const leo = (bd: string | null): string[] => {
    const ra: string[] = [];
    let cur = bd;
    for (let i = 0; i < 16 && cur !== null; i++) {
      const b = bien.get(cur);
      if (b === undefined) return ra;
      ra.push(...b.cong);
      cur = b.goc;
    }
    return ra;
  };

  const anhXa: Record<string, string> = {};
  const mu: string[] = [];
  const di = (n: ts.Node): void => {
    const arg0 = ts.isCallExpression(n) ? n.arguments[0] : undefined;
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "router" &&
      arg0 !== undefined &&
      ts.isObjectLiteralExpression(arg0)
    ) {
      for (const p of arg0.properties) {
        const dong = sf.getLineAndCharacterOfPosition(p.getStart(sf)).line + 1;
        if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) {
          mu.push(`vramRouter.ts:${dong} — ô của router KHÔNG phải \`tên: <chuỗi thủ tục>\``);
          continue;
        }
        const tatCa = [...new Set([...congTrong(p.initializer), ...leo(gocCuaChuoi(p.initializer))])].sort();
        if (tatCa.length !== 1 || tatCa[0]?.includes("?") === true) {
          mu.push(`vramRouter.ts:${dong} \`${p.name.text}\` — cổng: [${tatCa.join(", ")}]`);
          continue;
        }
        anhXa[p.name.text] = tatCa[0] as string;
      }
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return { anhXa, mu };
}

/**
 * Tên BIẾN thủ tục mà một khoá router đứng trên — đọc từ **CÂY**, không chép tay.
 *
 * ⚠⚠ Ô này tồn tại vì một phép thử **đã bắt được chính lưới này bắt nhầm**: các ca lưới-cho-lưới
 * dưới đây dựng đột biến bằng cách **thay chuỗi** trên nguồn thật, nên khi ai đó **đổi tên biến**
 * (một lượt dọn dẹp **hợp lệ**) thì phép thay thành no-op ⇒ mutant **bằng** bản gốc ⇒ ca *"phải ĐỎ"*
 * xanh-hoá thành đỏ **vì lý do sai**, và câu lỗi **không** nói *"bạn vừa đổi tên biến"*.
 * ⇒ Neo mẫu đột biến vào **cái mà cây nói**, không vào một chuỗi ai đó sở hữu.
 */
function bienThuTuc(khoa: string, nguon: string): string {
  const sf = ts.createSourceFile(VRAM_ROUTER, nguon, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let ra: string | null = null;
  const di = (n: ts.Node): void => {
    const arg0 = ts.isCallExpression(n) ? n.arguments[0] : undefined;
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "router" &&
      arg0 !== undefined &&
      ts.isObjectLiteralExpression(arg0)
    ) {
      for (const p of arg0.properties) {
        if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === khoa) {
          ra = gocCuaChuoi(p.initializer);
        }
      }
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  if (ra === null) throw new Error(`không đọc được biến thủ tục của \`${khoa}\` — vramRouter đổi hình dạng?`);
  return ra;
}

describe("Task 3b + C-1 — cổng quyền client KHAI phải trùng cổng máy chủ ĐỨNG TRÊN, THEO TỪNG THỦ TỤC", () => {
  it("★★★ C-1 — ÁNH XẠ `thủ tục → bit` khớp TỪNG CẶP giữa `vramRouter` và vị từ nút mà client chọn", () => {
    /**
     * ⚠⚠ Bất biến **CHỦ** của gương. Bản trước hỏi *"tập cổng máy chủ có chứa hai cổng client khai
     * không"* — một câu về **TẬP**, nên hoán vị hai bit giữa hai thủ tục là vô hình. Nay với **mỗi**
     * thủ tục lệnh của máy chủ, ta tính ra bit mà client **thật sự** hỏi cho nút của nó
     * (`VI_TU_THEO_THU_TUC` → `CONG_CUA_VI_TU`) và đòi nó bằng bit máy chủ đứng trên.
     */
    const { anhXa, mu } = congTheoThuTuc();
    expect(mu.join("\n"), "một ô không phân giải được là một ô KHÔNG AI CANH").toBe("");
    expect(Object.keys(anhXa).length, "không đọc được thủ tục nào — vramRouter đã đổi hình dạng?").toBeGreaterThan(0);

    // Mặt ĐỌC cố ý ở lại `machine_control/canView` — loại ra TƯỜNG MINH, không im lặng.
    expect(anhXa[MAT_DOC], "mặt đọc phải vẫn là quyết định N8").toBe("machine_control/canView");
    const lenh = Object.fromEntries(Object.entries(anhXa).filter(([k]) => k !== MAT_DOC));

    // Chiều ĐỦ: mọi thủ tục LỆNH của máy chủ đều có một nút được khai ở client, và ngược lại.
    expect(Object.keys(lenh).sort(), "client và máy chủ phải nói về ĐÚNG cùng tập thủ tục lệnh").toEqual(
      Object.keys(VI_TU_THEO_THU_TUC).sort(),
    );

    // Chiều ĐÚNG: từng cặp.
    const lech: string[] = [];
    for (const [thuTuc, congMay] of Object.entries(lenh)) {
      const viTu = VI_TU_THEO_THU_TUC[thuTuc];
      const cong = viTu === undefined ? undefined : CONG_CUA_VI_TU[viTu];
      const congClient = cong === undefined ? "(không khai)" : `${cong.module}/${cong.action}`;
      if (congClient !== congMay) {
        lech.push(`${thuTuc}: máy chủ đứng trên \`${congMay}\` nhưng nút client hỏi \`${congClient}\` (vị từ ${viTu ?? "?"})`);
      }
    }
    expect(lech.join("\n")).toBe("");
  });

  it("★★★ W1 — HOÁN VỊ `canDelete` ↔ `canCreate` giữa hai thủ tục máy chủ ⇒ ĐỎ (dù TẬP không đổi)", () => {
    const goc = readFileSync(VRAM_ROUTER, "utf8");
    const ma = goc
      .replace('deployProcedure.use(requirePermission(VRAM_CONTROL_MODULE, "canDelete"))', "@D@")
      .replace('actuationProcedure.use(requirePermission(VRAM_CONTROL_MODULE, "canCreate"))', "@A@")
      .replace("@D@", 'deployProcedure.use(requirePermission(VRAM_CONTROL_MODULE, "canCreate"))')
      .replace("@A@", 'actuationProcedure.use(requirePermission(VRAM_CONTROL_MODULE, "canDelete"))');
    expect(ma, "đột biến phải thật sự đổi được nguồn").not.toBe(goc);

    const { anhXa, mu } = congTheoThuTuc(ma);
    expect(mu.join("\n")).toBe("");

    // ⚠ ĐỐI CHỨNG — lưới đời trước (**TẬP**) vẫn XANH dưới đúng đột biến này.
    const khai = [
      `${VRAM_LENH_GATE.destructive.module}/${VRAM_LENH_GATE.destructive.action}`,
      `${VRAM_LENH_GATE.actuation.module}/${VRAM_LENH_GATE.actuation.action}`,
    ];
    const tap = Object.values(anhXa);
    for (const k of khai) expect(tap, "TẬP vẫn chứa đủ hai cổng — đó là toàn bộ lý do C-1 lọt").toContain(k);
    expect(tap.filter((c) => !khai.includes(c) && c !== "machine_control/canView").join(" · ")).toBe("");

    // Lưới MỚI: từng cặp lệch.
    expect(anhXa.preempt).toBe(`${VRAM_CONTROL_MODULE}/canCreate`);
    const viTu = VI_TU_THEO_THU_TUC.preempt as string;
    const cong = CONG_CUA_VI_TU[viTu] as { module: string; action: string };
    expect(`${cong.module}/${cong.action}`, "nút phá huỷ của client vẫn hỏi `canDelete` ⇒ LỆCH").not.toBe(anhXa.preempt);
  });

  it("★★★ HÌNH DẠNG CỦA TÔI — ALIAS thủ tục (`const c = <thủ tục actuation>`) ⇒ ĐỎ", () => {
    const goc = readFileSync(VRAM_ROUTER, "utf8");
    const tenPhaHuy = bienThuTuc("preempt", goc);
    const tenActuation = bienThuTuc("retryDeferred", goc);
    const ma = goc
      .replace("export const vramRouter = router({", `const congPhaHuy = ${tenActuation};\nexport const vramRouter = router({`)
      .replace(`preempt: ${tenPhaHuy}`, "preempt: congPhaHuy");
    expect(ma, "đột biến phải thật sự đổi được nguồn").not.toBe(goc);

    const { anhXa, mu } = congTheoThuTuc(ma);
    expect(mu.join("\n")).toBe("");
    expect(ma, "đối chứng: tên biến cũ vẫn còn trong file").toContain(tenPhaHuy);
    expect(anhXa.preempt, "alias KHÔNG giấu được cổng của gốc").toBe(`${VRAM_CONTROL_MODULE}/canCreate`);
  });

  it("★★★ thủ tục MỚI ở máy chủ mà client chưa khai nút ⇒ ĐỎ (không có phần tử thứ N+1 im lặng)", () => {
    const goc = readFileSync(VRAM_ROUTER, "utf8");
    const ma = goc.replace(
      "export const vramRouter = router({",
      `export const vramRouter = router({\n  killAll: ${bienThuTuc("preempt", goc)}.mutation(async () => 1),`,
    );
    expect(ma, "đột biến phải thật sự đổi được nguồn").not.toBe(goc);
    const { anhXa } = congTheoThuTuc(ma);
    const lenh = Object.keys(anhXa).filter((k) => k !== MAT_DOC);
    expect(lenh.sort()).not.toEqual(Object.keys(VI_TU_THEO_THU_TUC).sort());
    expect(lenh).toContain("killAll");
  });

  it("★★ KHÔNG BẮT NHẦM — đổi TÊN BIẾN thủ tục ở máy chủ (dọn dẹp hợp lệ) ⇒ VẪN XANH", () => {
    const goc = readFileSync(VRAM_ROUTER, "utf8");
    // ⚠ Tên mới DẪN XUẤT từ tên cũ ⇒ phép đổi LUÔN là một thay đổi thật, kể cả khi ai đó vừa đổi
    //   tên biến ở sản xuất thành đúng cái tên mà ca này bịa ra (đã xảy ra trong lượt đo).
    const ma = goc.split(bienThuTuc("preempt", goc)).join(`${bienThuTuc("preempt", goc)}Doi`);
    expect(ma, "phép đổi tên phải là một thay đổi THẬT").not.toBe(goc);
    const { anhXa, mu } = congTheoThuTuc(ma);
    expect(mu.join("\n")).toBe("");
    expect(anhXa.preempt).toBe(`${VRAM_CONTROL_MODULE}/canDelete`);
    expect(anhXa.releaseStale).toBe(`${VRAM_CONTROL_MODULE}/canDelete`);
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
  // `deployProcedure` + `vram_control/canDelete` — PHÁ HUỶ. (Bit đã tách ở Task 3b; bảng này
  // **chịu tải** từ C-1: ca "ÁNH XẠ" trên ghép nó với `CONG_CUA_VI_TU` rồi so với `vramRouter`.)
  preempt: "vramDestructiveButtonDisabled",
  releaseStale: "vramDestructiveButtonDisabled",
  // `actuationProcedure` + `vram_control/canCreate`.
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

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ Pha 7 Task 4b — **I-3 XUYÊN FILE: `disabled` PHẢI ĐI ĐƯỢC TỚI MỘT THẺ THẬT.**
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠⚠ ĐO ĐƯỢC TRƯỚC BẢN VÁ (2026-08-09) — LỖ IM LẶNG, KHÔNG PHẢI "CẦU CHÌ ĐỎ"
// ══════════════════════════════════════════════════════════════════════════════════════════════
// Kế hoạch Pha 7 chép lại rằng prop-drilling một lệnh VRAM ra file khác là *"cầu chì đỏ"*. **Đo
// lại thì không.** Hai lượt đột biến:
//
//  • **P1** — thêm `<NutPhaHuyDotBien onXoa={() => preempt.mutate(…)} disabled={vramDestructive…}
//    data-testid="…"/>`, component con ở **FILE KHÁC** nhận `disabled` rồi **vứt đi**:
//    lưới I-3 (ca ngay trên) **XANH**. Chỉ một ca **GHIM SỐ điểm gọi** ở
//    `vramPanelStepUp.unit.test.ts` đỏ — tức bị bắt **vì một con số**, không vì bất biến.
//  • **P2** — **thay hẳn** nút *"Thu hồi"* THẬT bằng chính component ấy (số điểm gọi **không đổi**):
//    **`client/src/lib/` 529/529 XANH**. Nghĩa là **nút GIẾT tiến trình mở cho MỌI vai đăng nhập**
//    mà cổng khai xanh 100%.
//
// ⇒ Đây **đúng lớp lỗi mà I-3 được dựng ra để đóng**, chỉ **dời sang một FILE khác**: lưới hỏi
//   *"phần tử này có KHAI `disabled` đúng vị từ không"* và **không bao giờ hỏi** *"thẻ nhận nó có
//   DÙNG nó không"*. Một `disabled` không ai đọc là một `disabled` **TRANG TRÍ** — cùng lớp
//   *"an toàn là HỆ QUẢ của một thứ khác đang hoạt động"* (đã sáu lần).
//
// ⇒ **Luật mới (fail-CLOSED):** với MỌI phần tử JSX ra lệnh `trpc.vram.*` —
//     · thẻ **nguyên thuỷ** (chữ thường: `button`, `input`…) ⇒ đạt, DOM tự cưỡng chế `disabled`;
//     · thẻ **component** ⇒ lưới phải **GIẢI ĐƯỢC** nó về file định nghĩa và **CHỨNG MINH** rằng
//       component ấy chuyển `disabled` xuống (trải `{...props}` của chính tham số, hoặc truyền
//       `disabled=` tường minh);
//     · **không giải được / không chứng minh được ⇒ ĐỎ**, không phải "cho qua". Một lưới im lặng
//       khi không biết là đúng thứ vừa bị đo là hỏng.
//     · `asChild` trên nút lệnh ⇒ **ĐỎ**: nó đổi thẻ đích sang `Slot` và `disabled` được chuyển cho
//       một phần tử con **bất kỳ** — `<a>` nhận `disabled` thì **không có tác dụng gì**.
//
// ⚠⚠ **VÙNG MÙ CÒN LẠI — KHAI RA, ĐỪNG ĐỌC MÀU XANH THÀNH "ĐÃ PHỦ":**
//   1. Luật chứng minh `disabled` **TỚI ĐƯỢC** một vị trí JSX trong component con; nó **KHÔNG**
//      chứng minh rằng đó **cùng một phần tử** mang `onClick`, cũng không rằng component con
//      không có **đường thứ hai** gọi lệnh (ví dụ gọi `onXoa` từ `useEffect`).
//   2. Luật đi **ĐÚNG MỘT chặng**. Một component con **lại** prop-drill xuống cháu thì chỉ chặng
//      đầu được chứng minh. (Hôm nay: **0** ca như vậy — cả ba nút dùng `<Button>` một chặng.)
//   3. Chỉ soi `client/src/**.tsx`. Một nút lệnh dựng trong `.ts` (không JSX) nằm ngoài lượng từ.
//   ⇒ Chi phí đóng nốt ba mục ấy là một bộ phân tích luồng liên module; **chưa làm**, và đây là
//     lời khai để người sau biết mình đang đứng ở đâu.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Đuôi thử khi giải một đường nhập về file thật. Thứ tự = thứ tự ưu tiên của bundler. */
const DUOI_MODULE = [".tsx", ".ts", "/index.tsx", "/index.ts"] as const;

/** MỌI phần tử JSX **ra lệnh** VRAM: tên thẻ · dòng · có `asChild` không. */
function theNutLenh(sf: ts.SourceFile): { ten: string; dong: number; asChild: boolean }[] {
  const datToi = datToiLenh(sf);
  const goc = bienMutationVram(sf);
  const ra: { ten: string; dong: number; asChild: boolean }[] = [];
  for (const n of moiNut(sf)) {
    if (!ts.isJsxOpeningElement(n) && !ts.isJsxSelfClosingElement(n)) continue;
    const el = n as ThePhanTu;
    let cham = false;
    const di = (x: ts.Node) => {
      if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === "mutate") {
        const g = gocCuaChuoi(x.expression.expression);
        if (g !== null && goc.has(g)) cham = true;
      }
      if (ts.isIdentifier(x) && (datToi.get(x.text)?.size ?? 0) > 0) cham = true;
      x.forEachChild(di);
    };
    di(el.attributes);
    if (!cham) continue;
    const { line } = sf.getLineAndCharacterOfPosition(el.getStart(sf));
    ra.push({
      ten: el.tagName.getText(sf),
      dong: line + 1,
      asChild: el.attributes.properties.some((a) => ts.isJsxAttribute(a) && a.name.getText(sf) === "asChild"),
    });
  }
  return ra;
}

/**
 * Giải một tên thẻ về **file định nghĩa** qua câu `import` của chính file gọi.
 * `null` ⇔ **không giải được** — và người gọi phải coi đó là **VI PHẠM**, không phải "bỏ qua".
 */
function giaiThe(sf: ts.SourceFile, ten: string, fileGoc: string): string | null {
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || st.importClause === undefined) continue;
    const c = st.importClause;
    const co =
      c.name?.text === ten ||
      (c.namedBindings !== undefined &&
        ts.isNamedImports(c.namedBindings) &&
        c.namedBindings.elements.some((e) => e.name.text === ten));
    if (!co || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const spec = st.moduleSpecifier.text;
    // ⚠ `@/` là alias của `client/src` (`tsconfig.json` `paths`) — đọc đúng một quy ước, không đoán.
    const nen = spec.startsWith("@/") ? join(CLIENT_SRC, spec.slice(2)) : spec.startsWith(".") ? join(dirname(fileGoc), spec) : null;
    if (nen === null) return null; // gói NGOÀI repo ⇒ không chứng minh được ⇒ fail-closed
    for (const d of DUOI_MODULE) if (existsSync(nen + d)) return nen + d;
    return null;
  }
  return null;
}

/** Gỡ lớp bọc `forwardRef(...)` / `memo(...)` để tới thân component thật. */
function boLopBoc(n: ts.Expression): ts.Expression {
  let cur = n;
  for (let i = 0; i < 4 && ts.isCallExpression(cur) && cur.arguments.length > 0; i++) cur = cur.arguments[0]!;
  return cur;
}

/**
 * Component `ten` trong file `sfCon` có **CHUYỂN `disabled` XUỐNG** không?
 *
 * Bằng chứng chấp nhận được, **đúng hai loại** (cả hai đều đọc trên CÂY):
 *  • một `{...x}` mà `x` là **tham số của chính component** (khuôn `...props` của shadcn/ui);
 *  • một thuộc tính `disabled=` tường minh trên một phần tử JSX bên trong.
 *
 * ⚠ **FAIL-CLOSED**: không tìm thấy khai báo, hoặc không thấy bằng chứng ⇒ `false`.
 */
function chuyenDisabledXuong(sfCon: ts.SourceFile, ten: string): boolean {
  const thamSo = new Set<string>();
  const than: ts.Node[] = [];
  const nhanThamSo = (ps: ts.NodeArray<ts.ParameterDeclaration>): void => {
    for (const p of ps) {
      if (ts.isIdentifier(p.name)) thamSo.add(p.name.text);
      else if (ts.isObjectBindingPattern(p.name)) {
        for (const e of p.name.elements) if (ts.isIdentifier(e.name)) thamSo.add(e.name.text);
      }
    }
  };
  for (const n of moiNut(sfCon)) {
    if (ts.isFunctionDeclaration(n) && n.name?.text === ten && n.body !== undefined) {
      nhanThamSo(n.parameters);
      than.push(n.body);
    } else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === ten && n.initializer !== undefined) {
      const f = boLopBoc(n.initializer);
      if (ts.isArrowFunction(f) || ts.isFunctionExpression(f)) {
        nhanThamSo(f.parameters);
        than.push(f.body);
      }
    }
  }
  if (than.length === 0) return false;
  let ok = false;
  for (const b of than) {
    const di = (x: ts.Node) => {
      if (ts.isJsxOpeningElement(x) || ts.isJsxSelfClosingElement(x)) {
        for (const a of (x as ThePhanTu).attributes.properties) {
          if (ts.isJsxSpreadAttribute(a)) {
            const g = gocCuaChuoi(a.expression);
            if (g !== null && thamSo.has(g)) ok = true;
          } else if (ts.isJsxAttribute(a) && a.name.getText(sfCon) === "disabled") ok = true;
        }
      }
      x.forEachChild(di);
    };
    di(b);
  }
  return ok;
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

/**
 * ★★★ TẦNG 3c (Task 3b · I-2) — **NGƯỜI ĐỌC QUYỀN PHẢI LÀ NGƯỜI ĐỌC THẬT.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ Nối `hasPermission` vào rồi vẫn còn **một cửa**: `vramCommandReach(user?.role, () => true)`
 * biên dịch sạch, TẦNG 3b vẫn XANH (prop **vẫn LÀ** một lời gọi), và nút quay về **chỉ theo vai** —
 * tức I-2 khôi phục nguyên vẹn dưới một hình dạng khác. Đây đúng lớp lỗi *"đồng hồ không kim"*.
 *
 * ⇒ Bất biến, phát biểu theo **cái nó PHẢI LÀ** (không liệt kê hình dạng giả nào):
 *   ***đối số thứ hai của mọi `vramCommandReach(...)` trong mã sản phẩm PHẢI LÀ một ĐỊNH DANH, và
 *   định danh ấy phải được rút ra từ một lời gọi `usePermissions()` trong cùng file.***
 * Một arrow, một `true`, một hằng, một hàm tự chế, một import từ nơi khác — **cả năm** đều thất bại
 * cùng một phép thử, mà lưới không cần biết chúng là gì.
 */
const NGUOI_DOC_QUYEN = "usePermissions";

function soiNguoiDocQuyen(sf: ts.SourceFile): { viPham: ViPham[]; soi: number } {
  const viPham: ViPham[] = [];
  let soi = 0;

  // Định danh nào trong file này được rút ra từ `usePermissions()`? (`const { hasPermission } = …`)
  const tuNguoiDoc = new Set<string>();
  const gom = (n: ts.Node): void => {
    if (
      ts.isVariableDeclaration(n) &&
      n.initializer !== undefined &&
      laLoiGoi(n.initializer, NGUOI_DOC_QUYEN)
    ) {
      if (ts.isObjectBindingPattern(n.name)) {
        for (const el of n.name.elements) if (ts.isIdentifier(el.name)) tuNguoiDoc.add(el.name.text);
      } else if (ts.isIdentifier(n.name)) {
        tuNguoiDoc.add(n.name.text); // `const perms = usePermissions()` ⇒ `perms.hasPermission`
      }
    }
    ts.forEachChild(n, gom);
  };
  gom(sf);

  const di = (n: ts.Node): void => {
    if (laLoiGoi(n, VI_TU_NUOI)) {
      soi++;
      const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
      const arg = (n as ts.CallExpression).arguments[1];
      const goc = arg === undefined ? null : gocCuaChuoi(arg);
      if (arg === undefined) {
        viPham.push({ file: sf.fileName, dong: line + 1, noi: "thiếu người đọc quyền (đối số thứ hai)" });
      } else if (goc === null || !tuNguoiDoc.has(goc)) {
        viPham.push({
          file: sf.fileName,
          dong: line + 1,
          noi: `người đọc quyền KHÔNG đến từ \`${NGUOI_DOC_QUYEN}()\` — thấy: ${arg.getText(sf).slice(0, 70)}`,
        });
      }
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return { viPham, soi };
}

describe("Task 3b (I-2, AST) — người đọc quyền của nút VRAM phải đến từ `usePermissions()`", () => {
  it("★★★ toàn `client/src/**/*.tsx`: 0 vi phạm, và lưới phải THẤY ≥1 lời gọi (cầu chì)", () => {
    const viPham: ViPham[] = [];
    let soi = 0;
    for (const f of moiFileTsx(CLIENT_SRC)) {
      const r = soiNguoiDocQuyen(ast(f));
      viPham.push(...r.viPham);
      soi += r.soi;
    }
    expect(viPham.map((v) => `${v.file}:${v.dong} — ${v.noi}`).join("\n")).toBe("");
    expect(soi, "không thấy lời gọi `vramCommandReach` nào trong mã sản phẩm — lưới mù?").toBeGreaterThanOrEqual(1);
  });

  it("★★★ NĂM hình dạng người-đọc-giả đều ĐỎ (arrow · hằng true · hàm tự chế · import nơi khác · thiếu hẳn)", () => {
    const gia: Record<string, string> = {
      "arrow tại chỗ": `const { hasPermission } = usePermissions(); const r = ${VI_TU_NUOI}(u, () => true);`,
      "hằng `true`": `const { hasPermission } = usePermissions(); const r = ${VI_TU_NUOI}(u, true as never);`,
      "hàm tự chế": `const { hasPermission } = usePermissions(); const cho = () => true; const r = ${VI_TU_NUOI}(u, cho);`,
      "import từ nơi khác": `import { hasPermission } from "./gia"; const r = ${VI_TU_NUOI}(u, hasPermission);`,
      "thiếu hẳn": `const { hasPermission } = usePermissions(); const r = ${VI_TU_NUOI}(u);`,
    };
    for (const [ten, nguon] of Object.entries(gia)) {
      const r = soiNguoiDocQuyen(ast("t.tsx", `function P(){ ${nguon} return null; }`));
      expect(r.viPham.length, `hình dạng "${ten}" phải bị bắt`).toBeGreaterThan(0);
    }
  });

  it("★★ KHÔNG BẮT NHẦM — destructure, hoặc giữ cả object rồi `.hasPermission`", () => {
    const ok = [
      `function P(){ const { hasPermission } = usePermissions(); return ${VI_TU_NUOI}(u?.role, hasPermission); }`,
      `function Q(){ const perms = usePermissions(); return ${VI_TU_NUOI}(u?.role, perms.hasPermission); }`,
    ];
    for (const nguon of ok) {
      const r = soiNguoiDocQuyen(ast("t.tsx", nguon));
      expect(r.viPham.map((v) => v.noi).join(" · ")).toBe("");
      expect(r.soi).toBe(1);
    }
    // File không dính dáng ⇒ 0 soi, 0 vi phạm.
    expect(soiNguoiDocQuyen(ast("t.tsx", "export const a = 1;"))).toEqual({ viPham: [], soi: 0 });
  });
});

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

  it("★★★ Pha 7 Task 4b — I-3 XUYÊN FILE: thẻ nhận lệnh phải CHỨNG MINH ĐƯỢC là nó DÙNG `disabled`", () => {
    /**
     * ⚠⚠⚠ Ca này đóng lỗ **đo được** P1/P2 (xem khối lý lẽ trên `theNutLenh`): nút *"Thu hồi"*
     * THẬT dời sang một component ở file khác **vứt `disabled` đi** ⇒ trước bản này
     * `client/src/lib/` **529/529 XANH**. Lưới cũ hỏi *"có KHAI đúng vị từ không"*; ca này hỏi
     * ***"cái khai ấy có ĐI TỚI ĐÂU không"***.
     */
    const viPham: string[] = [];
    let soi = 0;
    for (const [f, src] of NGUON) {
      if (!src.includes("trpc.vram.")) continue;
      const sf = ast(f, src);
      for (const nut of theNutLenh(sf)) {
        soi++;
        if (nut.asChild) {
          viPham.push(
            `${f}:${nut.dong} <${nut.ten} asChild> — \`asChild\` đổi thẻ đích sang \`Slot\`, ` +
              "`disabled` đi tới một phần tử con BẤT KỲ (một `<a disabled>` không có tác dụng gì)",
          );
          continue;
        }
        // Thẻ NGUYÊN THUỶ (chữ thường) — trình duyệt tự cưỡng chế `disabled`, không cần chứng minh.
        if (/^[a-z]/.test(nut.ten)) continue;
        const duong = giaiThe(sf, nut.ten, f);
        if (duong === null) {
          viPham.push(
            `${f}:${nut.dong} KHÔNG GIẢI ĐƯỢC thẻ <${nut.ten}> về file định nghĩa ⇒ không chứng minh ` +
              "được nó dùng `disabled` (fail-CLOSED: im lặng ở đây đúng là thứ vừa bị đo là hỏng)",
          );
          continue;
        }
        if (!chuyenDisabledXuong(ast(duong), nut.ten)) {
          viPham.push(
            `${f}:${nut.dong} <${nut.ten}> (${duong}) KHÔNG chuyển \`disabled\` xuống bất kỳ phần tử nào ` +
              "⇒ `disabled` của nút lệnh là TRANG TRÍ: nút bấm được với MỌI vai",
          );
        }
      }
    }
    // ⚠ Cầu chì: BA nút lệnh phải đếm được — 0 nút thì khẳng định dưới là chân lý rỗng.
    expect(soi, "KHÔNG thấy nút RA LỆNH VRAM nào trong client/src ⇒ LƯỚI ĐANG MÙ").toBeGreaterThanOrEqual(3);
    expect(viPham).toEqual([]);
  });

  it("★★★★ Pha 7 / I-5 — GHIM số component con phải giải VÀ độ sâu chặng (chặng thứ HAI ⇒ ĐỎ)", () => {
    /**
     * ══════════════════════════════════════════════════════════════════════════════════════════
     * ★★★★ review TOÀN NHÁNH **I-5** — *"hôm nay 0 ca"* KHÔNG PHẢI MỘT BẤT BIẾN.
     * ══════════════════════════════════════════════════════════════════════════════════════════
     * Vùng mù **số 2** khai ở khối "VÙNG MÙ CÒN LẠI" viết: *"Luật đi ĐÚNG MỘT chặng. Một component
     * con **lại** prop-drill xuống cháu thì chỉ chặng đầu được chứng minh. (Hôm nay: **0** ca như
     * vậy — cả ba nút dùng `<Button>` một chặng.)"*
     *
     * ⚠⚠ *"Hôm nay 0"* là một **quan sát theo thời điểm**, và **không con số nào ghim nó** — trong
     * khi CHÍNH NHÁNH NÀY ghim `SO_VUNG_MU_2FA = 1` (`sessionGrantScan`), `SO_MIEN = 0`
     * (`userExposureScan`), `SO_HAM_UY_QUYEN`, `CONG`, `FILE_CANH`. Một kỷ luật **áp không đều** là
     * một kỷ luật **có phần tử thứ N+1**.
     * ⇒ Ngày ai đó bọc nút lệnh VRAM qua **HAI** chặng component, đột biến P2 — *"nút GIẾT tiến
     *   trình mở cho MỌI vai đăng nhập"*, `client/src/lib/` **529/529 XANH** — **ship lại được, im
     *   lặng**. Ô này biến ngày ấy thành một **ca ĐỎ**, buộc người ta **hoặc** mở rộng luật **hoặc**
     *   nói ra vùng mù mới.
     */
    /**
     * ★★★ **THẺ ĐIỀU KIỆN** — `const Comp = asChild ? Slot : "button"` (khuôn shadcn/ui).
     *
     * ⚠⚠⚠ **ĐÂY LÀ CHỖ CÂU "HÔM NAY 0 CA" CỦA BÁO CÁO REVIEW ĐO SAI, VÀ PHÉP ĐO NÀY BÁC BỎ NÓ.**
     * Báo cáo I-5 viết *"cả ba nút dùng `<Button>` **một chặng**"*. Đo lại trên cây: `Button` render
     * `<Comp {...props} />` với `Comp` **viết HOA** ⇒ theo mặt chữ đó **là** một chặng thứ hai, và
     * lượt ghim đầu tiên của ô này **ĐỎ ở cả ba nút**.
     * Nhưng `Comp` **không phải một component**: nó là một **biến cục bộ** trỏ tới `"button"` — một
     * **thẻ NGUYÊN THUỶ**, nơi DOM tự cưỡng chế `disabled`. Nhánh component (`Slot`) **chỉ** với
     * tới được khi `asChild`, và `asChild` trên một nút lệnh VRAM **đã là ĐỎ** ở ca ∀ bên trên.
     * ⇒ Nó là **chặng ĐIỀU KIỆN**, không phải chặng thứ hai. Phân biệt hai thứ ấy là **cả điểm**
     *   của ô này: gộp chúng lại thì lưới **bắt nhầm chính khuôn UI mà cả repo đang dùng**, và một
     *   lưới bắt nhầm là một lưới sẽ bị người sau tắt đi.
     * ⚠ Chúng vẫn được **ĐẾM RIÊNG và GHIM** — không im lặng cho qua.
     */
    const laTheDieuKien = (sfCon: ts.SourceFile, tenThe: string): boolean => {
      for (const n of moiNut(sfCon)) {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === tenThe && n.initializer) {
          let co = false;
          const di = (x: ts.Node): void => {
            if (ts.isStringLiteral(x)) co = true;
            x.forEachChild(di);
          };
          di(n.initializer);
          if (co) return true;
        }
      }
      return false;
    };

    /** Component con này có prop-drill `disabled` xuống một thẻ **COMPONENT** (chữ HOA) nữa không? */
    const changKeTiep = (sfCon: ts.SourceFile, ten: string): { that: string[]; dieuKien: string[] } => {
      const chau = new Set<string>();
      const dieuKien = new Set<string>();
      const thamSo = new Set<string>();
      const than: ts.Node[] = [];
      const nhan = (ps: ts.NodeArray<ts.ParameterDeclaration>): void => {
        for (const p of ps) {
          if (ts.isIdentifier(p.name)) thamSo.add(p.name.text);
          else if (ts.isObjectBindingPattern(p.name)) {
            for (const e of p.name.elements) if (ts.isIdentifier(e.name)) thamSo.add(e.name.text);
          }
        }
      };
      for (const n of moiNut(sfCon)) {
        if (ts.isFunctionDeclaration(n) && n.name?.text === ten && n.body !== undefined) {
          nhan(n.parameters);
          than.push(n.body);
        } else if (
          ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === ten && n.initializer !== undefined
        ) {
          const f = boLopBoc(n.initializer);
          if (ts.isArrowFunction(f) || ts.isFunctionExpression(f)) {
            nhan(f.parameters);
            than.push(f.body);
          }
        }
      }
      for (const b of than) {
        const di = (x: ts.Node): void => {
          if (ts.isJsxOpeningElement(x) || ts.isJsxSelfClosingElement(x)) {
            const el = x as ThePhanTu;
            const tenThe = el.tagName.getText(sfCon);
            // Chỉ thẻ **COMPONENT** mới là một chặng nữa; thẻ nguyên thuỷ là ĐÍCH, DOM tự cưỡng chế.
            if (/^[A-Z]/.test(tenThe)) {
              const dich = laTheDieuKien(sfCon, tenThe) ? dieuKien : chau;
              for (const a of el.attributes.properties) {
                if (ts.isJsxSpreadAttribute(a)) {
                  const g = gocCuaChuoi(a.expression);
                  if (g !== null && thamSo.has(g)) dich.add(`${tenThe} ⇠ {...${g}}`);
                } else if (ts.isJsxAttribute(a) && a.name.getText(sfCon) === "disabled") {
                  dich.add(`${tenThe} ⇠ disabled=`);
                }
              }
            }
          }
          x.forEachChild(di);
        };
        di(b);
      }
      return { that: [...chau].sort(), dieuKien: [...dieuKien].sort() };
    };

    const daGiai = new Set<string>();
    const changHai: string[] = [];
    const theDieuKien = new Set<string>();
    for (const [f, src] of NGUON) {
      if (!src.includes("trpc.vram.")) continue;
      const sf = ast(f, src);
      for (const nut of theNutLenh(sf)) {
        if (nut.asChild || /^[a-z]/.test(nut.ten)) continue;
        const duong = giaiThe(sf, nut.ten, f);
        if (duong === null) continue; // ca ∀ ở trên đã bắt chuyện này rồi
        daGiai.add(`${nut.ten}`);
        const tiep = changKeTiep(ast(duong), nut.ten);
        if (tiep.that.length > 0) changHai.push(`${f}:${nut.dong} <${nut.ten}> → ${tiep.that.join(" · ")}`);
        for (const d of tiep.dieuKien) theDieuKien.add(`${nut.ten} → ${d}`);
      }
    }

    /**
     * ★★★ GHIM. Hôm nay: **1** component con phải giải (`<Button>` của shadcn/ui), **độ sâu 1**.
     * ⚠ Con số này là một **phép đếm**, không phải một hằng số thẩm mỹ: nó đổi ⇔ bề mặt nút lệnh
     *   VRAM đổi, và một lượt đổi bề mặt ra lệnh phải là một **quyết định được nói ra**.
     */
    expect(
      [...daGiai].sort().join(" · "),
      "tập component con mà nút lệnh VRAM phải giải đã ĐỔI.\n" +
        "⚠ Mỗi component con là một chặng mà luật `disabled` phải đi qua; thêm một cái là mở rộng\n" +
        "  đúng bề mặt mà P1/P2 đã đo là hỏng ⇒ phải NÓI RA, không trôi im lặng.",
    ).toBe("Button");

    /**
     * ★★★ GHIM số **thẻ ĐIỀU KIỆN** gặp được. Hôm nay **1**: `Button → Comp ⇠ {...props}`
     * (`const Comp = asChild ? Slot : "button"`). Xem lý lẽ ở `laTheDieuKien` — đây là chỗ câu
     * *"hôm nay 0 ca"* của báo cáo review đo sai, nên nó được **đếm** chứ không bị bỏ qua.
     */
    const SO_THE_DIEU_KIEN = 1;
    expect(
      [...theDieuKien].sort().join("\n"),
      `số THẺ ĐIỀU KIỆN đã đổi (${theDieuKien.size} ≠ ${SO_THE_DIEU_KIEN}).\n` +
        "⚠ Một thẻ điều kiện MỚI là một chỗ `disabled` đi tới một thẻ **có thể là component**;\n" +
        "  hôm nay nhánh component chỉ với tới được qua `asChild`, thứ ĐÃ LÀ ĐỎ ở ca ∀ bên trên.\n" +
        "  Nếu điều kiện ấy đổi, ô này phải được đọc lại — đừng chỉ sửa con số.",
    ).toBe("Button → Comp ⇠ {...props}");
    expect(theDieuKien.size).toBe(SO_THE_DIEU_KIEN);

    /** ★★★★ ĐỘ SÂU CHẶNG TỐI ĐA. Hôm nay **1**. Chặng thứ HAI là vùng mù số 2 **thành sự thật**. */
    expect(
      changHai.join("\n"),
      "MỘT COMPONENT CON LẠI PROP-DRILL `disabled` XUỐNG CHÁU ⇒ luật chỉ chứng minh được CHẶNG ĐẦU.\n" +
        "⚠ Đây là **vùng mù số 2** (khối 'VÙNG MÙ CÒN LẠI') vừa thành sự thật: từ đây, một đột biến\n" +
        "  kiểu P2 — 'nút GIẾT tiến trình mở cho MỌI vai đăng nhập' — ship được với client/src/lib/\n" +
        "  XANH 100%.\n" +
        "⇒ Phải HOẶC mở rộng luật cho nhiều chặng, HOẶC khai vùng mù MỚI kèm một con số ghim nó.",
    ).toBe("");
  });

  it("★★ KHÔNG BẮT NHẦM — `chuyenDisabledXuong` nhận ĐÚNG hai loại bằng chứng, và từ chối phần còn lại", () => {
    /** ⚠ Đối chứng DƯƠNG: khuôn `...props` của shadcn/ui, và khuôn truyền `disabled` tường minh. */
    const dat = [
      'function Nut({ className, ...props }) { return <button className={className} {...props} />; }',
      'function Nut({ disabled, onXoa }) { return <button disabled={disabled} onClick={onXoa} />; }',
      'const Nut = ({ ...p }) => <button {...p} />;',
      'const Nut = forwardRef(({ disabled, ...r }, ref) => <button ref={ref} disabled={disabled} {...r} />);',
    ];
    for (const s of dat) expect(chuyenDisabledXuong(ast("n.tsx", s), "Nut"), s).toBe(true);

    /** ⚠ Đối chứng ÂM: nhận rồi vứt · trải một thứ KHÔNG PHẢI tham số · không có component nào. */
    const khong = [
      'function Nut({ onXoa, disabled }) { void disabled; return <button onClick={onXoa} />; }',
      'const khac = { disabled: true }; function Nut({ onXoa }) { return <button {...khac} onClick={onXoa} />; }',
      'export const a = 1;',
      'function Khac({ ...props }) { return <button {...props} />; }',
    ];
    for (const s of khong) expect(chuyenDisabledXuong(ast("n.tsx", s), "Nut"), s).toBe(false);
  });

  it("★★ KHÔNG BẮT NHẦM — `giaiThe` giải đúng alias `@/` và đường tương đối, và trả `null` cho gói NGOÀI", () => {
    const src = 'import { Button } from "@/components/ui/button";\nimport { X } from "lucide-react";\n';
    const sf = ast(join(CLIENT_SRC, "pages", "T.tsx"), src);
    expect(giaiThe(sf, "Button", join(CLIENT_SRC, "pages", "T.tsx"))).toBe(
      join(CLIENT_SRC, "components", "ui", "button.tsx"),
    );
    // ⚠ Gói ngoài repo ⇒ **null** ⇒ ca chính coi là VI PHẠM (fail-closed), không phải "bỏ qua".
    expect(giaiThe(sf, "X", join(CLIENT_SRC, "pages", "T.tsx"))).toBeNull();
    // ⚠ Tên không được nhập ⇒ null.
    expect(giaiThe(sf, "KhongCo", join(CLIENT_SRC, "pages", "T.tsx"))).toBeNull();
    // ⚠ Đường TƯƠNG ĐỐI cũng phải giải được — đây là hình dạng mà một lượt prop-drilling hay dùng.
    const sf2 = ast(join(CLIENT_SRC, "pages", "T.tsx"), 'import { VramBrokerPanel } from "../components/ai/VramBrokerPanel";\n');
    expect(giaiThe(sf2, "VramBrokerPanel", join(CLIENT_SRC, "pages", "T.tsx"))).toBe(PANEL);
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
