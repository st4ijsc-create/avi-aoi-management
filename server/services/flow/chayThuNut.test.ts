/**
 * Đợt 9.1 — CHẠY THỬ MỘT NODE (không CSDL, AI GIẢ): chạy `chay` thật cho nhóm an toàn · xem trước (không chạy) cho nhóm có
 * tác dụng ra ngoài · không bao giờ giải mã bí mật · census ∀ sổ đăng ký + quét nguồn (không ghi lượt, không HTTP).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { danhSachNut } from "./dangKyNut";
import { chuanHoaIdMay } from "./idTaiNguyen";
import "./nut";
import { datHamGoiAi } from "./nut/ai";
import { __datNguonDocTagChoTest } from "./nut/ot";
import { LoiNgoaiPhamVi, NUT_CHAY_THAT, NUT_KHONG_THAM_CHIEU, NUT_XEM_TRUOC, THAM_CHIEU_TAI_NGUYEN, chayThuNut, type BoKiemPhamVi } from "./chayThuNut";

/** Bộ kiểm giả: chỉ máy trong tập được phép. */
const boKiem = (...cho: number[]): BoKiemPhamVi & { hoi: number[] } => {
  const hoi: number[] = [];
  return { hoi, may: async (id) => (hoi.push(id), cho.includes(id)), biMat: async () => false, luong: async () => false };
};

const nut = (type: string, parameters: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  id: "n1", type, typeVersion: 1, name: "n1", position: [0, 0] as [number, number], parameters, ...extra,
});

let khoiPhucAi: ReturnType<typeof datHamGoiAi> | null = null;
afterEach(() => {
  if (khoiPhucAi) datHamGoiAi(khoiPhucAi);
  khoiPhucAi = null;
  __datNguonDocTagChoTest(null);
});

describe("chayThuNut — nhóm CHAY (chạy hàm thật)", () => {
  it("du-lieu.dat: đánh giá biểu thức trên item mẫu, trả đầu ra theo cổng", async () => {
    const r = await chayThuNut({ nut: nut("du-lieu.dat", { truong: { gap: "{{ $json.x * 2 }}" } }), inputs: { main: [{ json: { x: 21 } }] } });
    expect(r).toMatchObject({ che: "chay", ok: true, output: { main: [{ json: { x: 21, gap: 42 } }] } });
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });

  it("logic.neu rẽ nhánh; $node đọc đầu ra node trước do người dùng cấp", async () => {
    const r = await chayThuNut({
      nut: nut("logic.neu", { dieuKien: "{{ $json.v > $node('truoc').json.nguong }}" }),
      inputs: { main: [{ json: { v: 5 } }, { json: { v: 1 } }] },
      dauRaNutTruoc: { truoc: [{ json: { nguong: 3 } }] },
    });
    expect(r.ok).toBe(true);
    expect(r.output).toEqual({ dung: [{ json: { v: 5 } }], sai: [{ json: { v: 1 } }] });
  });

  it("lỗi của node ⇒ ok=false kèm thông điệp (không ném); biểu thức hỏng cũng vậy", async () => {
    const r = await chayThuNut({ nut: nut("du-lieu.dat", { truong: { a: "{{ 1 + }}" } }), inputs: { main: [{ json: {} }] } });
    expect(r).toMatchObject({ che: "chay", ok: false });
    expect(r.loi).toBeTruthy();
  });

  it("node tắt ⇒ chuyển item thẳng như động cơ", async () => {
    const r = await chayThuNut({ nut: nut("du-lieu.dat", { truong: { a: 1 } }, { disabled: true }), inputs: { main: [{ json: { k: 1 } }] } });
    expect(r.output).toEqual({ main: [{ json: { k: 1 } }] });
  });

  it("ai.llm dùng hàm AI GIẢ; không có lời gọi model thật", async () => {
    const goi: string[] = [];
    khoiPhucAi = datHamGoiAi(async (y) => {
      goi.push(y.nguoiDung);
      return " xin chào ";
    });
    const r = await chayThuNut({ nut: nut("ai.llm", { loiNhac: "Chào {{ $json.ten }}", truongRa: "out" }), inputs: { main: [{ json: { ten: "An" } }] } });
    expect(goi).toEqual(["Chào An"]);
    expect(r.output).toEqual({ main: [{ json: { ten: "An", out: "xin chào" } }] });
    // Đợt 9 — chạy thử cũng trả model thực dự định chạy của lần gọi AI (không GPU: chỉ định tuyến)
    expect(r.model).toHaveLength(1);
    expect(r.model![0]).toMatchObject({ vaiTro: "chat", duPhong: false, kheBan: false });
    expect(typeof r.model![0].nguon).toBe("string");
  });

  it("ot.doc-tag chỉ ĐỌC qua nguồn tiêm; ot.de-xuat-lenh trả yêu cầu CHỜ DUYỆT mô phỏng, không ghi gì", async () => {
    __datNguonDocTagChoTest(async () => [{ tagKey: "t1", valueNumeric: 7, valueText: null, quality: "good", timestamp: "2026-01-01T00:00:00Z", unit: "C" }]);
    const d = await chayThuNut({ nut: nut("ot.doc-tag", { may: 3, tag: "t1" }), inputs: { main: [{ json: {} }] } }, boKiem(3));
    expect(d.ok).toBe(true);
    expect(JSON.stringify(d.output)).toContain('"giaTri":7');

    const x = await chayThuNut({
      nut: nut("ot.de-xuat-lenh", { may: 3, lenh: "pause" }),
      inputs: { main: [{ json: {} }] },
    }, boKiem(3));
    // Cổng AI cần CSDL cho tra tag/máy; không có ⇒ hoặc chờ duyệt mô phỏng hoặc từ chối — cả hai KHÔNG gửi lệnh.
    expect(["chay"]).toContain(x.che);
    if (x.ok && x.cho) expect(JSON.stringify(x.cho)).toContain("MÔ PHỎNG");
    expect(JSON.stringify(x)).not.toMatch(/"daGui":\s*true/);
  });
});

