import { describe, it, expect } from "vitest";
import {
  CUA_SO_TUA_MS,
  TOC_DO,
  BUOC_MS,
  kepMoc,
  nhanMoc,
  mocTheoBuoc,
  huongTuPhim,
  oDangGo,
} from "./DongThoiGian";

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

/* ═══════════════════════════════════════════════════════════════════════════ */
/* #37 — SCRUB THEO BIÊN STEP + PHÍM ←/→ (Đợt 12 lô L)                         */
/* ═══════════════════════════════════════════════════════════════════════════ */

const BUOC = 5 * 60 * 1000;
/** Một mốc CỐ Ý LỆCH BIÊN: 09:03:47.123 — đúng thứ hai đường vào thật sinh ra. */
const LECH = new Date("2026-09-07T09:03:47.123Z").getTime();
/** `bayGio` đủ xa để không có phép kẹp nào can thiệp vào các ca dưới. */
const GIO = new Date("2026-09-07T18:00:00Z").getTime();

describe("★★★ mocTheoBuoc — CĂN BIÊN, không phải `moc + delta`", () => {
  it("★★★ ĐỘT BIẾN CHÍNH: từ mốc LỆCH biên, lùi ra đúng BIÊN DƯỚI — không phải goc-5ph", () => {
    const ra = mocTheoBuoc(LECH, -1, GIO);
    // cộng thô sẽ cho 08:58:47.123 — vẫn lệch biên, và đó là bản cũ.
    expect(ra).toBe(new Date("2026-09-07T09:00:00.000Z").getTime());
    expect(ra).not.toBe(LECH - BUOC);
    expect(ra % BUOC).toBe(0);
  });

  it("★★★ từ mốc LỆCH biên, tiến ra đúng BIÊN TRÊN — không phải goc+5ph", () => {
    const ra = mocTheoBuoc(LECH, 1, GIO);
    expect(ra).toBe(new Date("2026-09-07T09:05:00.000Z").getTime());
    expect(ra).not.toBe(LECH + BUOC);
    expect(ra % BUOC).toBe(0);
  });

  it("★★★ KHÔNG có biên nào bị NHẢY QUA: lùi hai lần đi qua 09:00 rồi mới tới 08:55", () => {
    // Luật con 1. Bỏ nó đi thì 09:00:00 là một mốc KHÔNG BAO GIỜ tới được bằng phím.
    const b1 = mocTheoBuoc(LECH, -1, GIO);
    const b2 = mocTheoBuoc(b1, -1, GIO);
    expect(b1).toBe(new Date("2026-09-07T09:00:00.000Z").getTime());
    expect(b2).toBe(new Date("2026-09-07T08:55:00.000Z").getTime());
  });

  it("★★★ G5/G32 — ĐÚNG BIÊN thì đầu ra phải KHÁC đầu vào (không phải f(x)=x)", () => {
    const bien = new Date("2026-09-07T09:00:00.000Z").getTime();
    expect(bien % BUOC).toBe(0);
    // Nếu chỉ "căn về biên" mà không đi trọn ô, cả hai phím đều chết cứng.
    expect(mocTheoBuoc(bien, -1, GIO)).toBe(bien - BUOC);
    expect(mocTheoBuoc(bien, 1, GIO)).toBe(bien + BUOC);
    expect(mocTheoBuoc(bien, -1, GIO)).not.toBe(bien);
    expect(mocTheoBuoc(bien, 1, GIO)).not.toBe(bien);
  });

  it("★ lưới TẤT ĐỊNH: hai điểm khởi hành khác nhau trong CÙNG một ô hội tụ một mốc", () => {
    const a = new Date("2026-09-07T09:01:02.003Z").getTime();
    const b = new Date("2026-09-07T09:04:59.999Z").getTime();
    expect(mocTheoBuoc(a, -1, GIO)).toBe(mocTheoBuoc(b, -1, GIO));
    expect(mocTheoBuoc(a, 1, GIO)).toBe(mocTheoBuoc(b, 1, GIO));
  });

  it("★ lưới neo vào EPOCH, không vào `bayGio` — đổi `bayGio` không làm trôi mốc", () => {
    const gio2 = GIO + 37_123; // một `Date.now()` khác, cùng ô
    expect(mocTheoBuoc(LECH, -1, gio2)).toBe(mocTheoBuoc(LECH, -1, GIO));
  });

  it("★ đang TRỰC TIẾP (`null`) ⇒ khởi hành từ `bayGio` và TRẢ VỀ MỘT MỐC", () => {
    // Bấm ◁ từ trực tiếp là đường VÀO chế độ tua; trả `null` thì phím vô dụng.
    const ra = mocTheoBuoc(null, -1, GIO);
    expect(ra).not.toBeNull();
    expect(ra).toBeLessThan(GIO);
    expect(ra % BUOC).toBe(0);
  });

  it("★★★ biên 24 h vẫn được CƯỠNG CHẾ sau khi căn — không nhìn trộm tương lai", () => {
    // Tiến từ một mốc sát `bayGio`: căn lên cho ra một biên Ở TƯƠNG LAI.
    const satGio = GIO - 1000;
    expect(mocTheoBuoc(satGio, 1, GIO)).toBe(GIO);
    // Lùi từ mép trái không được rơi ra ngoài cửa sổ.
    const mepTrai = GIO - CUA_SO_TUA_MS;
    expect(mocTheoBuoc(mepTrai, -1, GIO)).toBe(mepTrai);
  });
});

