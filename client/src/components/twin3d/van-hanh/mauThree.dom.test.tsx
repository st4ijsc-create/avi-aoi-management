// @vitest-environment jsdom
//
/**
 * mauThree.dom.test.tsx — ★★★ TOKEN `oklch()` → `THREE.Color` CÓ SẮC THẬT.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ LỖI ĐƯỢC BẮT BẰNG MẮT, KHÔNG BẰNG CỔNG — VÀ ĐÓ LÀ ĐIỂM CHÍNH
 * ════════════════════════════════════════════════════════════════════════════
 * Sau khi nối xong `wip` (#61), nghiệm thu thị giác Đợt 8 trên `/twin?pv=line:1`
 * cho thấy các cột WIP đã MỌC LÊN — nhưng **trắng như nhau cả 12 cột**. Cột
 * nghẽn (3.152 WIP) và cột thường (118 WIP) không phân biệt được bằng màu.
 *
 * Gốc rễ, đo bằng ba mẫu RỜI NHAU (G9):
 *   1. trang thật  — `getPropertyValue("--warning")` = `"oklch(78% .15 75)"`;
 *   2. node+three  — `new THREE.Color("oklch(...)")` → `#ffffff` kèm một
 *                    **console.warn**, không throw;
 *   3. đối chứng   — `new THREE.Color("#f59e0b")` → `f59e0b`, đúng.
 *
 * ⇒ Lớp phủ vẽ đủ hình mà chở **0 bit** thông tin. Mọi cổng vẫn xanh: `check` 0,
 *   `build` 0, test đơn vị xanh — vì không cổng nào nhìn vào pixel.
 *
 * Tệp này ghim bản vá bằng SỐ. Nó `import { mauThree }` từ CHÍNH module giao
 * hàng (`CanhVanHanh.tsx`, G20) — gỡ bản vá đi thì nó ĐỎ.
 *
 * ★ jsdom KHÔNG cài canvas 2D thật, nên `getContext("2d")` trả `null`. Đó lại là
 *   điều tốt cho một phép đo: nó buộc test phải TIÊM một canvas giả có hành vi
 *   ĐÚNG NHƯ trình duyệt thật (bỏ qua giá trị không hợp lệ, giữ `fillStyle` cũ)
 *   — và hành vi đó chính là thứ bản vá dựa vào.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

import { mauHex, mauThree } from "./CanhVanHanh";

/**
 * ★★★ `THREE.Color` LƯU MÀU Ở KHÔNG GIAN TUYẾN TÍNH, KHÔNG PHẢI sRGB.
 *
 * Bẫy này bắt được ngay ở lượt chạy đầu: đặt `rgb(90,163,236)` rồi kỳ vọng
 * `Math.round(c.b * 255) === 236` thì ĐỎ với giá trị **214** — vì three đã quy
 * sRGB → linear-sRGB khi nhận một CHUỖI màu. Đọc `.r/.g/.b` thô rồi nhân 255 là
 * đang so hai không gian màu khác nhau (đúng họ G7 — đo nhầm đại lượng, chỉ
 * khác là đại lượng ở đây là "không gian màu").
 *
 * `getHexString()` mặc định quy NGƯỢC về sRGB, nên nó là cửa so sánh đúng.
 * `mauThree` nạp màu bằng ba số 0..1 (`new THREE.Color(r,g,b)`) — three coi đó
 * là ĐÃ tuyến tính và KHÔNG quy đổi, nên đường oklch giữ nguyên byte gốc; còn
 * đường chuỗi (hex/rgb) thì có quy đổi. Hai đường khác nhau ở điểm này, và test
 * phải biết điều đó thay vì giả vờ chúng giống nhau.
 */
