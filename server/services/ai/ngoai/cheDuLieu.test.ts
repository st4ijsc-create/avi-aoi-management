import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  __xoaDemTuDien,
  chuanHoaDeKhop,
  cheChuoi,
  cheGiaTri,
  cheSchemaTool,
  cheChuoiLienDai,
  laTenKhoaNhay,
  layTuDienNhay,
  THAY,
  TU_DIEN_RONG,
  type TuDienNhay,
} from "./cheDuLieu";
import { VECTOR_CHE, type VectorChe } from "./vectorChe";
import { HO_XAU } from "./hoXau";

function tuDienCua(v: VectorChe): TuDienNhay {
  if (!v.tuDien) return TU_DIEN_RONG;
  return {
    tenNguoiDung: new Set(v.tuDien.nguoiDung ?? []),
    tenKhach: new Set(v.tuDien.khach ?? []),
    tenNhaMay: new Set(v.tuDien.nhaMay ?? []),
  };
}

function chay(v: VectorChe) {
  const tu = tuDienCua(v);
  return v.cheDo === "schema" ? cheSchemaTool(v.dauVao, tu) : cheGiaTri(v.dauVao, tu);
}

/** Vector thất bại dưới một bộ che cho trước (dùng cho cả bộ thật lẫn bộ "không che"). */
function thatBai(v: VectorChe, ra: string): boolean {
  return v.phaiKhongCon.some((s) => ra.includes(s)) || (v.phaiConLai ?? []).some((s) => !ra.includes(s));
}

describe("cheDuLieu — vector dùng chung", () => {
  for (const v of VECTOR_CHE) {
    it(v.ten, () => {
      const kq = chay(v);
      const ra = JSON.stringify(kq.giaTri);
      for (const s of v.phaiKhongCon) expect(ra, `còn "${s}"`).not.toContain(s);
      for (const s of v.phaiConLai ?? []) expect(ra, `mất "${s}"`).toContain(s);
      if (v.phaiKhongCon.length > 0) expect(kq.soTruongDaChe).toBeGreaterThan(0);
      else expect(kq.soTruongDaChe).toBe(0);
    });
  }

  it("đột biến 'không che' (bộ che trả nguyên văn) làm đỏ ≥ 10 vector — vector có răng", () => {
    const do_ = VECTOR_CHE.filter((v) => thatBai(v, JSON.stringify(v.dauVao)));
    expect(do_.length).toBeGreaterThanOrEqual(10);
  });

  it("giữ KIỂU trường giao thức / số liệu", () => {
    const kq = cheGiaTri({ maxTokens: 512, passRate: 0.97, passed: true, tokenCount: 3 }).giaTri as Record<string, unknown>;
    expect(typeof kq.maxTokens).toBe("number");
    expect(kq.passRate).toBe(0.97);
    expect(kq.passed).toBe(true);
    expect(kq.tokenCount).toBe(3);
  });

  it("khoá nhạy mang số/bool ⇒ null (không đổi kiểu sang chuỗi); token trong KẾT QUẢ TOOL bị che", () => {
    const kq = cheGiaTri({ pin: 1, password: 1234, token: "x", ketQua: { token: "abc-tool-secret" } }).giaTri as Record<string, unknown>;
    expect(kq.password).toBeNull();
    expect(kq.token).toBe("[REDACTED_SECRET]");
    expect(JSON.stringify(kq)).not.toContain("abc-tool-secret");
    expect(kq.pin).toBe(1);
  });
});

describe("cheGiaTri — __proto__ (rà kiem-dinh G)", () => {
  it("khoá `__proto__` từ JSON.parse: không rò, không ô nhiễm prototype, giữ là thuộc tính riêng đã che", () => {
    const vao = JSON.parse('{"__proto__":{"password":"proto-secret-1"},"ok":1}');
    const kq = cheGiaTri(vao).giaTri as Record<string, unknown>;
    expect(JSON.stringify(kq)).not.toContain("proto-secret-1");
    expect(Object.getPrototypeOf(kq)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).password).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(kq, "__proto__")).toBe(true);
    expect(kq.ok).toBe(1);
  });
});

