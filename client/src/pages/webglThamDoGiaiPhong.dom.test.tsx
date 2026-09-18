// @vitest-environment jsdom
//
/**
 * `webglThamDoGiaiPhong.dom.test.tsx` — ★★★ BA PHÉP THĂM DÒ WEBGL PHẢI **TRẢ LẠI**
 * NGỮ CẢNH CHÚNG MƯỢN — MÀ **KHÔNG ĐỔI CÂU TRẢ LỜI** CỦA CHÍNH PHÉP THĂM DÒ.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * VIỆC ĐANG ĐO
 * ══════════════════════════════════════════════════════════════════════════════
 * Ba màn hỏi "trình duyệt có WebGL không" bằng cách tạo một canvas RỜI rồi lấy
 * ngữ cảnh **THẬT**:
 *
 *   · `TwinVanHanh.tsx`    ⇒ `webglHong` ⇒ `che2D = epChe2D || webglHong` (§9.9)
 *   · `MachineCockpit.tsx` ⇒ `webglOk`   ⇒ ngăn 3D của `/machine/:id`
 *   · `RobotCockpit.tsx`   ⇒ `webglOk`   ⇒ ngăn 3D của `/robot/:id`
 *
 * Trước bản vá, cả ba **không bao giờ trả lại** ngữ cảnh ấy
 * (`grep -rn "loseContext\|WEBGL_lose_context" client/src` ⇒ **0 kết quả**).
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ MỨC ĐỘ — ĐỪNG ĐỌC TỆP NÀY THÀNH "ĐANG CÓ CANVAS ĐEN"
 * ══════════════════════════════════════════════════════════════════════════════
 * Chủ đợt đã đo trên bản ĐANG CHẠY (điều hướng SPA 5 vòng × 4 màn 3D, kiểm kê
 * bằng `WeakRef`, không gây áp lực cấp phát):
 *
 *   15 ngữ cảnh tạo ra · số SỐNG không bao giờ quá 2 · còn 0 sau GC
 *   ⇒ KHÔNG tích luỹ, KHÔNG thấy canvas đen ở quy mô này.
 *
 * ⇒ Đây là **nợ vệ sinh**, KHÔNG phải lỗi đang chạy. Trình duyệt trục xuất ngữ
 *   cảnh theo thứ tự **cũ nhất trước**, nên dưới tải nặng hơn nạn nhân CÓ THỂ là
 *   ngữ cảnh của cảnh đang vẽ; giải phóng tường minh **loại bỏ khả năng ấy**,
 *   chứ không sửa một lỗi đang xảy ra. (Phần đo trên trình duyệt thật là của
 *   chủ đợt — tệp này KHÔNG đo lại nó và không khai hộ.)
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO CÓ **ORACLE BẢN CŨ** CHỨ KHÔNG CHỈ `expect(true)`
 * ══════════════════════════════════════════════════════════════════════════════
 * Rủi ro lớn nhất của việc này KHÔNG phải "quên gọi `loseContext`" — mà là **bản
 * vá âm thầm đổi kết quả thăm dò** (ví dụ giải phóng TRƯỚC khi đọc, hay để một
 * lỗi ở bước dọn nuốt mất `setState`). Một màn 3D rơi về 2D vĩnh viễn, hoặc một
 * ngăn 3D chết hẳn, là hỏng NẶNG HƠN nhiều so với cái nợ đang trả.
 *
 * Nên `thamDoBanCu()` dưới đây là **bản sao ĐÔNG LẠNH nguyên văn** phép thăm dò
 * TRƯỚC bản vá. Mọi ca đều chạy CẢ HAI trên CÙNG một kịch bản và bắt chúng phải
 * **đồng ý**. Đối chứng này không thể tự thoả: nó là mã cố định trong tệp test,
 * không đọc gì từ bản vá.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO KHÔNG ĐO BẰNG `webglcontextlost` HAY "CẠN SLOT ⇒ `null`"
 * ══════════════════════════════════════════════════════════════════════════════
 * Chủ đợt đo được trên máy này: Chrome **KHÔNG** trả `null` khi cạn slot — nó
 * cấp tiếp và giết cái cũ; và `webglcontextlost` **không bắn** trên canvas rời.
 * Hai thứ ấy vì thế KHÔNG phải thiết bị đo hợp lệ, và tệp này không dùng chúng.
 * Thứ đo được và đúng nghĩa là: **lượt gọi `loseContext()` có xảy ra không, và
 * đúng mấy lần.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * BỐN KỊCH BẢN — BA TRONG SỐ ĐÓ LÀ NHÁNH LỖI
 * ══════════════════════════════════════════════════════════════════════════════
 *   `coExt`      — có WebGL, có extension  ⇒ trả lại ĐÚNG MỘT LẦN, kết quả `true`
 *   `khongExt`   — có WebGL, KHÔNG extension ⇒ KHÔNG ném, kết quả vẫn `true` (bẫy 3)
 *   `khongWebGL` — `getContext` trả `null`  ⇒ KHÔNG có gì để trả lại, `false` (bẫy 2)
 *   `nem`        — `getContext` NÉM         ⇒ nuốt lỗi, `false` (nhánh `catch` bản cũ)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolve } from "node:path";
import type { ReactNode } from "react";

import { docMaNguon } from "@shared/testing/docMaNguon";

/*
 * ⚠ `RobotCockpit`/`MachineCockpit` kéo theo `i18n/index.ts` (gọi
 *   `.use(initReactI18next)` ở tầng module). Mock thiếu ô ấy thì tệp CHẾT LÚC
 *   NẠP và lưới báo "0 test" — xanh-giả kiểu tệ nhất. Cùng khuôn mock với
 *   `robotCockpitAnKhongDisable.dom.test.tsx`.
 */
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_k: string, d?: string) => d ?? _k,
    i18n: { language: "vi", changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
  Trans: ({ children }: { children?: ReactNode }) => children ?? null,
}));