describe("chayThuNut — PHẠM VI người gọi (IDOR)", () => {
  const doc = (may: unknown) => nut("ot.doc-tag", { may, tag: "t1" });
  let goiNguon = 0;
  const dem = () => __datNguonDocTagChoTest(async () => (goiNguon++, [{ tagKey: "t1", valueNumeric: 1, valueText: null, quality: "good", timestamp: "2026-01-01T00:00:00Z", unit: null }]));

  it("máy ngoài phạm vi ⇒ LoiNgoaiPhamVi và nguồn telemetry KHÔNG được gọi; máy trong phạm vi ⇒ đọc được", async () => {
    goiNguon = 0;
    dem();
    await expect(chayThuNut({ nut: doc(7), inputs: { main: [{ json: {} }] } }, boKiem(3))).rejects.toBeInstanceOf(LoiNgoaiPhamVi);
    expect(goiNguon).toBe(0);
    const ok = await chayThuNut({ nut: doc(3), inputs: { main: [{ json: {} }] } }, boKiem(3));
    expect(ok.ok).toBe(true);
    expect(goiNguon).toBe(1);
  });

  it("id lấy từ BIỂU THỨC theo TỪNG item: một item trỏ máy lạ ⇒ cả lượt bị từ chối, nguồn không bị gọi", async () => {
    goiNguon = 0;
    dem();
    const bk = boKiem(3);
    await expect(chayThuNut({ nut: doc("{{ $json.m }}"), inputs: { main: [{ json: { m: 3 } }, { json: { m: 9 } }] } }, bk)).rejects.toBeInstanceOf(LoiNgoaiPhamVi);
    expect(goiNguon).toBe(0);
    expect(bk.hoi).toEqual([3, 9]);
  });

  it("thiếu bộ kiểm ⇒ ĐÓNG: xem trước, nguồn không bị gọi", async () => {
    goiNguon = 0;
    dem();
    const r = await chayThuNut({ nut: doc(3), inputs: { main: [{ json: {} }] } });
    expect(r.che).toBe("xem-truoc");
    expect(goiNguon).toBe(0);
  });

  it("đề xuất lệnh: máy ngoài phạm vi ⇒ từ chối (không rò qua câu lý do của cổng OT)", async () => {
    await expect(chayThuNut({ nut: nut("ot.de-xuat-lenh", { may: 7, lenh: "pause" }), inputs: { main: [{ json: {} }] } }, boKiem(3))).rejects.toBeInstanceOf(LoiNgoaiPhamVi);
  });

  it("★ id dạng CHUỖI SỐ (chuỗi 999) bị kiểm y như số: máy ngoài phạm vi ⇒ LoiNgoaiPhamVi, nguồn không bị gọi; máy trong phạm vi ⇒ đọc đúng máy đó", async () => {
    goiNguon = 0;
    const doc9 = vi.fn(async (_y: unknown) => []);
    __datNguonDocTagChoTest(async (y) => (goiNguon++, doc9(y)));
    const bk = boKiem(3);
    await expect(chayThuNut({ nut: doc("999"), inputs: { main: [{ json: {} }] } }, bk)).rejects.toBeInstanceOf(LoiNgoaiPhamVi);
    await expect(chayThuNut({ nut: doc("{{ $json.m }}"), inputs: { main: [{ json: { m: "999" } }] } }, bk)).rejects.toBeInstanceOf(LoiNgoaiPhamVi);
    expect(goiNguon).toBe(0);
    expect(bk.hoi).toEqual([999, 999]);
    const ok = await chayThuNut({ nut: doc("3"), inputs: { main: [{ json: {} }] } }, boKiem(3));
    expect(ok.ok).toBe(true);
    expect(doc9).toHaveBeenCalledWith(expect.objectContaining({ machineId: 3 })); // giá trị đã kiểm = giá trị đã dùng
    await expect(chayThuNut({ nut: nut("ot.de-xuat-lenh", { may: "999", lenh: "pause" }), inputs: { main: [{ json: {} }] } }, boKiem(3))).rejects.toBeInstanceOf(LoiNgoaiPhamVi);
  });

  it("★ id KHÔNG hợp lệ (khoảng trắng, mũ, hex, âm, thập phân, null, mảng, đối tượng, rỗng, 0, quá dài): không bao giờ đọc máy, không hỏi bộ kiểm", async () => {
    for (const xau of [" 999", "999 ", "9e2", "0x3E7", -1, 0, 1.5, null, undefined, [], [3], {}, { may: 3 }, "", "٣", "1234567890123", 1e21, true, "3.0", "+3", "-3"]) {
      goiNguon = 0;
      dem();
      const bk = boKiem(3, 999);
      const r = await chayThuNut({ nut: doc(xau), inputs: { main: [{ json: {} }] } }, bk);
      expect(r.ok, JSON.stringify(xau)).toBe(false);
      expect(goiNguon, JSON.stringify(xau)).toBe(0);
      expect(bk.hoi, JSON.stringify(xau)).toEqual([]);
    }
  });

  it("★ ot.de-xuat-lenh với máy là CHUỖI SỐ \"3\" trong phạm vi ⇒ đề xuất mô phỏng được tạo với may = 3 KIỂU SỐ (kiểm = dùng); dạng lạ ⇒ từ chối theo hình dạng", async () => {
    const bk = boKiem(3);
    const r = await chayThuNut({ nut: nut("ot.de-xuat-lenh", { may: "3", lenh: "pause" }), inputs: { main: [{ json: {} }] } }, bk);
    expect(r.ok).toBe(true);
    expect(bk.hoi).toEqual([3]);
    const dx = (r.cho?.payload as { deXuat?: { may?: unknown } } | undefined)?.deXuat;
    expect(dx?.may).toBe(3);
    for (const xau of [" 3", "3e0", "0x3", null, [3], {}]) {
      const bk2 = boKiem(3);
      const x = await chayThuNut({ nut: nut("ot.de-xuat-lenh", { may: xau, lenh: "pause" }), inputs: { main: [{ json: {} }] } }, bk2);
      expect(x.ok, JSON.stringify(xau)).toBe(false);
      expect(x.loi).toMatch(/tu-choi-muc-cao/);
      expect(bk2.hoi).toEqual([]);
    }
  });

  it("danh sách item RỖNG: node không đọc gì (tham số tĩnh vẫn không chạm máy)", async () => {
    goiNguon = 0;
    dem();
    const bk = boKiem();
    const r = await chayThuNut({ nut: doc(7), inputs: { main: [] } }, bk);
    expect(r.ok).toBe(true);
    expect(goiNguon).toBe(0);
    expect(bk.hoi).toEqual([]);
  });

  it("chuanHoaIdMay: bảng chuẩn", () => {
    expect([3, "3", "0003", 2147483647, "2147483647"].map(chuanHoaIdMay)).toEqual([3, 3, 3, 2147483647, 2147483647]);
    for (const xau of [0, -1, 1.5, NaN, Infinity, 2147483648, "2147483648", " 3", "3 ", "3e0", "0x3", "", null, undefined, [], {}, true, "٣"]) expect(chuanHoaIdMay(xau), String(xau)).toBeNull();
  });

  it("ot.de-xuat-luong: xem trước kể cả khi CÓ bộ kiểm (FOE workflow chưa có bộ kiểm phạm vi)", async () => {
    const r = await chayThuNut({ nut: nut("ot.de-xuat-luong", { workflowId: 1, version: 1 }), inputs: { main: [{ json: {} }] } }, boKiem(1));
    expect(r.che).toBe("xem-truoc");
  });

  it("id không phải số nguyên dương ⇒ không hỏi bộ kiểm, node tự báo lỗi hình dạng", async () => {
    const bk = boKiem();
    const r = await chayThuNut({ nut: doc("abc"), inputs: { main: [{ json: {} }] } }, bk);
    expect(bk.hoi).toEqual([]);
    expect(r.ok).toBe(false);
  });
});