describe("thời gian TUYẾN TÍNH với đầu vào xấu (rà kiem-dinh F — ReDoS, cùng tiến trình với đường STOP)", () => {
  const HO = HO_XAU;
  const doMs = (s: string) => {
    const t0 = performance.now();
    cheChuoi(s);
    return performance.now() - t0;
  };
  // ★ 2026-11-14 (do-model, chu-du-an-HST quyết 13/11) — thay ca cũ "20k lần < 200 ms và t(2n)/t(n) < 3":
  //   · ngưỡng tuyệt đối 200 ms đỏ chập chờn khi máy tải (4 bản song song);
  //   · ca cũ cũng MÙ: đột biến bậc hai sống 4/25 họ (tỉ lệ ~3 lọt ngưỡng, hoặc t2 ≤ 20 ms nên miễn kiểm tỉ lệ).
  // Bản mới: tăng n tới khi t(n) ≥ 5 ms (thoát vùng chuỗi nhỏ cho tỉ lệ siêu tuyến tính giả), rồi so n→4n; tỉ lệ < 6 ⇒ đạt ngay;
  // ≥ 6 (tải hoặc bậc hai) ⇒ đo thêm 8n: tuyến tính ≈ 8, bậc hai ≈ 64 ⇒ ngưỡng 16 tách được cả dưới tải. Trung vị 5 mẫu mỗi điểm.
  // 8n tới ~10M ký tự chỉ đo được sau khi bỏ regex `(?<!\S)\S{8000,}` (tràn ngăn xếp ở ~5,6M, xem cheChuoiLienDai).
  const SO_MAU = 5;
  const SAN_MS = 5;
  const N_TRAN = 1_280_000;
  const trungViMs = (s: string) => {
    const xs = Array.from({ length: SO_MAU }, () => doMs(s)).sort((a, b) => a - b);
    return xs[(SO_MAU - 1) / 2]!;
  };
  it.each(HO)("%s: 20k lần < 2000 ms (chặn thô) và tăng tuyến tính n→4n→8n (trung vị 5 mẫu)", (_ten, sinh) => {
    doMs(sinh(1000)); // làm nóng JIT
    expect(trungViMs(sinh(20_000))).toBeLessThan(2000);
    let n = 10_000;
    let t1 = trungViMs(sinh(n));
    while (t1 < SAN_MS && n < N_TRAN) {
      n *= 2;
      t1 = trungViMs(sinh(n));
    }
    const t4 = trungViMs(sinh(4 * n));
    if (t4 / Math.max(t1, 1) < 6) return;
    expect(t4).toBeLessThan(4000);
    const t8 = trungViMs(sinh(8 * n));
    expect(t8 / Math.max(t1, 1)).toBeLessThan(16);
  }, 120_000);
});

describe("laTenKhoaNhay — neo theo đoạn + ngoại lệ", () => {
  it.each([
    "password", "DB_PASSWORD", "MYSQL_PWD", "AWS_SECRET_ACCESS_KEY", "x-api-key", "apiKey", "Api_Key", "APIKey",
    "client_secret", "accessToken", "sessionId", "Authorization", "cookie", "pаssword", "ｐａｓｓｗｏｒｄ",
  ])("nhạy: %s", (t) => expect(laTenKhoaNhay(t)).toBe(true));
  it.each([
    "maxTokens", "tokenCount", "tokensOut", "tokenizer", "passed", "passRate", "password_policy_min_length",
    "tokenType", "sessionTimeout", "secretName", "status", "name", "pass", "keyboard", "compass",
  ])("không nhạy: %s", (t) => expect(laTenKhoaNhay(t)).toBe(false));
});

