/**
 * xuatXuNhip.unit.test.ts — ghim B-3 (§14.5.3, mục G-6, F-04).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ CÁI ĐƯỢC ĐO Ở ĐÂY LÀ MỘT PHÂN BIỆT, KHÔNG PHẢI MỘT GIÁ TRỊ
 * ════════════════════════════════════════════════════════════════════════════
 * Chỉ báo cũ (`trang-thai-ket-noi`) gộp hai tình huống khác hẳn nhau vào một ô
 * "Trực tiếp": (a) socket đẩy và không gì khác, (b) socket đẩy NHƯNG poll nền
 * 30 s cũng đang giao một phần số. Module này tách chúng ra.
 *
 * ⇒ Nên phép đo trung tâm là: **hai đầu vào chỉ khác nhau ở `mocPollCuoi` phải
 *   cho HAI kết quả khác nhau**. Nếu chúng cho cùng kết quả thì module này không
 *   mua được gì và nó chỉ là `coLuongTheoKetNoi` viết dài — đúng thứ G12 cấm.
 *   Ca đối chứng đó có mặt và được đánh dấu ★★★.
 */

import { describe, expect, it } from "vitest";

import { NHIP_CO_LUONG_MS, NHIP_KHONG_LUONG_MS, coLuongTheoKetNoi } from "./nguonDuLieu";
import {
  NGUONG_GOI_CON_MOI_MS,
  coCheGiao,
  khaiNguonSo,
  nhipHieuLucMs,
  type CoCheGiao,
  type TinhHinhNguon,
} from "./xuatXuNhip";

const BAY_GIO = Date.parse("2026-09-08T09:40:00.000Z");
const GIAY = 1000;

