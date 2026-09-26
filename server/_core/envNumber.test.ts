/**
 * E4 — biến môi trường gõ sai KHÔNG được im lặng rơi về mặc định.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ "RƠI VỀ MẶC ĐỊNH" ĐÚNG; "IM LẶNG" MỚI LÀ CÁI SAI
 * ══════════════════════════════════════════════════════════════════════════════════
 * `Number("abc")` → NaN ⇒ mặc định. `"-1"`, `"0"` ⇒ mặc định. Không một dòng log.
 * Nghĩa là người vận hành gõ nhầm khi định **TẮT** một tính năng sẽ nhận đúng hành vi
 * **BẬT** — và với cooldown cảnh báo, "bật" là bốn giờ im lặng về một cái máy sắp hỏng.
 * Họ tin mình đã đổi cấu hình; hệ thống tin là chưa. Không ai sai, và không ai biết.
 *
 * ── BẪY ĐÃ SUÝT RƠI VÀO KHI VIẾT BẢN VÁ NÀY ─────────────────────────────────────
 * Sáu điểm đọc trông giống hệt nhau, nhưng **hai trong số đó dùng `>= 0`**:
 * `ALERT_RENOTIFY_COOLDOWN_CRITICAL_MINUTES=0` nghĩa là *"CRITICAL luôn báo ngay"* — một
 * giá trị CÓ NGHĨA, không phải "chưa đặt". Gom cả sáu vào một hàm `> 0` sẽ biến `0` thành
 * mặc định **240 phút**: bốn giờ im lặng cho đúng loại cảnh báo không được phép im.
 * ⇒ Cùng luật đã rút ở `masterDataIO.col.header` và `FORBIDDEN_GENERIC`: **trước khi gom
 *   hai chỗ trông giống nhau vào một khuôn, hỏi xem chúng có NGHĨA giống nhau không.**
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { soDuongTuEnv, soKhongAmTuEnv, inCauHinhHieuLuc, _resetEnvNumberState } from "./envNumber";

const TEN = "TEST_ENV_SO";
let warns: string[] = [];
let logs: string[] = [];

beforeEach(() => {
  _resetEnvNumberState();
  delete process.env[TEN];
  warns = [];
  logs = [];
  vi.spyOn(console, "warn").mockImplementation((...a) => { warns.push(a.join(" ")); });
  vi.spyOn(console, "log").mockImplementation((...a) => { logs.push(a.join(" ")); });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env[TEN];
});

describe("E4 — đọc số từ env không nuốt lỗi gõ nhầm", () => {
  it("không đặt ⇒ mặc định, KHÔNG cảnh báo (đó là chuyện bình thường)", () => {
    expect(soDuongTuEnv(TEN, 72)).toBe(72);
    expect(warns).toEqual([]);
  });

  it("đặt ĐÚNG ⇒ dùng giá trị đặt, không cảnh báo", () => {
    process.env[TEN] = "12";
    expect(soDuongTuEnv(TEN, 72)).toBe(12);
    expect(warns).toEqual([]);
  });

  it.each([["abc"], ["-1"], ["0"], [""], ["12h"]])(
    "★★★ đặt SAI (%s) ⇒ mặc định + CẢNH BÁO nêu đích danh biến",
    (v) => {
      process.env[TEN] = v;
      expect(soDuongTuEnv(TEN, 72)).toBe(72);
      if (v === "") {
        // Chuỗi rỗng = "không đặt" theo quy ước shell ⇒ im lặng là đúng.
        expect(warns).toEqual([]);
        return;
      }
      expect(warns.length).toBe(1);
      expect(warns[0]).toContain(TEN);
      expect(warns[0]).toContain("KHÔNG có tác dụng");
    },
  );

  it("★★★ chỉ cảnh báo MỘT LẦN — hàm này chạy trên MỖI cảnh báo", () => {
    // Không có luật này, một nhà máy có cảnh báo mỗi giây sẽ sinh một dòng warn mỗi giây:
    // đúng lớp lỗi mà E5 vừa phải sửa (log dùng để bắt lỗi tự trở thành nguồn nhiễu).
    process.env[TEN] = "abc";
    for (let i = 0; i < 100; i++) soDuongTuEnv(TEN, 72);
    expect(warns.length).toBe(1);
  });

  it("★★★ `soKhongAmTuEnv` PHẢI chấp nhận 0 — đó là giá trị CÓ NGHĨA", () => {
    // Đây là ca giữ cho bản vá không tự đào lỗ: 0 = "CRITICAL luôn báo ngay". Nếu ai đó
    // 'dọn dẹp' bằng cách gộp hai hàm về một ngưỡng `> 0`, ca này ĐỎ trước khi nó kịp
    // biến thành bốn giờ im lặng trên máy khách.
    process.env[TEN] = "0";
    expect(soKhongAmTuEnv(TEN, 240)).toBe(0);
    expect(warns).toEqual([]);
  });

  it("`soKhongAmTuEnv` vẫn bắt số âm và chữ", () => {
    process.env[TEN] = "-5";
    expect(soKhongAmTuEnv(TEN, 240)).toBe(240);
    expect(warns.length).toBe(1);
  });

  it("★★★ bảng cấu hình phải nói ĐÚNG nguồn của từng giá trị", () => {
    // Một bảng chỉ in số mà không nói số ấy TỪ ĐÂU sẽ khiến người đọc log tin rằng mình
    // đã đặt thành công — đúng thứ mục E4 sinh ra để chống.
    process.env[TEN] = "abc";
    inCauHinhHieuLuc("thử", [[TEN, 72], ["TEST_ENV_KHONG_DAT", 30]]);
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain(`${TEN}=72 (ĐẶT SAI→mặc định)`);
    expect(logs[0]).toContain("TEST_ENV_KHONG_DAT=30 (mặc định)");
  });
});