describe("cheChuoi — văn bản", () => {
  it("chuẩn hoá bỏ ký tự vô hình", () => {
    expect(chuanHoaDeKhop("a​b‮c﻿d")).toBe("abcd");
  });

  it("chữ Nga thuần (không trộn Latin, không thành từ khoá) giữ nguyên", () => {
    expect(cheChuoi("Привет мир").giaTri).toBe("Привет мир");
  });

  it("giá trị dạng biểu thức mã giữ nguyên; giá trị chữ bị che", () => {
    expect(cheChuoi("token = process.env.TOKEN").giaTri).toContain("process.env.TOKEN");
    expect(cheChuoi("secret: abcd1234").giaTri).not.toContain("abcd1234");
  });

  it("so sánh `==` trong mã không bị coi là gán", () => {
    expect(cheChuoi("if (token == null) return;").giaTri).toBe("if (token == null) return;");
  });

  it("hiệu năng: từ điển 5 000 tên + văn bản 200 KB < 200 ms", () => {
    const ten = Array.from({ length: 5000 }, (_, i) => `Khach Hang Mau ${i} Co`);
    const tu: TuDienNhay = { tenNguoiDung: new Set(), tenKhach: new Set(ten), tenNhaMay: new Set() };
    const vb = "Dây chuyền 3 báo lỗi cho Khach Hang Mau 4321 Co lúc 8h, tốc độ 120 sp/phút. ".repeat(2700);
    expect(vb.length).toBeGreaterThan(200_000);
    cheChuoi("khởi động", tu); // dựng chỉ mục (đệm theo đối tượng từ điển)
    const t0 = performance.now();
    const kq = cheChuoi(vb, tu);
    const ms = performance.now() - t0;
    expect(kq.giaTri).not.toContain("Khach Hang Mau 4321 Co");
    expect(ms).toBeLessThan(200);
  });
});

describe("layTuDienNhay — đệm 5 phút", () => {
  it("đọc một lần trong 5 phút, đọc lại sau 5 phút; lỗi đọc ⇒ ném", async () => {
    __xoaDemTuDien();
    let lan = 0;
    const nguon = { docTen: async () => (lan++, { nguoiDung: ["nguyen van a"], khach: [], nhaMay: [] }) };
    await layTuDienNhay(nguon, 1_000);
    await layTuDienNhay(nguon, 1_000 + 299_999);
    expect(lan).toBe(1);
    await layTuDienNhay(nguon, 1_000 + 300_000);
    expect(lan).toBe(2);
    __xoaDemTuDien();
    await expect(layTuDienNhay({ docTen: async () => Promise.reject(new Error("db")) }, 1)).rejects.toThrow();
    __xoaDemTuDien();
  });
});

describe("chuỗi liền dài (dieu-phoi c + rà kiem-dinh, 2026-10-26): ≥ 2 000 ký tự bảng base64/hex ⇒ che; ≥ 8 000 bất kỳ ⇒ che; JSON / log gọn giữ", () => {
  const ngauNhien = (n: number, bang: string) => {
    const b = randomBytes(n);
    let s = "";
    for (let i = 0; i < n; i++) s += bang[b[i]! % bang.length];
    return s;
  };
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  it.each([
    ["base64 3 KB", () => randomBytes(2250).toString("base64")],
    ["base64 6 KB", () => randomBytes(4500).toString("base64")],
    ["base64url 3 KB", () => randomBytes(2250).toString("base64url")],
    ["hex 5 KB", () => randomBytes(2500).toString("hex")],
    ["bảng base64 không đệm 2 001", () => ngauNhien(2001, B64)],
  ])("%s (sinh lúc chạy, không nhãn) ⇒ che NGUYÊN khối", (_ten, sinh) => {
    const khoi = sinh();
    expect(khoi.length).toBeGreaterThanOrEqual(2000);
    const k = cheChuoi(`dán vào đây:\n${khoi}\nhết`);
    expect(k.theoLoai).toHaveProperty("chuoi_lien_dai");
    expect(k.giaTri).not.toContain(khoi.slice(100, 140));
    expect(k.giaTri).toContain("dán vào đây");
  });

  it("JSON gọn 3,6 KB (trong văn) + log JSON gọn KHÔNG đóng 2,4 KB ⇒ GIỮ dữ liệu kỹ thuật", () => {
    const json = JSON.stringify({ may: "M-07", mau: Array.from({ length: 360 }, (_, i) => ({ i, v: 200 + (i % 9) })) });
    expect(json.length).toBeGreaterThan(3500);
    const k1 = cheChuoi(`ket qua: ${json}`);
    expect(k1.giaTri).toContain('"v":201');
    expect(k1.theoLoai).not.toHaveProperty("chuoi_lien_dai");
    const log = `log:{"may":"M-07","nhietDo":[${Array.from({ length: 600 }, (_, i) => 200 + (i % 7)).join(",")}],"trangThai":"chay"`;
    expect(log.length).toBeGreaterThan(2000);
    const k2 = cheChuoi(log);
    expect(k2.giaTri).toContain('"nhietDo":[200,201');
    expect(k2.theoLoai).not.toHaveProperty("chuoi_lien_dai");
  });

  it("≥ 8 000 ký tự liền BẤT KỲ (không phải bảng base64) vẫn che; < 2 000 bảng base64 giữ", () => {
    const k = cheChuoi(`x ${"a.b,".repeat(2100)} y`);
    expect(k.theoLoai).toHaveProperty("chuoi_lien_dai");
    const ngan = randomBytes(1000).toString("hex");
    const ngan2 = ngan.slice(0, 1990);
    expect(cheChuoi(`id ${ngan2}`).theoLoai).not.toHaveProperty("chuoi_lien_dai");
  });
});

