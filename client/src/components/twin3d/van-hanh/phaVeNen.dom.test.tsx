// @vitest-environment jsdom
//
/**
 * phaVeNen.dom.test.tsx — ★★★ "MỜ 12 % CHO LINE NGOÀI PHẠM VI" (§10C) BẮT ĐẦU
 * CÓ HIỆU LỰC — và bằng chứng là một PHÉP TRỪ, không phải một dòng log.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G5 Ở DẠNG ĐỘC NHẤT: KHÔNG PHẢI TẬP RỖNG, MÀ LÀ **PHÉP BIẾN ĐỔI ĐỒNG NHẤT**
 * ════════════════════════════════════════════════════════════════════════════
 * `phaVeNen(mau, nen, tiLe)` gọi `tachRgb`, và `tachRgb` CŨ chỉ đọc `rgb()` và
 * `#hex`. Token của repo khai bằng `oklch()`. Gặp `oklch` ⇒ `tachRgb` trả `null`
 * ⇒ `phaVeNen` `return mau` — **trả lại đúng đầu vào**.
 *
 * Nghĩa là: hàm được gọi với dữ liệu KHÁC RỖNG, chạy hết thân, không lỗi, không
 * cảnh báo, và **không làm gì**. Cổng nào cũng xanh. Cách duy nhất bắt được nó
 * là **so hai đầu ra** (trong phạm vi vs ngoài phạm vi) và đòi chúng KHÁC nhau —
 * đúng như D2 yêu cầu: "không đo được chênh thì mục này CHƯA XONG".
 *
 * ★ G20 — mọi `import` ở đây trỏ vào **chính module giao hàng**
 *   (`phamViCanh.ts`, `mauThree.ts`), không vào bản sao trong test.
 *
 * ★ jsdom KHÔNG có canvas 2D thật ⇒ `getContext("2d")` trả `null`. Ta tiêm một
 *   canvas giả có ĐÚNG hai hành vi mà bản vá dựa vào (bỏ qua giá trị rác, giữ
 *   `fillStyle` cũ). Cùng khuôn với `mauThree.dom.test.tsx` của lô A.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

import { phaVeNen, TI_LE_PHA_NGOAI_PHAM_VI } from "./phamViCanh";
import { byteMau, laCuPhapLa, mauCss } from "./mauThree";

/** Quy oklch → rgb ĐO ĐƯỢC trên Chrome tại trang thật (không suy ra). */
const DO_TREN_TRINH_DUYET: Record<string, [number, number, number]> = {
  "oklch(78% .15 75)": [239, 168, 49], // --warning, hổ phách
  "oklch(70% .13 250)": [90, 163, 236], // --info, xanh dương
  "oklch(14.5% .015 260)": [7, 10, 16], // --background theme tối
  "oklch(97% .01 260)": [246, 247, 250], // --background theme sáng
  "oklch(55% .02 260)": [124, 130, 143], // --muted-foreground
};