function byteSrgb(c: THREE.Color): [number, number, number] {
  const h = c.getHexString(); // getHexString() quy về sRGB
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** Bảng quy oklch→rgb ĐO ĐƯỢC trên Chrome tại trang thật (không phải suy ra). */
const DO_TREN_TRINH_DUYET: Record<string, [number, number, number]> = {
  "oklch(78% .15 75)": [239, 168, 49], // --warning, hổ phách
  "oklch(70% .13 250)": [90, 163, 236], // --info, xanh dương
};

/** Canvas 2D giả — mô phỏng ĐÚNG hai hành vi mà bản vá dựa vào. */
function gaCanvas(bang: Record<string, [number, number, number]>) {
  const ctx = {
    _fill: "#000000",
    get fillStyle() {
      return this._fill;
    },
    set fillStyle(v: string) {
      // ★ Hành vi THẬT của canvas 2D: giá trị không hợp lệ bị BỎ QUA, `fillStyle`
      //   giữ nguyên giá trị cũ. Bản vá dùng đúng tính chất này làm canh gác.
      if (v in bang || /^#[0-9a-f]{6}$/i.test(v)) this._fill = v;
    },
    fillRect() {},
    getImageData() {
      const f = this._fill;
      const rgb =
        bang[f] ??
        (/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(f)?.slice(1).map((h) => parseInt(h, 16)) as
          | [number, number, number]
          | undefined) ??
        [0, 0, 0];
      return { data: Uint8ClampedArray.from([...rgb, 255]) };
    },
  };
  // ★ `getContext` là hàm NẠP CHỒNG; `mockReturnValue` bám vào overload cuối
  //   (WebGPU) nên phải ép qua `unknown` ở chính chỗ spy, không ở giá trị.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    ctx as unknown as ReturnType<HTMLCanvasElement["getContext"]>,
  );
  return ctx;
}

/** Đặt token trên `:root` đúng cách `giaiMauCanh` đọc. */
function datToken(ten: string, gt: string) {
  document.documentElement.style.setProperty(ten, gt);
}

beforeEach(() => {
  document.documentElement.style.cssText = "";
});
afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.style.cssText = "";
});