describe("chayThuNut — census: node CHAY đọc tài nguyên PHẢI khai bộ kiểm phạm vi", () => {
  it("∀ node CHAY: hạng doc/ot ⇒ có trong THAM_CHIEU_TAI_NGUYEN; còn lại ⇒ khai tường minh KHÔNG tham chiếu; không node nào ở cả hai", () => {
    const loai = danhSachNut();
    for (const t of NUT_CHAY_THAT) {
      const k = loai.find((x) => x.type === t)!;
      const coKhai = t in THAM_CHIEU_TAI_NGUYEN;
      const khongThamChieu = NUT_KHONG_THAM_CHIEU.has(t);
      expect(Number(coKhai) + Number(khongThamChieu), `${t}: phải khai THAM_CHIEU_TAI_NGUYEN hoặc NUT_KHONG_THAM_CHIEU (đúng một)`).toBe(1);
      if (k.tacDungPhu === "doc" || k.tacDungPhu === "ot") expect(coKhai, `${t} hạng ${k.tacDungPhu} đọc tài nguyên ⇒ phải có bộ kiểm`).toBe(true);
    }
    for (const t of [...Object.keys(THAM_CHIEU_TAI_NGUYEN), ...NUT_KHONG_THAM_CHIEU]) expect(NUT_CHAY_THAT.has(t), `${t} khai nhưng không thuộc CHAY`).toBe(true);
  });

  it("nguồn ot.ts: mọi tham số trỏ id tài nguyên đã khai (may) — node ot.* chạy thật mà thiếu khai ⇒ đỏ", async () => {
    const { readFileSync } = await import("node:fs");
    const goc = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(goc, "nut/ot.ts"), "utf8");
    // mỗi node ot.* đọc `t.may`; THAM_CHIEU phải có đủ các node ấy (trừ node xem trước)
    const cacNutOt = [...src.matchAll(/type: "(ot.[a-z-]+)"/g)].map((m) => m[1]);
    for (const t of cacNutOt) expect(t in THAM_CHIEU_TAI_NGUYEN || NUT_XEM_TRUOC.has(t), `${t} chưa khai phạm vi`).toBe(true);
  });
});