/** Canvas 2D giả — mô phỏng ĐÚNG hai hành vi mà bản vá dựa vào. */
function gaCanvas(bang: Record<string, [number, number, number]>) {
  const ctx = {
    _fill: "#000000",
    get fillStyle() {
      return this._fill;
    },
    set fillStyle(v: string) {
      // Hành vi THẬT: giá trị không hợp lệ bị BỎ QUA, `fillStyle` giữ nguyên.
      if (v in bang || /^#[0-9a-f]{6}$/i.test(v) || /^rgb\(/i.test(v)) this._fill = v;
    },
    fillRect() {},
    getImageData() {
      const f = this._fill;
      const r = /^rgb\(\s*(\d+)\D+(\d+)\D+(\d+)/i.exec(f);
      const rgb =
        bang[f] ??
        (r ? ([Number(r[1]), Number(r[2]), Number(r[3])] as [number, number, number]) : undefined) ??
        (/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i
          .exec(f)
          ?.slice(1)
          .map((h) => parseInt(h, 16)) as [number, number, number] | undefined) ?? [0, 0, 0];
      return { data: Uint8ClampedArray.from([...rgb, 255]) };
    },
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    ctx as unknown as ReturnType<HTMLCanvasElement["getContext"]>,
  );
  return ctx;
}

function datToken(ten: string, gt: string) {
  document.documentElement.style.setProperty(ten, gt);
}

/** `rgb(r, g, b)` → ba số. Dùng để ĐO CHÊNH LỆCH, không để so chuỗi. */
function tachSo(s: string): [number, number, number] {
  const m = /^rgb\(\s*(\d+)\D+(\d+)\D+(\d+)/i.exec(s.trim());
  if (!m) throw new Error(`không phải rgb(): ${s}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Khoảng cách Manhattan giữa hai màu — "chênh lệch thật" đo bằng SỐ. */
function chenh(a: string, b: string): number {
  const x = tachSo(a);
  const y = tachSo(b);
  return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]);
}

beforeEach(() => {
  document.documentElement.style.cssText = "";
});
afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.style.cssText = "";
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* 1. TÁI HIỆN LỖI GỐC — hàm chạy đủ mà không làm gì                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ D2 — tái hiện: `phaVeNen` với oklch THÔ trả NGUYÊN màu gốc", () => {
  it("★★★ đầu vào oklch ⇒ đầu ra === đầu vào (chênh = 0 bit thông tin)", () => {
    // Đây là hành vi TRƯỚC bản vá, và nó vẫn đúng khi ai đó bỏ qua `mauCss`:
    // truyền chuỗi oklch THÔ vào `phaVeNen` thì `tachRgb` không quy được ở node
    // (không canvas) ⇒ trả nguyên. Ghim lại để không ai tưởng oklch thô cũng ổn.
    const raw = "oklch(78% .15 75)";
    const ra = phaVeNen(raw, "oklch(14.5% .015 260)", TI_LE_PHA_NGOAI_PHAM_VI);
    expect(ra).toBe(raw);
  });

  it("★ ĐỐI CHỨNG — cùng tỉ lệ, đầu vào `rgb()` thì CÓ pha (nên lỗi ở CÚ PHÁP)", () => {
    const ra = phaVeNen("rgb(239, 168, 49)", "rgb(7, 10, 16)", TI_LE_PHA_NGOAI_PHAM_VI);
    expect(ra).not.toBe("rgb(239, 168, 49)");
    expect(chenh(ra, "rgb(239, 168, 49)")).toBeGreaterThan(100);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* 2. BẢN VÁ — `tachRgb` biết đọc oklch qua canvas                              */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ D2 — bản vá: `tachRgb` quy oklch qua canvas ⇒ `phaVeNen` CÓ pha", () => {
  it("★★★ oklch trực tiếp vào `phaVeNen` ⇒ ra `rgb()` KHÁC màu gốc", () => {
    gaCanvas(DO_TREN_TRINH_DUYET);
    const ra = phaVeNen("oklch(78% .15 75)", "oklch(14.5% .015 260)", TI_LE_PHA_NGOAI_PHAM_VI);
    // Gốc (239,168,49) pha 72 % về nền (7,10,16):
    //   r = 239 + (7-239)*0.72   = 71.96  → 72
    //   g = 168 + (10-168)*0.72  = 54.24  → 54
    //   b = 49  + (16-49)*0.72   = 25.24  → 25
    expect(ra).toBe("rgb(72, 54, 25)");
  });

  it("★★★ CHÊNH LỆCH THẬT — trong phạm vi vs ngoài phạm vi, đo bằng SỐ", () => {
    gaCanvas(DO_TREN_TRINH_DUYET);
    datToken("--warning", "oklch(78% .15 75)");
    datToken("--background", "oklch(14.5% .015 260)");

    // Đường ĐÚNG mà `TwinVanHanh.tsx:702-703` đi.
    const nen = mauCss("--background", "#0f172a");
    const trong = mauCss("--warning", "#f59e0b");
    const ngoai = phaVeNen(trong, nen, TI_LE_PHA_NGOAI_PHAM_VI);

    expect(trong).toBe("rgb(239, 168, 49)");
    expect(ngoai).toBe("rgb(72, 54, 25)");
    // 167 + 114 + 24 = 305 — "mờ 12 %" của §10C chở 305 đơn vị màu, không phải 0.
    expect(chenh(trong, ngoai)).toBe(305);
  });

  it("★★★ CẢ HAI THEME — theme SÁNG pha về phía SÁNG, không về phía tối", () => {
    // §10.4: 3D phải đúng ở CẢ HAI theme. Nếu ai đó hardcode một nền tối, ca này ĐỎ.
    gaCanvas(DO_TREN_TRINH_DUYET);
    const sang = phaVeNen("oklch(78% .15 75)", "oklch(97% .01 260)", TI_LE_PHA_NGOAI_PHAM_VI);
    const toi = phaVeNen("oklch(78% .15 75)", "oklch(14.5% .015 260)", TI_LE_PHA_NGOAI_PHAM_VI);
    const [rS] = tachSo(sang);
    const [rT] = tachSo(toi);
    // Nền sáng (246) kéo LÊN, nền tối (7) kéo XUỐNG. Hai chiều ngược nhau.
    expect(rS).toBeGreaterThan(239);
    expect(rT).toBeLessThan(239);
  });

  it("★ tỉ lệ 0 ⇒ giữ nguyên; tỉ lệ 1 ⇒ đúng bằng nền (hai đầu mút)", () => {
    gaCanvas(DO_TREN_TRINH_DUYET);
    expect(phaVeNen("oklch(78% .15 75)", "oklch(14.5% .015 260)", 0)).toBe("rgb(239, 168, 49)");
    expect(phaVeNen("oklch(78% .15 75)", "oklch(14.5% .015 260)", 1)).toBe("rgb(7, 10, 16)");
  });

  it("★ KHÔNG DOM (node) ⇒ vẫn trả nguyên màu, KHÔNG ném — module giữ tính thuần", () => {
    // `byteMau` trả `null` khi không có canvas ⇒ `tachRgb` trả `null` ⇒ `return mau`.
    // Đây là lý do `phamViCanh.ts` vẫn test được ở `environment: "node"`.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(phaVeNen("oklch(78% .15 75)", "oklch(14.5% .015 260)", 0.72)).toBe("oklch(78% .15 75)");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* 3. `mauCss` — cửa duy nhất vào `LoBatchMay` (nguồn 84 warning)               */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ D1 — `mauCss`: chuỗi màu AN TOÀN CHO THREE", () => {
  it("★★★ token oklch ⇒ `rgb()`, KHÔNG còn `oklch` trong đầu ra", () => {
    gaCanvas(DO_TREN_TRINH_DUYET);
    datToken("--warning", "oklch(78% .15 75)");
    const ra = mauCss("--warning", "#f59e0b");
    expect(ra).toBe("rgb(239, 168, 49)");
    expect(ra).not.toContain("oklch");
  });

  it("★★★ HAI TRẠNG THÁI KHÁC NHAU ⇒ HAI MÀU KHÁC NHAU (kênh màu chở >0 bit)", () => {
    // Chính là phép đo mà cả đợt thiếu: trước bản vá cả hai đều thành `#ffffff`.
    gaCanvas(DO_TREN_TRINH_DUYET);
    datToken("--warning", "oklch(78% .15 75)");
    datToken("--info", "oklch(70% .13 250)");
    const a = mauCss("--warning", "#000000");
    const b = mauCss("--info", "#000000");
    expect(a).not.toBe(b);
    expect(chenh(a, b)).toBe(149 + 5 + 187); // |239-90|+|168-163|+|49-236| = 341
  });

  it("★ token là `rgb()`/hex sẵn ⇒ ĐI THẲNG, không vòng canvas", () => {
    // Không tiêm canvas: nếu bản vá vòng qua canvas cho mọi đầu vào thì ca này ĐỎ.
    datToken("--info", "#3b82f6");
    expect(mauCss("--info", "#000000")).toBe("#3b82f6");
    datToken("--info", "rgb(1, 2, 3)");
    expect(mauCss("--info", "#000000")).toBe("rgb(1, 2, 3)");
  });

  it("★ token không tồn tại ⇒ DỰ PHÒNG, không phải trắng câm", () => {
    expect(mauCss("--khong-ton-tai", "#f59e0b")).toBe("#f59e0b");
  });

  it("★ canvas bị chặn ⇒ DỰ PHÒNG ĐÚNG SẮC, không để three trả trắng", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
      throw new Error("fingerprinting guard");
    });
    datToken("--warning", "oklch(78% .15 75)");
    expect(mauCss("--warning", "#f59e0b")).toBe("#f59e0b");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* 4. `laCuPhapLa` — danh sách cú pháp, ghim đích danh (G9)                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★ `laCuPhapLa` — đúng tập cú pháp three KHÔNG đọc được", () => {
  it("★ bắt đủ 6 cú pháp lạ", () => {
    const la = [
      "oklch(78% .15 75)",
      "oklab(0.5 0.1 0.1)",
      "lch(50% 40 30)",
      "lab(50% 40 30)",
      "color(display-p3 1 0 0)",
      "hwb(120 10% 20%)",
    ];
    expect(la.filter(laCuPhapLa)).toHaveLength(6);
  });

  it("★ KHÔNG bắt nhầm cú pháp three đọc được (nếu bắt nhầm ⇒ thêm một vòng canvas thừa)", () => {
    const quen = ["#f59e0b", "#fa0", "rgb(1,2,3)", "rgba(1,2,3,.5)", "hsl(10 20% 30%)", "red"];
    expect(quen.filter(laCuPhapLa)).toHaveLength(0);
  });
});

