import { describe, it, expect } from "vitest";
import {
  NHIP_CO_LUONG_MS,
  NHIP_KHONG_LUONG_MS,
  coLuongTheoKetNoi,
  laGiaDinh,
  nhipHoiMs,
  nhipHoiToiDa,
  xuatXuHienTai,
} from "./nguonDuLieu";
import { NGUONG_SONG_MS } from "./khoTrangThai";

/** ★ §11 #51 + #52 — ghim hai luật rút từ `FactoryLiveMap3D.tsx`. */

describe("#51 — nhịp hỏi thích nghi 5s ↔ 30s", () => {
  it("không có luồng ⇒ 5 giây", () => {
    expect(nhipHoiMs(false)).toBe(NHIP_KHONG_LUONG_MS);
    expect(nhipHoiMs(false)).toBe(5_000);
  });

  it("có luồng ⇒ 30 giây", () => {
    expect(nhipHoiMs(true)).toBe(NHIP_CO_LUONG_MS);
    expect(nhipHoiMs(true)).toBe(30_000);
  });

  it("★★★ có luồng KHÔNG tắt hẳn poll — lưới an toàn phải còn", () => {
    // Tắt hẳn nghĩa là một luồng chết âm thầm đóng băng màn hình vĩnh viễn.
    expect(nhipHoiMs(true)).toBeGreaterThan(0);
    expect(Number.isFinite(nhipHoiMs(true))).toBe(true);
  });

  it("★★★ cảnh báo `im_lang` phải đến TRƯỚC lượt poll cứu viện", () => {
    // Nếu poll cứu viện chạy trước, màn hình tự lành và người dùng không bao
    // giờ biết luồng đã chết — mất đúng tín hiệu G15 sinh ra để phát.
    expect(NGUONG_SONG_MS).toBeLessThan(NHIP_CO_LUONG_MS);
  });
});

describe("#52 — SHADOW vs TWIN: hai thứ trông giống nhau, nghĩa khác hẳn", () => {
  it("★★★ đang mô phỏng ⇒ `mo_phong`, THẮNG cả khi có số thật bên dưới", () => {
    // "Có số thật" là cách nhanh nhất để một con số giả định được đọc như số đo.
    expect(xuatXuHienTai({ coSoLieuThat: true, dangMoPhong: true }, true)).toBe("mo_phong");
  });

  it("có số liệu thật, không mô phỏng ⇒ `bong` (SHADOW)", () => {
    expect(xuatXuHienTai({ coSoLieuThat: true, dangMoPhong: false }, true)).toBe("bong");
  });

  it("★ chỉ có bố cục, không số liệu ⇒ `so_do` — KHÔNG phải `bong`", () => {
    // Một sơ đồ không có số đo nào mà tự khai là SHADOW là nói dối về việc
    // màn hình đang phản ánh nhà máy thật.
    expect(xuatXuHienTai({ coSoLieuThat: false, dangMoPhong: false }, true)).toBe("so_do");
  });

  it("★ không gì cả ⇒ `khong_ro`", () => {
    expect(xuatXuHienTai({ coSoLieuThat: false, dangMoPhong: false }, false)).toBe("khong_ro");
  });

  it("★★★ CHỈ `mo_phong` là giả định — ba ô kia không được gắn nhãn nhầm", () => {
    expect(laGiaDinh("mo_phong")).toBe(true);
    // Đối chứng: nếu `laGiaDinh` trả `true` cho mọi thứ, cảnh báo NT-4 sẽ hiện
    // khắp nơi và người dùng học cách phớt lờ nó.
    expect(laGiaDinh("bong")).toBe(false);
    expect(laGiaDinh("so_do")).toBe(false);
    expect(laGiaDinh("khong_ro")).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* #51 — CHỖ NỐI: NĂM TRẠNG THÁI G15 → NHỊP HỎI                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("#51 nối chỗ gọi — `coLuongTheoKetNoi` trên CẢ NĂM trạng thái G15", () => {
  it("★★★ `truc_tiep` là ô DUY NHẤT có luồng", () => {
    expect(coLuongTheoKetNoi("truc_tiep")).toBe(true);
  });

  it("★★★ `im_lang` KHÔNG phải có luồng — đây là ô dễ sai nhất", () => {
    // Socket vẫn `connected`, nhưng đã quá NGUONG_SONG_MS không phát gì. Đúng
    // lúc ta CẦN poll nhanh nhất. Quy nó về `true` (vì "đã kết nối") biến một
    // luồng chết âm thầm thành màn hình đóng băng 30 giây một nhịp.
    expect(coLuongTheoKetNoi("im_lang")).toBe(false);
    expect(nhipHoiMs(coLuongTheoKetNoi("im_lang"))).toBe(NHIP_KHONG_LUONG_MS);
  });

  it("★★★ BỐN trên NĂM ô trả `false` — KHÔNG phải `!== chua_ket_noi`", () => {
    const tat = ["chua_ket_noi", "dang_cho", "truc_tiep", "im_lang", "xem_lai"];
    const co = tat.filter((k) => coLuongTheoKetNoi(k));
    expect(co).toEqual(["truc_tiep"]);
    // Đối chứng: phép quy NGÂY THƠ cho 4 ô — sai 3 trên 5.
    const ngayTho = tat.filter((k) => k !== "chua_ket_noi");
    expect(ngayTho).toHaveLength(4);
    expect(ngayTho).not.toEqual(co);
  });

  it("★ `xem_lai` giữ nhịp NHANH — về trực tiếp là có dữ liệu ngay", () => {
    expect(nhipHoiMs(coLuongTheoKetNoi("xem_lai"))).toBe(NHIP_KHONG_LUONG_MS);
  });
});

describe("#51 — `nhipHoiToiDa` chỉ RÚT NGẮN, không bao giờ kéo dài", () => {
  it("★★★ truy vấn an toàn 20 s KHÔNG bị đẩy lên 30 s khi socket khoẻ", () => {
    // Áp thẳng `nhipHoiMs` sẽ làm CHẬM ĐI `andon.active` và `anToanRobot` —
    // một hồi quy đội lốt "nối tính năng".
    expect(nhipHoiMs(true)).toBe(30_000);
    expect(nhipHoiToiDa(true, 20_000)).toBe(20_000);
  });

  it("★★★ socket chết ⇒ CẢ hai loại truy vấn đều rút về 5 s", () => {
    expect(nhipHoiToiDa(false, 20_000)).toBe(NHIP_KHONG_LUONG_MS);
    expect(nhipHoiToiDa(false, 30_000)).toBe(NHIP_KHONG_LUONG_MS);
  });

  it("★ trần rộng hơn 30 s không nâng nhịp lên quá `NHIP_CO_LUONG_MS`", () => {
    expect(nhipHoiToiDa(true, 300_000)).toBe(NHIP_CO_LUONG_MS);
  });

  it("★★★ kết quả LUÔN ≤ trần và LUÔN > 0 — lưới an toàn không được tắt", () => {
    for (const tran of [1_000, 5_000, 20_000, 30_000, 60_000]) {
      for (const co of [true, false]) {
        const r = nhipHoiToiDa(co, tran);
        expect(r).toBeLessThanOrEqual(tran);
        expect(r).toBeGreaterThan(0);
      }
    }
  });
});
