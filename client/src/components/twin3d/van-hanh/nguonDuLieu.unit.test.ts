import { describe, it, expect } from "vitest";
import {
  NHIP_CO_LUONG_MS,
  NHIP_KHONG_LUONG_MS,
  laGiaDinh,
  nhipHoiMs,
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
