// Thuần (không DB, không mạng): bộ che hỏng ⇒ NGOAI_CHE_HONG; chi tiết lỗi ra người gọi không bao giờ mang mảnh bí mật,
// kể cả khi thông điệp rất dài (6M) hoặc bí mật nằm đúng điểm có thể bị chẻ (quanh 8 000 và 500 ký tự).
import { describe, expect, it } from "vitest";
import { cheLoiNgoai, cheYeuCauHoacHong, TRAN_THONG_DIEP_LOI_CHE } from "./congNgoai";
import { THAY, TU_DIEN_RONG, type TuDienNhay } from "./cheDuLieu";
import { LoiNgoai } from "./loi";
import type { YeuCauNhaCungCap } from "./nhaCungCap/kieu";

// Khoá giả dáng Anthropic, phần đuôi trộn chữ để mọi mảnh đều nhận ra được.
const BI_MAT = `sk-ant-api03-${"Kq7Zx2Wm9Rt4".repeat(8)}`;
// Mảnh nào của bí mật cũng không được xuất hiện: đầu (6 ký tự) và các đoạn 8 ký tự của đuôi.
const manhBiMat = [BI_MAT.slice(0, 5), ...Array.from({ length: 10 }, (_, i) => BI_MAT.slice(13 + i * 8, 21 + i * 8))];
const khongMangManh = (s: string) => {
  for (const m of manhBiMat) expect(s, `lọt mảnh "${m}"`).not.toContain(m);
};

// Hai nhánh tạo lỗi: lỗi thường (thông điệp) và LoiNgoai của nhà cung cấp (chiTiet).
const NHANH: Array<[string, (thongDiep: string) => unknown]> = [
  ["Error thường", (t) => new Error(t)],
  ["LoiNgoai NHA_CUNG_CAP_LOI", (t) => new LoiNgoai("NGOAI_NHA_CUNG_CAP_LOI", t, { phanLoai: "QUOTA" })],
];

// Từ điển mà việc duyệt tập ném ⇒ mọi lần che (kể cả che thông điệp lỗi) ném.
const tuDienHong = (): TuDienNhay => ({
  tenNguoiDung: {
    [Symbol.iterator]() {
      throw new RangeError("goc-khong-duoc-lo");
    },
  } as unknown as ReadonlySet<string>,
  tenKhach: new Set(),
  tenNhaMay: new Set(),
});

const yeuCau = (noiDung: string): YeuCauNhaCungCap => ({ model: "m", tinNhan: [{ vaiTro: "user", noiDung }], maxTokens: 10, nhietDo: 0.2 });

describe("cheYeuCauHoacHong — bộ che ném ⇒ NGOAI_CHE_HONG", () => {
  it("từ điển hỏng (duyệt tập ném) ⇒ LoiNgoai NGOAI_CHE_HONG, không lộ lỗi gốc", () => {
    const tapHong = {
      [Symbol.iterator]() {
        throw new RangeError("goc-khong-duoc-lo");
      },
    } as unknown as ReadonlySet<string>;
    const tuHong: TuDienNhay = { tenNguoiDung: tapHong, tenKhach: new Set(), tenNhaMay: new Set() };
    let loi: unknown;
    try {
      cheYeuCauHoacHong(yeuCau("xin chao"), tuHong);
    } catch (e) {
      loi = e;
    }
    expect(loi).toBeInstanceOf(LoiNgoai);
    expect((loi as LoiNgoai).ma).toBe("NGOAI_CHE_HONG");
    expect(String((loi as LoiNgoai).message)).not.toContain("goc-khong-duoc-lo");
  });

  it("đối chứng: từ điển lành ⇒ che bình thường", () => {
    const { daChe, soTruong } = cheYeuCauHoacHong(yeuCau(`khoa ${BI_MAT}`), TU_DIEN_RONG);
    expect(daChe.tinNhan[0]!.noiDung).not.toContain(BI_MAT);
    expect(soTruong).toBeGreaterThan(0);
  });
});

