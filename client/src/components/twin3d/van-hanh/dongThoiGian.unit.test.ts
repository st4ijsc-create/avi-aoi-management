import { describe, it, expect } from "vitest";
import { CUA_SO_TUA_MS, TOC_DO, BUOC_MS, kepMoc, nhanMoc } from "./DongThoiGian";

/**
 * ★ Đợt 6 (§9.8) — phần THUẦN của thanh tua lại.
 *
 * Chỉ test hai hàm thuần (`kepMoc`, `nhanMoc`) và các hằng: phần JSX là bộ điều
 * khiển không chứa luật nào, còn toàn bộ phép tính trạng thái nằm ở
 * `khoTrangThai.ts` và đã có test riêng. Test cái không chứa quyết định là cách
 * làm phồng số test mà không tăng thứ gì đo được.
 */

const BAY_GIO = new Date("2026-09-07T12:00:00Z").getTime();

describe("kepMoc — biên cửa sổ 24 h được cưỡng chế", () => {
  it("★ mốc ở TƯƠNG LAI bị kẹp về hiện tại — không nhìn trộm tương lai", () => {
    expect(kepMoc(BAY_GIO + 3600_000, BAY_GIO)).toBe(BAY_GIO);
  });

  it("★ mốc quá 24 h bị kẹp về mép trái", () => {
    expect(kepMoc(BAY_GIO - 48 * 3600_000, BAY_GIO)).toBe(BAY_GIO - CUA_SO_TUA_MS);
  });

  it("mốc trong cửa sổ giữ nguyên", () => {
    const m = BAY_GIO - 3 * 3600_000;
    expect(kepMoc(m, BAY_GIO)).toBe(m);
  });

  it("hai biên là ĐÓNG (kẹp không đẩy ra ngoài)", () => {
    expect(kepMoc(BAY_GIO, BAY_GIO)).toBe(BAY_GIO);
    expect(kepMoc(BAY_GIO - CUA_SO_TUA_MS, BAY_GIO)).toBe(BAY_GIO - CUA_SO_TUA_MS);
  });
});

describe("nhanMoc — `—` khi trực tiếp (NT-3.5)", () => {
  it("★★★ `null` ⇒ `—`, KHÔNG phải một giờ nào đó", () => {
    // Hiện "00:00" cho chế độ trực tiếp sẽ nói dối rằng đang xem lại nửa đêm.
    expect(nhanMoc(null)).toBe("—");
  });

  it("mốc có thật ⇒ HH:MM hai chữ số", () => {
    const d = new Date(2026, 8, 7, 9, 5, 0);
    expect(nhanMoc(d.getTime())).toBe("09:05");
  });
});

describe("hằng số — ghim để khỏi trôi", () => {
  it("cửa sổ đúng 24 giờ (§9.8)", () => {
    expect(CUA_SO_TUA_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("ba tốc độ ×1/×5/×20 (§9.8)", () => {
    expect([...TOC_DO]).toEqual([1, 5, 20]);
  });

  it("bước nhảy 5 phút", () => {
    expect(BUOC_MS).toBe(5 * 60 * 1000);
  });
});