describe("★ `byteMau` — canh gác `#010203` phân biệt 'đen hợp lệ' với 'chuỗi rác'", () => {
  it("★★★ chuỗi RÁC ⇒ `null`, KHÔNG phải (0,0,0)", () => {
    gaCanvas(DO_TREN_TRINH_DUYET);
    expect(byteMau("hoàn toàn không phải màu")).toBeNull();
  });

  it("★ đen HỢP LỆ ⇒ (0,0,0), không bị canh gác nuốt", () => {
    gaCanvas(DO_TREN_TRINH_DUYET);
    expect(byteMau("#000000")).toEqual([0, 0, 0]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* 5. D5 — CỘT HỔ PHÁCH: ĐO Ở TẦNG MÀU, VÌ TẦNG PIXEL KHÔNG CHỨNG MINH ĐƯỢC    */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ★★★ KHAI THẲNG GIỚI HẠN: nghiệm thu THỊ GIÁC của cột hổ phách **THẤT BẠI**.
 *
 * Lô A tự khai cột hổ phách "chưa ai nhìn tận mắt, nằm sát mép trái khung hình".
 * Lô D thử lại trên build thật (`/twin?pv=line:1`, 1000×715 px) và **cũng
 * không chụp được nó**: đo 715.000 pixel × 4 tư thế camera ⇒ **0 pixel hổ
 * phách**. Nguyên nhân đo được, KHÔNG phải suy đoán:
 *   · trạm nghẽn là **trạm #1** (3.152 WIP, `data-nghen="1"` trên `o-tram-wip-1`),
 *     tức ĐẦU chuyền — nhãn 3D của nhóm máy đó chiếu ra **x âm** (`SIM-L1-AOI`
 *     x=-14, `SN-SIM-0001` x=-61), nghĩa là NGOÀI khung về phía trái;
 *   · mọi cách dời camera đều bị `ghiCamera` ghi `?cam=` đè lại sau ~1 s, nên
 *     không giữ được tư thế đủ lâu để chụp.
 *
 * ⇒ Theo đúng yêu cầu "hoặc báo rõ là không chứng minh được": **KHÔNG chứng
 *   minh được bằng pixel**. Cái đo được là tầng ngay dưới nó — màu mà
 *   `OngWip` nạp vào `setColorAt`. Ca này ghim tầng đó, và nói rõ nó KHÔNG
 *   thay thế nghiệm thu thị giác.
 */
describe("★★ D5 — cột nghẽn nạp màu `--warning`, KHÁC hẳn cột thường", () => {
  it("★★★ CA DƯƠNG: hai màu cột (nghẽn vs thường) khác nhau ĐO ĐƯỢC", () => {
    gaCanvas(DO_TREN_TRINH_DUYET);
    datToken("--warning", "oklch(78% .15 75)");
    datToken("--info", "oklch(70% .13 250)");
    // Đúng hai dòng `CanhVanHanh.tsx:240-241`.
    const nghen = mauCss("--warning", "#f59e0b");
    const thuong = mauCss("--info", "#3b82f6");
    expect(nghen).toBe("rgb(239, 168, 49)");
    expect(thuong).toBe("rgb(90, 163, 236)");
    expect(chenh(nghen, thuong)).toBe(341);
  });

  it("★★★ TRƯỚC BẢN VÁ CẢ HAI LÀ TRẮNG — chênh 0, lớp phủ chở 0 bit (G29)", () => {
    // Ghim lại chế độ hỏng để nó không quay lại lặng lẽ: `THREE.Color` gặp
    // oklch thì warn rồi trả `#ffffff` cho CẢ HAI, nên cột nghẽn và cột thường
    // không phân biệt nổi — đúng cái mắt người thấy ở nghiệm thu Đợt 8.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = new THREE.Color("oklch(78% .15 75)").getHexString();
    const b = new THREE.Color("oklch(70% .13 250)").getHexString();
    expect(a).toBe("ffffff");
    expect(b).toBe("ffffff");
    expect(a).toBe(b); // ← chênh = 0
    warn.mockRestore();
  });
});
