/**
 * Lưới cho `mauTrangThai.ts` — nguồn sự thật màu của cảnh 3D (§10.2).
 *
 * ⚠ TÊN TỆP: `.unit.test.ts`, KHÔNG phải `.test.ts`. Brief Đợt 0 ghi
 * `mauTrangThai.test.ts`, nhưng `vitest.config.ts` include đúng
 * `client/src/**\/*.unit.test.ts` — một tệp tên `.test.ts` dưới client/src sẽ KHÔNG
 * BAO GIỜ được vitest thu thập, tức là "lưới xanh" mà chưa từng chạy một dòng nào.
 * Đó chính xác là lớp lỗi "glob rỗng ⇒ vitest im lặng, cổng khai xanh" (VRAM Pha 4).
 * Cầu chì đầu tiên dưới đây tồn tại để chứng minh tệp này CÓ chạy.
 *
 * Ba điều §10.2 yêu cầu test, đều có mặt:
 *   • mọi giá trị `operationStatusEnum` có ánh xạ
 *   • `khong_ro` khác mọi màu "khoẻ"
 *   • bảng màu ≤ 7 mã (ASM 6.1)
 */
import { describe, it, expect } from "vitest";
import {
  mauChoTrangThai,
  mauTheoTuoi,
  mucTuoi,
  giaiMauCanh,
  MOI_TRANG_THAI_CANH,
  TRANG_THAI_DB,
  TOKEN_DA_DUNG,
  type TrangThaiCanh,
} from "./mauTrangThai";

/**
 * Tám giá trị `operationStatusEnum` chép NGUYÊN VĂN từ `drizzle/schema/enums.ts`.
 * Cố ý chép tay thay vì import: nếu ai đó thêm giá trị vào enum DB mà quên bảng màu,
 * import sẽ khiến hai bên cùng đổi và test vẫn xanh (hai phép đo cùng một nguồn —
 * đúng lớp lỗi BG-127). Danh sách rời này buộc người sửa enum phải sửa cả ở đây.
 */
const ENUM_DB_NGUYEN_VAN = [
  "running", "stopped", "error", "maintenance",
  "warming_up", "changeover", "starved", "blocked",
] as const;

describe("cầu chì — lưới này THỰC SỰ chạy", () => {
  it("thấy đủ 10 trạng thái cảnh (nếu 0 thì glob đang canh tập rỗng)", () => {
    expect(MOI_TRANG_THAI_CANH.length).toBe(10);
  });
});

describe("§10.2 — mọi giá trị operationStatusEnum đều có ánh xạ", () => {
  it("★★★ 8/8 giá trị enum DB có màu riêng, không rơi về khong_ro", () => {
    for (const tt of ENUM_DB_NGUYEN_VAN) {
      const m = mauChoTrangThai(tt);
      expect(m.khoaNhan, `${tt} phải có nhãn riêng`).not.toBe("twin3d.trangThai.khongRo");
      expect(m.token, `${tt} phải có token`).toMatch(/^--[a-z-]+$/);
    }
  });

  it("TRANG_THAI_DB khớp đúng enum DB (không thừa, không thiếu)", () => {
    expect([...TRANG_THAI_DB].sort()).toEqual([...ENUM_DB_NGUYEN_VAN].sort());
  });

  it("★★ chiều NGƯỢC — giá trị lạ rơi về khong_ro, KHÔNG về running", () => {
    // Máy chưa từng báo cáo (null), enum nở thêm giá trị ở migration sau, hoặc dữ
    // liệu hỏng. Mặc định-về-khoẻ là đúng lớp lỗi NT-3.
    for (const la of [null, undefined, "", "RUNNING", "chay", 42, {}, []]) {
      expect(mauChoTrangThai(la).khoaNhan).toBe("twin3d.trangThai.khongRo");
    }
  });
});

describe("§10.2 — khong_ro KHÁC mọi màu 'khoẻ'", () => {
  const khongRo = mauChoTrangThai("khong_ro");

  it("★★★ khong_ro không dùng chung token với running/warming_up/changeover", () => {
    for (const khoe of ["running", "warming_up", "changeover"] as TrangThaiCanh[]) {
      expect(mauChoTrangThai(khoe).token).not.toBe(khongRo.token);
    }
  });

  it("★★ khong_ro mang hoạ tiết gạch chéo — mã hoá DƯ THỪA, không chỉ dựa vào màu", () => {
    // Người mù màu / màn hình chói nắng / ảnh đen trắng vẫn phải phân biệt được.
    expect(khongRo.hoaTiet).toBe("gach_cheo");
    for (const khoe of ["running", "warming_up", "changeover"] as TrangThaiCanh[]) {
      expect(mauChoTrangThai(khoe).hoaTiet).toBe("khong");
    }
  });

  it("★★ khong_ro cũng KHÔNG được suy biến về error (không phải cứ mất tín hiệu là hỏng)", () => {
    expect(khongRo.token).not.toBe(mauChoTrangThai("error").token);
    expect(khongRo.laBatThuong).toBe(false);
  });
});

