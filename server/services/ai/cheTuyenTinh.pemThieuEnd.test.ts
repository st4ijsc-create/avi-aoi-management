/**
 * (HST 16/11) PEM "BEGIN … PRIVATE KEY" THIẾU END ở đường chung: che header + THÂN liền sau; header trơ giữ nguyên từng byte.
 * Mọi "khoá" ở đây là base64 GIẢ sinh tất định (không phải khoá thật).
 * ĐỘT BIẾN PHẢI ĐỎ: "che tới hết văn bản" · "bỏ trần" · "che header trơ" · "không che khi thiếu END" · "bỏ luật dừng ở dòng không thuộc thân".
 */
import { describe, expect, it } from "vitest";
import { chePem, chePemDayDu, chePemThieuEnd, TRAN_DONG_THAN_PEM, TRAN_KY_TU_THAN_PEM } from "./cheTuyenTinh";

const T = "[REDACTED_SECRET]";
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** Dòng base64 giả tất định, dài `dai`. */
function dongGia(seed: number, dai = 64): string {
  let x = seed * 2654435761 + 1;
  let s = "";
  for (let i = 0; i < dai; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    s += B64[x % 64];
  }
  return s;
}
const than = (soDong: number, dai = 64) => Array.from({ length: soDong }, (_, i) => dongGia(i + 1, dai));
const DAU = "-----BEGIN RSA PRIVATE KEY-----";
const CUOI = "-----END RSA PRIVATE KEY-----";

describe("chePemThieuEnd — che thân liền sau header", () => {
  it("nhiều dòng, không END ⇒ che header + thân; chữ trước và dòng thường sau thân GIỮ", () => {
    const t = ["trước", DAU, ...than(20), "dòng thường sau thân", "hết"].join("\n");
    const r = chePemDayDu(t, T);
    expect(r.text).toBe(["trước", T, "dòng thường sau thân", "hết"].join("\n"));
    expect(r.n).toBe(1);
    for (const d of than(20)) expect(r.text).not.toContain(d);
  });
  it("văn bản bị cắt giữa thân (hết văn bản giữa dòng) ⇒ che tới hết phần thân có mặt", () => {
    const t = ["x", DAU, ...than(10), dongGia(99, 30)].join("\n");
    expect(chePemDayDu(t, T).text).toBe(["x", T].join("\n"));
  });
  it("CRLF", () => {
    const t = ["a", DAU, ...than(5), "b"].join("\r\n");
    expect(chePemDayDu(t, T).text).toBe(["a", T, "b"].join("\r\n"));
  });
  it("(3) dòng cuối ngắn hơn 16 ký tự và đệm '=' ⇒ là dòng CUỐI của thân, bị che; dòng ngắn ngay sau header ⇒ KHÔNG nhận là thân", () => {
    expect(chePemDayDu(["x", DAU, ...than(3), "AbC=", "sau"].join("\n"), T).text).toBe(["x", T, "sau"].join("\n"));
    expect(chePemDayDu(["x", DAU, ...than(3), dongGia(7, 62) + "==", "sau"].join("\n"), T).text).toBe(["x", T, "sau"].join("\n"));
    // dòng ngắn sau dòng ngắn: dòng ngắn thứ nhất là CUỐI ⇒ dòng ngắn thứ hai còn hiện
    expect(chePemDayDu(["x", DAU, ...than(2), "AbCd", "EfGh", "sau"].join("\n"), T).text).toBe(["x", T, "EfGh", "sau"].join("\n"));
    const ngan = ["x", DAU, "AbCdEf==", "sau"].join("\n");
    expect(chePemDayDu(ngan, T).text).toBe(ngan);
  });
  it("PEM mã hoá kiểu cũ (Proc-Type / DEK-Info + dòng trống) ⇒ che cả tiêu đề", () => {
    const t = ["x", DAU, "Proc-Type: 4,ENCRYPTED", "DEK-Info: AES-128-CBC,00112233445566778899AABBCCDDEEFF", "", ...than(8), "sau"].join("\n");
    expect(chePemDayDu(t, T).text).toBe(["x", T, "sau"].join("\n"));
  });
  it("một dòng có \\n thoát (chuỗi JSON) ⇒ che tới trước ký tự lạ", () => {
    const tho = `{"k":"${DAU}\\n${than(4).join("\\n")}\\nAB==","z":1}`;
    expect(chePemDayDu(tho, T).text).toBe(`{"k":"${T}","z":1}`);
  });
  it("dừng ở dòng KHÔNG thuộc thân: dòng base64 đúng độ dài nhưng có chữ thêm sau, hoặc dòng DÀI hơn độ dài chuẩn ⇒ còn hiện", () => {
    const lai = dongGia(77) + " // chú thích";
    expect(chePemDayDu(["x", DAU, ...than(4), lai, ...than(2)].join("\n"), T).text).toBe(["x", T, lai, ...than(2)].join("\n"));
    const dai = dongGia(78, 80);
    expect(chePemDayDu(["x", DAU, ...than(4), dai, "sau"].join("\n"), T).text).toBe(["x", T, dai, "sau"].join("\n"));
  });
  it("(1) TRẦN 256 dòng: thân 300 dòng × 32 ký tự (9 600 < trần ký tự) ⇒ 256 dòng đầu bị che, ĐÚNG 44 dòng cuối còn hiện", () => {
    expect(TRAN_DONG_THAN_PEM).toBe(256);
    const d = than(300, 32);
    const r = chePemDayDu(["x", DAU, ...d, "sau"].join("\n"), T).text;
    expect(r).toBe(["x", T, ...d.slice(256), "sau"].join("\n"));
  });
  it("(1) TRẦN 16 384 ký tự: dòng 2 000 ký tự ⇒ 8 dòng (16 000) bị che, dòng thứ 9 làm vượt ⇒ từ đó còn hiện", () => {
    expect(TRAN_KY_TU_THAN_PEM).toBe(16_384);
    const d = than(12, 2_000);
    const r = chePemDayDu(["x", DAU, ...d, "sau"].join("\n"), T).text;
    expect(r).toBe(["x", T, ...d.slice(8), "sau"].join("\n"));
  });
  it("(1) RSA-16384 PKCS#8 cỡ số học (194 dòng × 64 + dòng cuối 36) ⇒ che TRỌN", () => {
    const d = [...than(193), dongGia(500, 36)];
    expect(d.join("").length).toBe(12_388);
    const r = chePemDayDu(["x", "-----BEGIN PRIVATE KEY-----", ...d].join("\n"), T).text;
    expect(r).toBe(["x", T].join("\n"));
  });
});