describe("chayThuNut — nhóm XEM TRƯỚC (không chạy)", () => {
  it("HTTP: chỉ đánh giá tham số, không gọi mạng, không giải mã credentialRef", async () => {
    const dich = globalThis.fetch;
    let goiMang = 0;
    globalThis.fetch = (async () => {
      goiMang++;
      return new Response("{}");
    }) as typeof fetch;
    try {
      const r = await chayThuNut({
        nut: nut("tich-hop.http-gui", { url: "https://x.example/{{ $json.id }}", than: "{{ $json.id }}" }, { credentialRef: "khoa-erp" }),
        inputs: { main: [{ json: { id: "A7" } }] },
      });
      expect(goiMang).toBe(0);
      expect(r).toMatchObject({ che: "xem-truoc", ok: true });
      expect(r.output).toBeUndefined();
      expect(r.thamSoDaDanhGia).toMatchObject({ url: "https://x.example/A7", than: "A7" });
      expect(r.credentialRef).toBe("khoa-erp");
    } finally {
      globalThis.fetch = dich;
    }
  });

  it("nguoi.duyet / du-lieu.ma / ai.sinh-ma: xem trước, không chạy", async () => {
    for (const t of ["nguoi.duyet", "du-lieu.ma", "ai.sinh-ma"]) {
      const r = await chayThuNut({ nut: nut(t, { tieuDe: "{{ $json.a }}" }), inputs: { main: [{ json: { a: "z" } }] } });
      expect(r.che, t).toBe("xem-truoc");
    }
  });

  it("loại lạ chưa phân loại ⇒ xem trước (fail-safe), loại chưa đăng ký ⇒ lỗi rõ", async () => {
    const lac = await chayThuNut({ nut: nut("khong.co"), inputs: { main: [{ json: {} }] } });
    expect(lac).toMatchObject({ ok: false });
    expect(lac.loi).toMatch(/chưa đăng ký/);
  });
});