/* ★ G20 — import CHÍNH ba module giao hàng, không phải một bản chép. */
import { thamDoWebGL as thamDoTwin } from "./TwinVanHanh";
import { thamDoWebGL as thamDoMay } from "./MachineCockpit";
import { thamDoWebGL as thamDoRobot } from "./RobotCockpit";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ORACLE — bản sao ĐÔNG LẠNH của phép thăm dò TRƯỚC bản vá                    */
/* ═══════════════════════════════════════════════════════════════════════════ */
/**
 * Nguyên văn `TwinVanHanh.tsx:2689-2697` (và tương đương ở hai cockpit), viết
 * lại thành hàm trả `true` = CÓ WebGL — đúng đại lượng mà `webglOk` mang, và là
 * PHỦ ĐỊNH của `webglHong`.
 *
 * ⚠ KHÔNG được sửa hàm này khi bản vá đổi. Nó là MỐC.
 */
function thamDoBanCu(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
    return !!gl;
  } catch {
    return false;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* THIẾT BỊ ĐO                                                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

type Kich = "coExt" | "khongExt" | "khongWebGL" | "nem";

interface So {
  /** Số lượt `loseContext()` thực sự chạy. */
  lose: number;
  /** Tên extension đã được hỏi, theo thứ tự — chứng minh bản vá có TÌM nó. */
  extDaHoi: string[];
  /** Id ngữ cảnh đã xin, theo thứ tự — canh nhịp `webgl` → `experimental-webgl`. */
  idDaXin: string[];
}

const GET_CONTEXT_GOC = HTMLCanvasElement.prototype.getContext;
let so: So;

/** Cài `getContext` giả theo kịch bản và reset bộ đếm. */
function dungKich(kich: Kich): void {
  so = { lose: 0, extDaHoi: [], idDaXin: [] };
  HTMLCanvasElement.prototype.getContext = function (id: string) {
    so.idDaXin.push(id);
    if (kich === "nem") throw new Error("WebGL bị chặn bởi chính sách trình duyệt");
    if (kich === "khongWebGL") return null;
    return {
      getExtension(ten: string) {
        so.extDaHoi.push(ten);
        if (kich === "khongExt") return null;
        return {
          loseContext: () => {
            so.lose += 1;
          },
        };
      },
    };
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

/** Chạy một phép thăm dò dưới một kịch bản; trả về kết quả + sổ đo RIÊNG của lượt ấy. */
function chay(thamDo: () => boolean, kich: Kich): { ketQua: boolean; so: So } {
  dungKich(kich);
  const ketQua = thamDo();
  return { ketQua, so: { ...so, extDaHoi: [...so.extDaHoi], idDaXin: [...so.idDaXin] } };
}

const BA_CHO: ReadonlyArray<readonly [string, () => boolean, string]> = [
  ["TwinVanHanh (`webglHong` ⇒ `che2D`)", thamDoTwin, "client/src/pages/TwinVanHanh.tsx"],
  ["MachineCockpit (`webglOk` ⇒ ngăn 3D)", thamDoMay, "client/src/pages/MachineCockpit.tsx"],
  ["RobotCockpit (`webglOk` ⇒ ngăn 3D)", thamDoRobot, "client/src/pages/RobotCockpit.tsx"],
];

beforeEach(() => dungKich("coExt"));
afterEach(() => {
  HTMLCanvasElement.prototype.getContext = GET_CONTEXT_GOC;
});

describe.each(BA_CHO)("%s", (_ten, thamDo, tepNguon) => {
  /* ─────────────────────────────────────────────────────────────────────────
   * (1) KẾT CỤC CHÍNH — ngữ cảnh mượn được TRẢ LẠI, đúng một lần.
   * ───────────────────────────────────────────────────────────────────────── */
  it("★★★ có WebGL ⇒ `loseContext()` chạy ĐÚNG MỘT LẦN cho ngữ cảnh vừa thăm dò", () => {
    const r = chay(thamDo, "coExt");
    // "đúng một lần": 0 = nợ cũ (không trả lại); ≥2 = trả lại hai lần — dấu hiệu
    // phép thăm dò chạy hai lượt hoặc bước dọn bị lặp.
    expect(r.so.lose).toBe(1);
    // …và nó phải hỏi ĐÚNG extension ấy, đúng một lượt.
    expect(r.so.extDaHoi).toEqual(["WEBGL_lose_context"]);
  });

  /* ─────────────────────────────────────────────────────────────────────────
   * (2) ĐỐI CHỨNG — KẾT QUẢ THĂM DÒ KHÔNG ĐỔI, CẢ BỐN KỊCH BẢN.
   *     Vế này quan trọng hơn vế (1): nó canh bẫy 1.
   * ───────────────────────────────────────────────────────────────────────── */
  it.each(["coExt", "khongExt", "khongWebGL", "nem"] as const)(
    "★★★ ĐỐI CHỨNG [%s] — kết quả thăm dò Y HỆT bản TRƯỚC vá (oracle đông lạnh)",
    (kich) => {
      const sauVa = chay(thamDo, kich);
      const truocVa = chay(thamDoBanCu, kich);
      expect(sauVa.ketQua).toBe(truocVa.ketQua);
      // Ghim luôn giá trị TUYỆT ĐỐI, để một oracle bị sửa hỏng cũng không kéo cả
      // hai vế cùng trôi về một câu trả lời sai.
      expect(sauVa.ketQua).toBe(kich === "coExt" || kich === "khongExt");
    },
  );

  /* ─────────────────────────────────────────────────────────────────────────
   * (3) BẪY 2 — `getContext` trả `null`: KHÔNG có gì để giải phóng.
   * ───────────────────────────────────────────────────────────────────────── */
  it("★★ `getContext` trả `null` ⇒ KHÔNG ném, KHÔNG gọi `loseContext`, và ĐÓ là nhánh 'WebGL hỏng'", () => {
    dungKich("khongWebGL");
    expect(() => thamDo()).not.toThrow();
    const r = chay(thamDo, "khongWebGL");
    expect(r.ketQua).toBe(false);
    expect(r.so.lose).toBe(0);
    expect(r.so.extDaHoi).toEqual([]);
    // Bản cũ hỏi cả hai id khi id đầu trả `null`; bản vá phải giữ nguyên nhịp ấy.
    expect(r.so.idDaXin).toEqual(["webgl", "experimental-webgl"]);
  });

  /* ─────────────────────────────────────────────────────────────────────────
   * (4) BẪY 3 — `getExtension` trả `null`: KHÔNG được làm hỏng phép thăm dò.
   * ───────────────────────────────────────────────────────────────────────── */
  it("★★ `getExtension` trả `null` ⇒ KHÔNG ném, kết quả VẪN đúng, và bản vá có THỬ tìm", () => {
    dungKich("khongExt");
    expect(() => thamDo()).not.toThrow();
    const r = chay(thamDo, "khongExt");
    expect(r.ketQua).toBe(true);
    expect(r.so.lose).toBe(0);
    // Khẳng định DƯƠNG: "không ném" KHÔNG được đến từ việc bỏ hẳn bước dọn.
    expect(r.so.extDaHoi).toEqual(["WEBGL_lose_context"]);
  });

  /* ─────────────────────────────────────────────────────────────────────────
   * (5) NHÁNH `catch` CỦA BẢN CŨ — `getContext` NÉM ⇒ nuốt lỗi, "WebGL hỏng".
   * ───────────────────────────────────────────────────────────────────────── */
  it("★★ `getContext` NÉM ⇒ lỗi KHÔNG lọt ra ngoài, kết quả 'WebGL hỏng'", () => {
    dungKich("nem");
    expect(() => thamDo()).not.toThrow();
    expect(chay(thamDo, "nem").ketQua).toBe(false);
  });

  /* ─────────────────────────────────────────────────────────────────────────
   * (6) CENSUS — hàm đo được ở trên phải LÀ phép thăm dò DUY NHẤT của màn, và
   *     không có phép thăm dò thứ hai nào mọc lại bên cạnh nó mà không trả lại.
   *     (Phụ trợ cho các ca hành vi ở trên — không thay chúng.)
   * ───────────────────────────────────────────────────────────────────────── */
  it("★ census — mỗi màn CHỈ CÒN MỘT phép thăm dò, và nó trả lại ngữ cảnh", () => {
    const nguon = docMaNguon(resolve(__dirname, "..", "..", "..", tepNguon));
    const dem = (mau: string) => nguon.split(mau).length - 1;
    // Đúng MỘT chỗ xin ngữ cảnh WebGL trong cả tệp…
    expect(dem('getContext("webgl")')).toBe(1);
    // …và đúng MỘT lượt trả lại tương ứng.
    expect(dem("?.loseContext();")).toBe(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* CHỖ NỐI — ĐÚNG CỰC (`webglHong` là PHỦ ĐỊNH, `webglOk` thì KHÔNG)           */
/* ═══════════════════════════════════════════════════════════════════════════ */
/**
 * Các ca trên đo `thamDoWebGL()` trực tiếp. Còn lại đúng một khe hở: nối SAI CỰC
 * ở `useEffect` (`setWebglHong(thamDoWebGL())` quên dấu `!`) sẽ lật ngược màn mà
 * mọi ca hành vi vẫn xanh. Ba khẳng định DƯƠNG, hẹp, đóng đúng khe ấy.
 */
describe("chỗ nối `useEffect` — đúng cực", () => {
  const doc = (p: string) => docMaNguon(resolve(__dirname, "..", "..", "..", p));

  it("★★ `TwinVanHanh` — `webglHong` là PHỦ ĐỊNH của phép thăm dò", () => {
    expect(doc("client/src/pages/TwinVanHanh.tsx")).toContain("setWebglHong(!thamDoWebGL());");
  });

  it.each([
    ["client/src/pages/MachineCockpit.tsx"],
    ["client/src/pages/RobotCockpit.tsx"],
  ])("★★ `%s` — `webglOk` dùng THẲNG kết quả thăm dò", (p) => {
    expect(doc(p)).toContain("setWebglOk(thamDoWebGL());");
  });
});