describe("cheLoiNgoai — chi tiết lỗi đã che, ≤ 500 ký tự, thông điệp > 8 000 ký tự không mang nội dung", () => {
  it.each(NHANH)("%s: thông điệp 6M ký tự ⇒ LoiNgoai NHA_CUNG_CAP_LOI, chỉ báo độ dài", (_ten, tao) => {
    const k = cheLoiNgoai(tao(`${"x".repeat(3_000_000)} ${BI_MAT} ${"y".repeat(2_999_000)}`), TU_DIEN_RONG);
    expect(k).toBeInstanceOf(LoiNgoai);
    expect(k.ma).toBe("NGOAI_NHA_CUNG_CAP_LOI");
    expect(k.chiTiet).toBe(`thong-diep-loi-qua-dai (${3_000_000 + 1 + BI_MAT.length + 1 + 2_999_000} ky tu)`);
    expect(k.chiTiet!.length).toBeLessThanOrEqual(500);
  });

  it.each(NHANH)("%s: biên 8 000 ⇒ che cả chuỗi và cắt 500; 8 001 ⇒ chỉ báo độ dài", (_ten, tao) => {
    // Phần đệm có khoảng trắng để không thành khối bảng base64 dài (khối đó cũng bị che, kết quả sẽ ngắn hơn 500).
    const vua = `${BI_MAT} ${"lo ".repeat(3000).slice(0, TRAN_THONG_DIEP_LOI_CHE - BI_MAT.length - 1)}`;
    expect(vua.length).toBe(8000);
    const k = cheLoiNgoai(tao(vua), TU_DIEN_RONG);
    expect(k.chiTiet!.startsWith(THAY.biMat)).toBe(true);
    expect(k.chiTiet!.length).toBe(500);
    khongMangManh(k.chiTiet!);
    expect(cheLoiNgoai(tao(`${vua}z`), TU_DIEN_RONG).chiTiet).toBe("thong-diep-loi-qua-dai (8001 ky tu)");
  });

  it.each(NHANH)("%s: bí mật nằm ĐÚNG điểm chẻ 7 990–8 010 sau khối base64 bị che co lại ⇒ không mảnh nào lọt", (_ten, tao) => {
    // 7 900 ký tự bảng base64 bị che thành một ký hiệu ngắn ⇒ nếu ai đó cắt ở 8 000 TRƯỚC khi che, mảnh "sk-ant-api" ở 7 990 sẽ
    // dời về khoảng ký tự 107 của kết quả, lọt vào 500 ký tự đầu.
    const truoc = `${"Q".repeat(7900)} ${"loi mang ".repeat(10).slice(0, 89)}`;
    expect(truoc.length).toBe(7990);
    const k = cheLoiNgoai(tao(`${truoc}${BI_MAT} het`), TU_DIEN_RONG);
    // Kiểm LỌT trước (đột biến "cắt trước che" phải đỏ vì mảnh lọt, không chỉ vì sai dạng thông điệp).
    khongMangManh(k.chiTiet!);
    expect(k.chiTiet).toMatch(/^thong-diep-loi-qua-dai \(\d+ ky tu\)$/);
  });

  it.each(NHANH)("%s: bí mật nằm ĐÚNG điểm chẻ 495–505 ⇒ che cả chuỗi rồi mới cắt, không mảnh nào lọt", (_ten, tao) => {
    // Có dấu cách ngay trước khoá: khoá DÍNH liền chữ phía trước ("…esk-ant-…") hiện KHÔNG bị luật khoá nhận (giới hạn có sẵn của
    // bộ che, đã báo riêng, không thuộc lô này).
    const truoc = `${"e".repeat(494)} `;
    const k = cheLoiNgoai(tao(`${truoc}${BI_MAT} con lai`), TU_DIEN_RONG);
    expect(k.chiTiet!.length).toBe(500);
    expect(k.chiTiet!.startsWith(truoc)).toBe(true);
    khongMangManh(k.chiTiet!);
  });

  it.each(NHANH)("%s: bộ che ném (từ điển hỏng) với thông điệp ngắn chứa bí mật ⇒ đúng 'thong-diep-loi-che-hong', 0 mảnh", (_ten, tao) => {
    const k = cheLoiNgoai(tao(`401 invalid x-api-key ${BI_MAT}`), tuDienHong());
    khongMangManh(k.chiTiet!);
    expect(k.ma).toBe("NGOAI_NHA_CUNG_CAP_LOI");
    expect(k.chiTiet).toBe("thong-diep-loi-che-hong");
  });

  it("lỗi lạ có toString/getter message NÉM ⇒ cheLoiNgoai KHÔNG ném, trả 'thong-diep-loi-che-hong'", () => {
    const toStringNem = { message: undefined, toString: () => { throw new Error(`lo ${BI_MAT}`); } };
    const getterNem = Object.defineProperty({}, "message", { get: () => { throw new Error(`lo ${BI_MAT}`); } });
    for (const e of [toStringNem, getterNem]) {
      // Ném ở đây ⇒ ca đỏ (đó chính là lỗi cần bắt).
      const k = cheLoiNgoai(e, TU_DIEN_RONG);
      expect(k.ma).toBe("NGOAI_NHA_CUNG_CAP_LOI");
      expect(k.chiTiet).toBe("thong-diep-loi-che-hong");
    }
  });

  it("giữ phanLoai của lỗi nhà cung cấp, không mang requestId; lỗi cổng khác giữ nguyên", () => {
    const k = cheLoiNgoai(new LoiNgoai("NGOAI_NHA_CUNG_CAP_LOI", "het quota", { phanLoai: "QUOTA", requestId: "req_123" }), TU_DIEN_RONG);
    expect(k.phanLoai).toBe("QUOTA");
    expect(k.requestId).toBeUndefined();
    expect(k.chiTiet).toBe("het quota");
    const khac = new LoiNgoai("NGOAI_VUOT_TRAN");
    expect(cheLoiNgoai(khac, TU_DIEN_RONG)).toBe(khac);
  });
});