describe("chePemThieuEnd — KHÔNG che oan (không đổi byte)", () => {
  // ba loại có trong kho @e0ea663fd (do-pem-thieu-end-16-11.md §2)
  const HEADER_TRON = [
    "// delimiter (`-----BEGIN...KEY-----`, `eyJ...`) scroll past the fixed window",
    "// PKCS8) — real headers like `-----BEGIN OPENSSH PRIVATE KEY-----` (35 chars) and",
    "// `-----BEGIN ENCRYPTED PRIVATE KEY-----` (37 chars) are LONGER than `STREAM_NORMAL_TAIL_HOLD`",
    "// entire key streams to the client raw. `-----BEGIN RSA PRIVATE KEY-----` (31 chars) happened",
    `B,"-----BEGIN PRIVATE KEY-----`,
    `  "PEM-khong-END": (n) => R("-----BEGIN PRIVATE KEY-----", n),`,
    `const MAU = "x\\n-----BEGIN RSA PRIVATE KEY-----\\n";`,
    "-----BEGIN PRIVATE KEY----- khong co ket thuc",
    ["-----BEGIN PRIVATE KEY-----", "// chú thích ngay sau, có khoảng trắng", "const a = 1;"].join("\n"),
    ["-----BEGIN PRIVATE KEY-----", "THANTHANTHAN", ""].join("\n"),
    "-----BEGIN PRIVATE KEY-----".repeat(50),
  ];
  it.each(HEADER_TRON.map((s, i) => [i, s] as const))("header trơ #%i ⇒ giữ nguyên từng byte", (_i, s) => {
    expect(chePemThieuEnd(s, T)).toEqual({ text: s, n: 0 });
    expect(chePemDayDu(s, T).text).toBe(s);
  });
  it("khối CÓ END ⇒ chePemDayDu cho cùng kết quả với chePem (ngữ nghĩa regex gốc)", () => {
    for (const s of [
      ["a", DAU, ...than(5), CUOI, "b"].join("\n"),
      ["a", DAU, ...than(3), CUOI, "giữa", DAU, ...than(2), CUOI].join("\n"),
      ["-----BEGIN PRIVATE KEY-----", "abc", "-----BEGIN PRIVATE KEY-----", "def", "-----END PRIVATE KEY-----"].join("\n"),
    ]) {
      expect(chePemDayDu(s, T)).toEqual(chePem(s, T));
    }
  });
  it("base64 dài KHÔNG có header PRIVATE KEY phía trước ⇒ không che", () => {
    const s = ["const anh = `", ...than(40), "`;", "-----BEGIN CERTIFICATE-----", ...than(5)].join("\n");
    expect(chePemDayDu(s, T).text).toBe(s);
  });
  it("BEGIN không END nằm SAU một khối có END ⇒ khối có END che như cũ, phần sau che theo luật mới", () => {
    const s = ["a", DAU, ...than(2), CUOI, "giữa", DAU, ...than(3), "sau"].join("\n");
    expect(chePemDayDu(s, T).text).toBe(["a", T, "giữa", T, "sau"].join("\n"));
  });
});