describe("cheChuoiLienDai — quét tuyến tính thay regex `(?<!\\S)\\S{8000,}` (V8 tràn ngăn xếp quay lui ở chuỗi liền ≥ ~5,6M ký tự)", () => {
  // Bản THAM CHIẾU: đúng regex cũ, chỉ đổi ngưỡng. Quét mới phải cho cùng chuỗi ra và cùng số lần đếm ở mọi đầu vào nhỏ hơn mức tràn.
  const thamChieu = (s: string, nguong: number) => {
    let n = 0;
    const ra = s.replace(new RegExp(`(?<!\\S)\\S{${nguong},}`, "g"), () => (n++, THAY.biMat));
    return { ra, n };
  };
  const quet = (s: string, nguong?: number) => {
    let n = 0;
    const ra = cheChuoiLienDai(s, (loai) => {
      expect(loai).toBe("chuoi_lien_dai");
      n++;
    }, nguong);
    return { ra, n };
  };
  // mulberry32 — hạt cố định để ca đỏ tái lập được.
  const prng = (hat: number) => () => {
    hat = (hat + 0x6d2b79f5) | 0;
    let t = Math.imul(hat ^ (hat >>> 15), 1 | hat);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  it("tập khoảng trắng = đúng `\\s` của JS: quét MỌI đơn vị mã 0..0xFFFF (ngưỡng 3) — 25 đơn vị là khoảng trắng", () => {
    const s = Array.from({ length: 0x10000 }, (_, c) => `x${String.fromCharCode(c)}x`).join(" ");
    const moi = quet(s, 3);
    const cu = thamChieu(s, 3);
    expect(moi.ra).toBe(cu.ra);
    expect(moi.n).toBe(cu.n);
    // \t \n \v \f \r, dấu cách, U+00A0, U+1680, U+2000–U+200A (11), U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF ⇒ 25.
    expect(moi.n).toBe(0x10000 - 25);
  });

  it("biên 7 999 / 8 000 / 8 001, đầu/cuối chuỗi, sau khoảng trắng Unicode, cặp thay thế, nhiều khối", () => {
    const a = (n: number) => "a".repeat(n);
    expect(quet(a(7999))).toEqual({ ra: a(7999), n: 0 });
    expect(quet(a(8000))).toEqual({ ra: THAY.biMat, n: 1 });
    expect(quet(a(8001))).toEqual({ ra: THAY.biMat, n: 1 });
    expect(quet(` ${a(8000)}\n`)).toEqual({ ra: ` ${THAY.biMat}\n`, n: 1 });
    expect(quet(`x　${a(8000)}`)).toEqual({ ra: `x　${THAY.biMat}`, n: 1 });
    // U+180E KHÔNG còn là khoảng trắng (Unicode ≥ 6.3) ⇒ dính vào khối: 8 002 ký tự liền ⇒ che cả khối, kể cả "x".
    expect(quet(`x᠎${a(8000)}`)).toEqual({ ra: THAY.biMat, n: 1 });
    expect(quet(`${a(9000)} ${"B".repeat(9000)}\t${a(10)}`)).toEqual({ ra: `${THAY.biMat} ${THAY.biMat}\t${a(10)}`, n: 2 });
    // 😀 = 2 đơn vị mã: 4 000 cái = 8 000 đơn vị ⇒ che; 3 999 cái + "a" = 7 999 ⇒ giữ.
    expect(quet("😀".repeat(4000)).n).toBe(1);
    expect(quet(`${"😀".repeat(3999)}a`).n).toBe(0);
    expect(quet("")).toEqual({ ra: "", n: 0 });
    expect(quet(" \n\t")).toEqual({ ra: " \n\t", n: 0 });
  });

  it("vi sai hạt cố định với regex cũ: 200 chuỗi trộn khối quanh ngưỡng + khoảng trắng Unicode, ngưỡng 8 000 và ngưỡng nhỏ", () => {
    const r = prng(0x13_11_2026);
    const TRANG = [" ", "\n", "\t", "\r\n", " ", " ", "　", "﻿", " ", " "];
    const CHU = ["a", "Z", "9", "+", "/", "=", ".", "{", "᠎", "đ", "😀", "​"];
    const chon = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
    let soCa = 0;
    let soChe = 0;
    for (const nguong of [8000, 5, 1]) {
      for (let ca = 0; ca < (nguong === 8000 ? 120 : 40); ca++) {
        const doDai = nguong === 8000 ? [0, 1, 7998, 7999, 8000, 8001, 8002, 16_000] : [0, 1, nguong - 1, nguong, nguong + 1, 30];
        let s = r() < 0.5 ? chon(TRANG) : "";
        const soKhoi = 1 + Math.floor(r() * 5);
        for (let k = 0; k < soKhoi; k++) {
          const dai = r() < 0.7 ? chon(doDai) : Math.floor(r() * 2 * nguong);
          let khoi = "";
          while (khoi.length < dai) khoi += chon(CHU);
          s += khoi + (k < soKhoi - 1 || r() < 0.5 ? chon(TRANG).repeat(1 + Math.floor(r() * 3)) : "");
        }
        const moi = quet(s, nguong);
        const cu = thamChieu(s, nguong);
        expect(moi.ra, `ngưỡng ${nguong} ca ${ca}`).toBe(cu.ra);
        expect(moi.n, `ngưỡng ${nguong} ca ${ca}`).toBe(cu.n);
        soCa++;
        soChe += moi.n;
      }
    }
    expect(soCa).toBe(200);
    // Bộ sinh phải thật sự tạo cả ca che lẫn ca giữ, nếu không vi sai mù.
    expect(soChe).toBeGreaterThan(50);
  });

  it("6M và 20M ký tự liền qua cheChuoi: không ném, che đúng, giữ phần ngoài khối", () => {
    for (const n of [6_000_000, 20_000_000]) {
      const k = cheChuoi("a".repeat(n));
      expect(k.giaTri).toBe(THAY.biMat);
      expect(k.theoLoai.chuoi_lien_dai).toBe(1);
      const k2 = cheChuoi(`dau ${"Z".repeat(n)} cuoi`);
      expect(k2.giaTri).toBe(`dau ${THAY.biMat} cuoi`);
      expect(k2.theoLoai.chuoi_lien_dai).toBe(1);
    }
  }, 60_000);

  it("thời gian tuyến tính: t(8n)/t(n) < 16 với n = 2,5M (tuyến tính ≈ 8, bậc hai ≈ 64), trung vị 5 mẫu", () => {
    const doMs = (s: string) => {
      const t0 = performance.now();
      cheChuoiLienDai(s, () => {});
      return performance.now() - t0;
    };
    const trungVi = (s: string) => {
      const xs = Array.from({ length: 5 }, () => doMs(s)).sort((x, y) => x - y);
      return xs[2]!;
    };
    const sinh = (n: number) => `${"a ".repeat(n / 8)}${"b".repeat((3 * n) / 4)}`;
    trungVi(sinh(100_000));
    const t1 = trungVi(sinh(2_500_000));
    const t8 = trungVi(sinh(20_000_000));
    expect(t8 / Math.max(t1, 1)).toBeLessThan(16);
  }, 60_000);
});

describe("rà kiem-dinh lần 2 — ba cách né khối 2–8 KB (BẮT BUỘC trước khi bật AI_NGOAI_ENABLED)", () => {
  const b64 = (byte: number) => randomBytes(byte).toString("base64");
  it.each([
    ["(a) x:<b64 3 KB>", () => `x:${b64(2250)}`],
    ["(a) <b64 3 KB>.", () => `${b64(2250)}.`],
    ["(a) (<b64 3 KB>)", () => `(${b64(2250)})`],
    ["(a) khoa=<hex 5 KB>;", () => `khoa=${randomBytes(2500).toString("hex")};`],
  ])("%s ⇒ che", (_ten, sinh) => {
    const s = sinh();
    const k = cheChuoi(`dán: ${s} hết`);
    expect(k.theoLoai).toHaveProperty("chuoi_lien_dai");
    expect(k.giaTri).not.toContain(s.slice(200, 240));
    expect(k.giaTri).toContain("hết");
  });

  it("(b) PEM / MIME KHÔNG nhãn: 64 và 76 ký tự mỗi dòng, ≥ 12 dòng ⇒ che cả khối (cả dòng đuôi ngắn); 11 dòng ⇒ giữ", () => {
    for (const rong of [64, 76]) {
      const tho = b64(1500);
      const dong = tho.match(new RegExp(`.{1,${rong}}`, "g"))!;
      expect(dong.length).toBeGreaterThanOrEqual(13);
      const k = cheChuoi(["dữ liệu:", ...dong, "hết"].join("\n"));
      expect(k.theoLoai).toHaveProperty("chuoi_lien_dai");
      for (const d of [dong[0]!, dong[5]!, dong[dong.length - 1]!]) expect(k.giaTri).not.toContain(d);
      expect(k.giaTri).toContain("hết");
    }
    const ngan = b64(600).match(/.{1,64}/g)!.slice(0, 11);
    expect(cheChuoi([...ngan, "x"].join("\n")).theoLoai).not.toHaveProperty("chuoi_lien_dai");
    const muoiHai = b64(600).match(/.{1,64}/g)!.slice(0, 12); // biên: đúng 12 dòng ⇒ che
    expect(cheChuoi([...muoiHai, "x"].join("\n")).theoLoai).toHaveProperty("chuoi_lien_dai");
  });

  it("(c) hex ngăn ':' / khoảng trắng ≥ 900 cặp ⇒ che; 899 cặp ⇒ giữ", () => {
    for (const ngan of [":", " "]) {
      const hex = [...randomBytes(1200)].map((x) => x.toString(16).padStart(2, "0")).join(ngan);
      const k = cheChuoi(`dump ${hex} end`);
      expect(k.theoLoai, ngan).toHaveProperty("chuoi_lien_dai");
      expect(k.giaTri).not.toContain(hex.slice(300, 360));
      expect(k.giaTri).toContain("end");
    }
    const it899 = [...randomBytes(899)].map((x) => x.toString(16).padStart(2, "0")).join(":");
    expect(cheChuoi(`fp ${it899} .`).theoLoai).not.toHaveProperty("chuoi_lien_dai");
  });

  it("đối chứng: JSON gọn 3,6 KB + log gọn 2,4 KB vẫn GIỮ", () => {
    const json = JSON.stringify({ may: "M-07", mau: Array.from({ length: 360 }, (_, i) => ({ i, v: 200 + (i % 9) })) });
    expect(cheChuoi(`ket qua: ${json}`).giaTri).toContain('"v":201');
    const log = `log:{"may":"M-07","nhietDo":[${Array.from({ length: 600 }, (_, i) => 200 + (i % 7)).join(",")}],"trangThai":"chay"`;
    expect(cheChuoi(log).giaTri).toContain('"nhietDo":[200,201');
  });
});