function tinh(p: Partial<TinhHinhNguon> = {}): TinhHinhNguon {
  return {
    ketNoi: "truc_tiep",
    mocGoiCuoi: BAY_GIO - 2 * GIAY,
    mocPollCuoi: null,
    dangXemLai: false,
    ...p,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
describe("★★★ PHÂN BIỆT TRUNG TÂM — `day` vs `hon_hop`", () => {
  it("★★★ hai đầu vào CHỈ khác `mocPollCuoi` ⇒ HAI kết quả khác nhau", () => {
    const chiDay = tinh({ mocPollCuoi: null });
    const coCaHai = tinh({ mocPollCuoi: BAY_GIO - 10 * GIAY });

    // Tiền đề: hai đầu vào giống hệt nhau ở MỌI ô khác.
    expect({ ...chiDay, mocPollCuoi: null }).toEqual({ ...coCaHai, mocPollCuoi: null });

    expect(coCheGiao(chiDay, BAY_GIO)).toBe("day");
    expect(coCheGiao(coCaHai, BAY_GIO)).toBe("hon_hop");
  });

  it("★★★ ĐỐI CHỨNG G12 — chỉ báo CŨ gộp cả hai vào một ô, nên nó KHÔNG thay được cái này", () => {
    const chiDay = tinh({ mocPollCuoi: null });
    const coCaHai = tinh({ mocPollCuoi: BAY_GIO - 10 * GIAY });
    // `coLuongTheoKetNoi` cho CÙNG câu trả lời cho hai tình huống khác nhau —
    // đó chính là khoảng trống mà module này lấp, chứng minh bằng số.
    expect(coLuongTheoKetNoi(chiDay.ketNoi)).toBe(coLuongTheoKetNoi(coCaHai.ketNoi));
    expect(coCheGiao(chiDay, BAY_GIO)).not.toBe(coCheGiao(coCaHai, BAY_GIO));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
describe("coCheGiao — năm ô, mỗi ô có mẫu đi qua (G5: không nhánh nào chết)", () => {
  it("★ tiền đề: NĂM mã và mỗi mã đều đạt tới được từ một đầu vào hợp lệ", () => {
    const mau: Record<CoCheGiao, TinhHinhNguon> = {
      day: tinh({ mocPollCuoi: null }),
      hon_hop: tinh({ mocPollCuoi: BAY_GIO - 10 * GIAY }),
      hoi: tinh({ ketNoi: "chua_ket_noi", mocGoiCuoi: null, mocPollCuoi: BAY_GIO - GIAY }),
      lich_su: tinh({ dangXemLai: true }),
      chua_ro: tinh({ mocGoiCuoi: null, mocPollCuoi: null }),
    };
    const ra = new Set<CoCheGiao>();
    for (const [mong, t] of Object.entries(mau) as [CoCheGiao, TinhHinhNguon][]) {
      const cc = coCheGiao(t, BAY_GIO);
      expect(cc).toBe(mong);
      ra.add(cc);
    }
    expect(ra.size).toBe(5);
  });

  it("★★★ `dangXemLai` THẮNG mọi thứ — socket khoẻ cũng không đổi được câu trả lời", () => {
    const t = tinh({ dangXemLai: true, mocPollCuoi: BAY_GIO });
    // Tiền đề: nếu KHÔNG tua thì đây chắc chắn là `hon_hop`.
    expect(coCheGiao({ ...t, dangXemLai: false }, BAY_GIO)).toBe("hon_hop");
    expect(coCheGiao(t, BAY_GIO)).toBe("lich_su");
  });

  it("★★★ chưa bằng chứng nào ⇒ `chua_ro`, KHÔNG phải `hoi` — không bịa cơ chế chưa chạy", () => {
    expect(coCheGiao(tinh({ mocGoiCuoi: null, mocPollCuoi: null }), BAY_GIO)).toBe("chua_ro");
  });

  it("★ socket khoẻ nhưng gói QUÁ CŨ ⇒ `hoi` — 'connected' không phải bằng chứng đang chảy", () => {
    const cu = tinh({
      ketNoi: "truc_tiep",
      mocGoiCuoi: BAY_GIO - NGUONG_GOI_CON_MOI_MS - GIAY,
      mocPollCuoi: BAY_GIO - GIAY,
    });
    expect(coCheGiao(cu, BAY_GIO)).toBe("hoi");
  });

  it("★ hai chiều quanh ngưỡng gói còn mới", () => {
    const tai = tinh({ mocGoiCuoi: BAY_GIO - NGUONG_GOI_CON_MOI_MS, mocPollCuoi: null });
    const qua = tinh({ mocGoiCuoi: BAY_GIO - NGUONG_GOI_CON_MOI_MS - 1, mocPollCuoi: null });
    expect(coCheGiao(tai, BAY_GIO)).toBe("day");
    expect(coCheGiao(qua, BAY_GIO)).toBe("hoi");
  });

  it("★★★ ngưỡng DÀI HƠN nhịp poll — nếu ngắn hơn, chỉ báo nhấp nháy mỗi chu kỳ", () => {
    expect(NGUONG_GOI_CON_MOI_MS).toBeGreaterThan(NHIP_CO_LUONG_MS);
  });

  it("bốn ô kết nối KHÔNG phải `truc_tiep` đều KHÔNG cho `day` (dù gói còn mới)", () => {
    for (const k of ["chua_ket_noi", "dang_cho", "im_lang", "xem_lai"]) {
      expect(coCheGiao(tinh({ ketNoi: k, mocPollCuoi: null }), BAY_GIO)).toBe("hoi");
    }
    // Đối chứng: ô thứ năm thì CÓ.
    expect(coCheGiao(tinh({ ketNoi: "truc_tiep", mocPollCuoi: null }), BAY_GIO)).toBe("day");
  });

  it("mốc RÁC (NaN/Infinity) không lọt thành 'gói còn mới'", () => {
    expect(coCheGiao(tinh({ mocGoiCuoi: Number.NaN, mocPollCuoi: BAY_GIO }), BAY_GIO)).toBe("hoi");
    expect(
      coCheGiao(tinh({ mocGoiCuoi: Number.POSITIVE_INFINITY, mocPollCuoi: BAY_GIO }), BAY_GIO),
    ).toBe("hoi");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
describe("nhipHieuLucMs — 'tối đa bao lâu nữa con số mới đổi'", () => {
  it("★★★ `day`/`hon_hop` trả 30 s, KHÔNG trả 0 — '?? 0' là lời khai sai (§14.5.6)", () => {
    expect(nhipHieuLucMs("day")).toBe(NHIP_CO_LUONG_MS);
    expect(nhipHieuLucMs("hon_hop")).toBe(NHIP_CO_LUONG_MS);
    expect(nhipHieuLucMs("day")).not.toBe(0);
  });

  it("★ `hoi`/`chua_ro` trả 5 s — nhịp poll khi không luồng", () => {
    expect(nhipHieuLucMs("hoi")).toBe(NHIP_KHONG_LUONG_MS);
    expect(nhipHieuLucMs("chua_ro")).toBe(NHIP_KHONG_LUONG_MS);
  });

  it("★★★ `lich_su` trả `null` — ảnh lịch sử KHÔNG tự làm mới, hứa ms là hứa suông", () => {
    expect(nhipHieuLucMs("lich_su")).toBeNull();
  });

  it("★ tiền đề: hai nhịp RỜI NHAU, nếu không phép phân biệt vô nghĩa", () => {
    expect(NHIP_CO_LUONG_MS).not.toBe(NHIP_KHONG_LUONG_MS);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
describe("khaiNguonSo — lời khai gộp", () => {
  it("★★★ `tuoiMs` lấy MỚI NHẤT của CẢ HAI cơ chế — cùng một câu, khác đường vận chuyển", () => {
    const t = tinh({ mocGoiCuoi: BAY_GIO - 30 * GIAY, mocPollCuoi: BAY_GIO - 3 * GIAY });
    const k = khaiNguonSo(t, BAY_GIO);
    // Poll mới hơn ⇒ tuổi phải theo poll, không theo socket.
    expect(k.tuoiMs).toBe(3 * GIAY);
    expect(k.tuoiMs).not.toBe(30 * GIAY);
  });

  it("★ chỉ có socket ⇒ tuổi theo socket; chỉ có poll ⇒ tuổi theo poll", () => {
    expect(khaiNguonSo(tinh({ mocGoiCuoi: BAY_GIO - 7 * GIAY, mocPollCuoi: null }), BAY_GIO).tuoiMs).toBe(
      7 * GIAY,
    );
    expect(
      khaiNguonSo(
        tinh({ ketNoi: "chua_ket_noi", mocGoiCuoi: null, mocPollCuoi: BAY_GIO - 9 * GIAY }),
        BAY_GIO,
      ).tuoiMs,
    ).toBe(9 * GIAY);
  });

  it("★★★ chưa từng có dữ liệu ⇒ `tuoiMs` NULL, KHÔNG phải 0 — '0' nói 'vừa xong'", () => {
    const k = khaiNguonSo(tinh({ mocGoiCuoi: null, mocPollCuoi: null }), BAY_GIO);
    expect(k.tuoiMs).toBeNull();
    expect(k.coChe).toBe("chua_ro");
  });

  it("★★★ mốc ở TƯƠNG LAI (đồng hồ lệch) ⇒ tuổi KẸP về 0, KHÔNG ra số âm và KHÔNG ra null", () => {
    const k = khaiNguonSo(tinh({ mocGoiCuoi: BAY_GIO + 5 * GIAY, mocPollCuoi: null }), BAY_GIO);
    expect(k.tuoiMs).toBe(0);
    // Ta CÓ dữ liệu — trả `null` sẽ khai nhầm thành 'chưa từng có'.
    expect(k.tuoiMs).not.toBeNull();
  });

  it("★ `chiTuHoi` bật ĐÚNG một ô — tách cờ để không nơi nào phải nhớ danh sách mã", () => {
    const cc: CoCheGiao[] = ["day", "hon_hop", "hoi", "lich_su", "chua_ro"];
    const bat = cc.filter((c) => c === "hoi");
    expect(bat).toEqual(["hoi"]);
    expect(
      khaiNguonSo(
        tinh({ ketNoi: "chua_ket_noi", mocGoiCuoi: null, mocPollCuoi: BAY_GIO - GIAY }),
        BAY_GIO,
      ).chiTuHoi,
    ).toBe(true);
    expect(khaiNguonSo(tinh({ mocPollCuoi: null }), BAY_GIO).chiTuHoi).toBe(false);
  });

  it("★ đang tua ⇒ `nhipHieuLucMs` null nhưng `tuoiMs` VẪN có — hai đại lượng rời nhau", () => {
    const k = khaiNguonSo(
      tinh({ dangXemLai: true, mocGoiCuoi: BAY_GIO - 4 * GIAY, mocPollCuoi: null }),
      BAY_GIO,
    );
    expect(k.coChe).toBe("lich_su");
    expect(k.nhipHieuLucMs).toBeNull();
    expect(k.tuoiMs).toBe(4 * GIAY);
  });

  it("★ G72 — KHÔNG ô nào là câu chữ hiển thị; mọi ô là mã hoặc số", () => {
    const k = khaiNguonSo(tinh(), BAY_GIO);
    expect(typeof k.coChe).toBe("string");
    // `coChe` là MÃ (snake_case, không dấu, không khoảng trắng) — không phải văn xuôi.
    expect(k.coChe).toMatch(/^[a-z_]+$/);
    expect(k.tuoiMs == null || typeof k.tuoiMs === "number").toBe(true);
    expect(k.nhipHieuLucMs == null || typeof k.nhipHieuLucMs === "number").toBe(true);
  });
});