describe("★★★ huongTuPhim — KHÔNG cướp phím hệ thống", () => {
  it("←/→ trần ⇒ -1/+1", () => {
    expect(huongTuPhim({ key: "ArrowLeft" })).toBe(-1);
    expect(huongTuPhim({ key: "ArrowRight" })).toBe(1);
  });

  it("★★★ Alt+← là BACK của trình duyệt ⇒ KHÔNG nuốt", () => {
    expect(huongTuPhim({ key: "ArrowLeft", altKey: true })).toBeNull();
  });

  it("★ mọi phím bổ trợ khác cũng trả `null`", () => {
    for (const k of ["ctrlKey", "metaKey", "shiftKey"] as const) {
      expect(huongTuPhim({ key: "ArrowLeft", [k]: true })).toBeNull();
      expect(huongTuPhim({ key: "ArrowRight", [k]: true })).toBeNull();
    }
  });

  it("★ phím khác ⇒ `null` (↑/↓/Space/chữ không phải thao tác tua)", () => {
    for (const key of ["ArrowUp", "ArrowDown", " ", "a", "Enter", "Escape"]) {
      expect(huongTuPhim({ key })).toBeNull();
    }
  });
});

describe("★★★ oDangGo — ô đang gõ GIỮ được phím ←/→ của nó", () => {
  const gia = (tagName: string, ce = false) =>
    ({ tagName, isContentEditable: ce }) as unknown as Element;

  it("★★★ INPUT/TEXTAREA/SELECT giữ phím — nếu không, gõ trong ô lọc sẽ TUA CẢ NHÀ MÁY", () => {
    expect(oDangGo(gia("INPUT"))).toBe(true);
    expect(oDangGo(gia("TEXTAREA"))).toBe(true);
    expect(oDangGo(gia("SELECT"))).toBe(true);
  });

  it("★ contentEditable cũng là ô đang gõ", () => {
    expect(oDangGo(gia("DIV", true))).toBe(true);
  });

  it("★ nền/canvas/nút KHÔNG giữ phím ⇒ tua chạy được khi đang nhìn cảnh 3D", () => {
    expect(oDangGo(gia("DIV"))).toBe(false);
    expect(oDangGo(gia("CANVAS"))).toBe(false);
    expect(oDangGo(gia("BUTTON"))).toBe(false);
  });

  it("★ không có tiêu điểm (`null`/`undefined`) ⇒ không phải ô gõ", () => {
    expect(oDangGo(null)).toBe(false);
    expect(oDangGo(undefined)).toBe(false);
  });
});