describe("chayThuNut — bất biến (census)", () => {
  it("∀ node trong SỔ ĐĂNG KÝ thuộc đúng MỘT tập; tập CHAY không có node nhận bí mật / ngoài-ghi", () => {
    const loai = danhSachNut();
    for (const k of loai) {
      const o = Number(NUT_CHAY_THAT.has(k.type)) + Number(NUT_XEM_TRUOC.has(k.type));
      expect(o, `node '${k.type}' phải được phân loại chạy-thử (CHAY hoặc XEM_TRUOC) trong chayThuNut.ts`).toBe(1);
    }
    for (const t of NUT_CHAY_THAT) {
      const k = loai.find((x) => x.type === t);
      expect(k, `${t} không còn trong sổ đăng ký`).toBeTruthy();
      expect(k!.nhanBiMat ?? false, `${t} nhận bí mật`).toBe(false);
      expect(["thuan", "doc", "ot"]).toContain(k!.tacDungPhu); // "ngoai-ghi" không bao giờ chạy thử
    }
    for (const t of NUT_XEM_TRUOC) expect(loai.some((x) => x.type === t), `${t} không còn trong sổ đăng ký`).toBe(true);
  });

  it("nguồn chayThuNut.ts: không import dongCo / CSDL / biMat giải mã / dispatcher; không fetch", () => {
    const goc = resolve(dirname(fileURLToPath(import.meta.url)));
    const s = readFileSync(resolve(goc, "chayThuNut.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const cam of [/from\s+["'][^"']*dongCo["']/, /from\s+["'][^"']*db\/connection["']/, /giaiMaChoChay/, /\bgetDb\b/, /\bfetch\s*\(/, /commandDispatcher|foeEngine|robotCommandDispatcher/, /ai_flow_(runs|steps|queue|events|waits)/i]) {
      expect(cam.test(s), String(cam)).toBe(false);
    }
  });
});