describe("§10.1 ISA-101 — xám mặc định, màu chỉ cho bất thường", () => {
  it("★★★ CHỈ `error` là bất thường — đúng MỘT màu bão hoà trong cảnh", () => {
    const batThuong = MOI_TRANG_THAI_CANH.filter((t) => mauChoTrangThai(t).laBatThuong);
    expect(batThuong).toEqual(["error"]);
  });

  it("★★ `running` KHÔNG dùng --success (xanh lá rực) — 42/43 máy chạy tốt không được rực rỡ", () => {
    expect(mauChoTrangThai("running").token).not.toBe("--success");
    expect(mauChoTrangThai("running").token).toBe("--packml-run");
  });

  it("★★ `stopped` KHÔNG đỏ — dừng chủ động không phải lỗi (chống mòn cảnh báo)", () => {
    expect(mauChoTrangThai("stopped").token).not.toBe("--destructive");
  });

  it("★ ngung_khai_thac mờ 35%, không mang màu trạng thái", () => {
    const m = mauChoTrangThai("ngung_khai_thac");
    expect(m.doMo).toBeCloseTo(0.35, 5);
    expect(m.laBatThuong).toBe(false);
  });
});

describe("§10.2 / ASM Guideline 6.1 — bảng màu ≤ 7 mã", () => {
  it("★★★ số token KHÁC NHAU không vượt 7 (giới hạn trí nhớ ngắn hạn)", () => {
    expect(TOKEN_DA_DUNG.length).toBeLessThanOrEqual(7);
  });

  it("cầu chì: phép đếm phải thấy >1 token (nếu =1 thì nó đang đếm nhầm)", () => {
    expect(TOKEN_DA_DUNG.length).toBeGreaterThan(1);
  });
});

describe("NT-3 — ba mức tươi và luật 'quá hạn thắng trạng thái'", () => {
  const T0 = 1_700_000_000_000;

  it("< 60s = tươi · 60s–5phút = cũ · > 5phút = không rõ", () => {
    expect(mucTuoi(T0 - 30_000, T0)).toBe("tuoi");
    expect(mucTuoi(T0 - 59_999, T0)).toBe("tuoi");
    expect(mucTuoi(T0 - 60_000, T0)).toBe("cu");
    expect(mucTuoi(T0 - 300_000, T0)).toBe("cu");
    expect(mucTuoi(T0 - 300_001, T0)).toBe("khong_ro");
  });

  it("thiếu dấu thời gian = không rõ, KHÔNG phải tươi", () => {
    expect(mucTuoi(null, T0)).toBe("khong_ro");
    expect(mucTuoi(undefined, T0)).toBe("khong_ro");
  });

  it("★★★ máy báo 'running' từ 40 phút trước KHÔNG được vẽ như đang chạy", () => {
    // Chế độ hỏng chết người nhất của HMI: tag vẫn Good, timestamp ngừng tiến, badge
    // vẫn xanh, không alarm nào nổ.
    const m = mauTheoTuoi("running", T0 - 40 * 60_000, T0);
    expect(m.khoaNhan).toBe("twin3d.trangThai.khongRo");
    expect(m.hoaTiet).toBe("gach_cheo");
  });

  it("★★ quá hạn thắng CẢ `error` — không rõ là không rõ, kể cả lỗi cuối cùng đã thấy", () => {
    expect(mauTheoTuoi("error", T0 - 10 * 60_000, T0).khoaNhan).toBe("twin3d.trangThai.khongRo");
  });

  it("★★ dữ liệu tươi giữ NGUYÊN màu trạng thái (chiều ngược — vá không nuốt ca đúng)", () => {
    const m = mauTheoTuoi("error", T0 - 5_000, T0);
    expect(m.khoaNhan).toBe("twin3d.trangThai.error");
    expect(m.doMo).toBe(1);
  });

  it("★ dữ liệu 'cũ' nhạt đi 40% nhưng GIỮ trạng thái (chưa phải không rõ)", () => {
    const m = mauTheoTuoi("error", T0 - 120_000, T0);
    expect(m.khoaNhan).toBe("twin3d.trangThai.error");
    expect(m.doMo).toBeCloseTo(0.6, 5);
  });
});

describe("giaiMauCanh — phân giải token, không hardcode hex", () => {
  it("trả nguyên chuỗi màu trình duyệt tính ra", () => {
    expect(giaiMauCanh("--destructive", () => " rgb(220, 38, 38) ")).toBe("rgb(220, 38, 38)");
  });

  it("★★ token đọc không ra trả `null`, KHÔNG trả màu dự phòng câm", () => {
    // Màu dự phòng thầm lặng sẽ vẽ máy lỗi thành một màu trông ổn — lại đúng NT-3.
    expect(giaiMauCanh("--khong-ton-tai", () => "")).toBeNull();
    expect(giaiMauCanh("--khong-ton-tai", () => "   ")).toBeNull();
  });

  it("★ mọi token trong bảng đều là biến CSS hợp lệ (bắt lỗi gõ nhầm tên token)", () => {
    for (const t of TOKEN_DA_DUNG) {
      expect(t).toMatch(/^--[a-z][a-z0-9-]*$/);
    }
  });
});