describe("★★★ TÁI HIỆN LỖI GỐC — three KHÔNG đọc được oklch", () => {
  it("★★★ `new THREE.Color('oklch(...)')` trả TRẮNG, và chỉ WARN chứ không throw", () => {
    // Nếu ngày nào đó three biết đọc oklch, ca này ĐỎ — và đó là tin tốt: bản vá
    // có thể gỡ bớt. Ghim lại để sự thay đổi đó không trôi qua không ai thấy.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const c = new THREE.Color("oklch(0.78 0.15 75)");
    expect(c.getHexString()).toBe("ffffff");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("★ ĐỐI CHỨNG — hex thì three đọc đúng, nên lỗi nằm ở CÚ PHÁP không ở three", () => {
    expect(new THREE.Color("#f59e0b").getHexString()).toBe("f59e0b");
  });
});

describe("★★★ mauThree — bản vá quy oklch → RGB thật", () => {
  it("★★★ `--warning` oklch ⇒ HỔ PHÁCH, KHÔNG phải trắng", () => {
    gaCanvas(DO_TREN_TRINH_DUYET);
    datToken("--warning", "oklch(78% .15 75)");
    const c = mauThree("--warning", "#f59e0b");
    expect(c.getHexString()).not.toBe("ffffff"); // ← lỗi gốc
    // ★ So ở sRGB (xem `byteSrgb`), KHÔNG đọc `.r/.g/.b` thô: three lưu tuyến
    //   tính, nên `c.r * 255` là một con số ở không gian màu KHÁC.
    expect(byteSrgb(c)).toEqual([239, 168, 49]);
  });

  it("★★★ `--info` oklch ⇒ XANH DƯƠNG", () => {
    gaCanvas(DO_TREN_TRINH_DUYET);
    datToken("--info", "oklch(70% .13 250)");
    const c = mauThree("--info", "#3b82f6");
    expect(byteSrgb(c)).toEqual([90, 163, 236]);
    expect(c.b).toBeGreaterThan(c.r); // xanh dương: B trội hơn R (đúng ở cả hai không gian)
  });

  it("★★★ HAI màu PHẢI PHÂN BIỆT ĐƯỢC — đây mới là thứ lớp phủ cần", () => {
    // Trước bản vá cả hai đều `ffffff`, nên `nghen ? mauNghen : mauThuong` chở
    // đúng 0 bit. Ca này đo chính khoảng cách đó.
    gaCanvas(DO_TREN_TRINH_DUYET);
    datToken("--warning", "oklch(78% .15 75)");
    datToken("--info", "oklch(70% .13 250)");
    const nghen = mauThree("--warning", "#f59e0b");
    const thuong = mauThree("--info", "#3b82f6");
    expect(nghen.getHexString()).not.toBe(thuong.getHexString());
    // và cách nhau đủ xa để MẮT phân biệt, không chỉ khác vài đơn vị
    const d = Math.hypot(nghen.r - thuong.r, nghen.g - thuong.g, nghen.b - thuong.b);
    expect(d).toBeGreaterThan(0.4);
  });
});

describe("★★★ mauThree — đường không-oklch và các lối hỏng", () => {
  it("★ hex đi THẲNG, không vòng qua canvas", () => {
    const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    datToken("--warning", "#f59e0b");
    expect(mauThree("--warning", "#000000").getHexString()).toBe("f59e0b");
    expect(spy).not.toHaveBeenCalled();
  });

  it("★ `rgb()` cũng đi thẳng — three vốn đọc được", () => {
    const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    datToken("--info", "rgb(90, 163, 236)");
    const c = mauThree("--info", "#000000");
    // ★ So ở sRGB (xem `byteSrgb`): `c.b * 255` là số TUYẾN TÍNH (214), không
    //   phải byte sRGB (236) — hai không gian màu khác nhau.
    expect(byteSrgb(c)).toEqual([90, 163, 236]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("★★★ token VẮNG ⇒ dùng màu dự phòng, KHÔNG trả trắng", () => {
    // Trắng là màu của sự im lặng ở lỗi gốc; dự phòng phải đúng SẮC.
    expect(mauThree("--khong-ton-tai", "#f59e0b").getHexString()).toBe("f59e0b");
  });

  it("★★★ CANH GÁC — chuỗi oklch RÁC không được thành ĐEN (0,0,0)", () => {
    // Đọc pixel thôi thì rác cho (0,0,0), không phân biệt được với đen hợp lệ.
    // Canh gác `#010203` phát hiện `fillStyle` KHÔNG đổi ⇒ rơi về dự phòng.
    gaCanvas(DO_TREN_TRINH_DUYET); // bảng KHÔNG chứa chuỗi rác dưới đây
    datToken("--warning", "oklch(khong-phai-so)");
    const c = mauThree("--warning", "#f59e0b");
    expect(c.getHexString()).toBe("f59e0b");
    expect(c.getHexString()).not.toBe("000000");
  });

  it("★★★ canvas bị CHẶN (getContext ném) ⇒ dự phòng, không nổ trang", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
      throw new Error("canvas blocked by fingerprinting guard");
    });
    datToken("--warning", "oklch(78% .15 75)");
    expect(mauThree("--warning", "#f59e0b").getHexString()).toBe("f59e0b");
  });

  it("★ `getContext` trả `null` (jsdom trần) ⇒ dự phòng", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    datToken("--info", "oklch(70% .13 250)");
    expect(mauThree("--info", "#3b82f6").getHexString()).toBe("3b82f6");
  });
});

describe("★★★ mauHex — chuỗi hex cho những chỗ nhận `string` (nền cảnh)", () => {
  it("★★★ `--background` oklch ⇒ hex TỐI, KHÔNG phải `oklch(...)` nguyên văn", () => {
    // Lỗi đo được: `KhungCanh.tsx:262` làm `<color args={[mauNen]}/>`, tức
    // `new THREE.Color("oklch(14.5% .015 260)")` ⇒ nền cảnh **TRẮNG** ở theme
    // tối. Nhìn thấy được: canvas trắng toát giữa một ứng dụng nền tối.
    gaCanvas({ "oklch(14.5% .015 260)": [7, 10, 16] });
    datToken("--background", "oklch(14.5% .015 260)");
    const s = mauHex("--background", "#0f172a");
    expect(s).toMatch(/^#[0-9a-f]{6}$/i);
    expect(s).not.toContain("oklch");
    expect(s.toLowerCase()).toBe("#070a10");
    // và nó phải TỐI — đây mới là điều người dùng thấy
    const sang = [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
    expect(Math.max(...sang)).toBeLessThan(40);
  });

  it("★★★ chuỗi trả về PHẢI được `THREE.Color` đọc mà KHÔNG warn", () => {
    // Vòng khép kín: đây đúng là đường mà `KhungCanh` đi.
    gaCanvas({ "oklch(14.5% .015 260)": [7, 10, 16] });
    datToken("--background", "oklch(14.5% .015 260)");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const c = new THREE.Color(mauHex("--background", "#0f172a"));
    expect(warn).not.toHaveBeenCalled();
    expect(c.getHexString()).not.toBe("ffffff");
    warn.mockRestore();
  });

  it("★ hex/rgb đi thẳng, không đổi", () => {
    datToken("--background", "#0f172a");
    expect(mauHex("--background", "#000000")).toBe("#0f172a");
  });

  it("★ token vắng ⇒ dự phòng", () => {
    expect(mauHex("--khong-co", "#0f172a")).toBe("#0f172a");
  });
});
