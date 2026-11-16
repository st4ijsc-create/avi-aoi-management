/**
 * (HST 16/11) PEM "BEGIN … PRIVATE KEY" THIẾU END ở đường chung: che header + THÂN liền sau; header trơ giữ nguyên từng byte.
 * Mọi "khoá" ở đây là base64 GIẢ sinh tất định (không phải khoá thật).
 * ĐỘT BIẾN PHẢI ĐỎ: "che tới hết văn bản" · "bỏ trần" · "che header trơ" · "không che khi thiếu END" · "bỏ luật dừng ở dòng không thuộc thân".
 */
import { describe, expect, it } from "vitest";
import { StreamingSecretRedactor } from "./aiSafety";
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

// Giới hạn đã biết G1–G4: định nghĩa ở MỘT chỗ (cheTuyenTinh.ts, khối "GIỚI HẠN ĐÃ BIẾT"); các ca dưới đo đúng con số.
describe("giới hạn đã biết (G1–G4, cheTuyenTinh.ts)", () => {
  it("G1 phần vượt trần còn hiện: xem hai ca TRẦN ở trên (44 dòng cuối / từ dòng thứ 9)", () => {
    expect(TRAN_DONG_THAN_PEM * 64).toBe(TRAN_KY_TU_THAN_PEM);
  });
  it("G2 dòng ngắn sau thân, không chia hết 4 và < 16 ký tự ⇒ còn hiện (15 ký tự)", () => {
    const duoi = dongGia(31, 15);
    expect(chePemDayDu(["x", DAU, ...than(3), duoi, "sau"].join("\n"), T).text).toBe(["x", T, duoi, "sau"].join("\n"));
  });
  it.each([4, 8, 12])("G3 từ toàn base64 dài %i ngay sau thân bị NUỐT làm dòng cuối (che oan một dòng)", (dai) => {
    const tu = "dataDATAdata".slice(0, dai);
    expect(chePemDayDu(["x", DAU, ...than(3), tu, "sau"].join("\n"), T).text).toBe(["x", T, "sau"].join("\n"));
  });
  // G4: kỳ vọng ĐÚNG là lọt 0. Hiện SAI (lô 2 chưa làm) ⇒ it.fails; khi lô 2 sửa xong ca này sẽ đỏ ⇒ đổi về `it`.
  it.fails("G4 luồng: thân 200 dòng (> STREAM_HOLD_CAP) phát theo mẩu 64 ký tự ⇒ KHÔNG dòng thân nào lọt", () => {
    const d = than(200);
    const text = ["dau", DAU, ...d, "het."].join("\n");
    const r = new StreamingSecretRedactor();
    let out = "";
    for (let i = 0; i < text.length; i += 64) out += r.push(text.slice(i, i + 64));
    out += r.flush();
    expect(d.filter((x) => out.includes(x)).length).toBe(0);
  });
});

// (kiem-dinh 16/11) ca biên cho các đột biến còn sống S1–S7 + G5.
describe("ca biên (kiem-dinh S1–S7) + G5", () => {
  it("S1 tổng thân ĐÚNG 16 384 ký tự ⇒ che trọn; thêm một dòng cuối làm vượt ⇒ dòng đó còn hiện", () => {
    const d = than(8, 2_048);
    expect(d.join("").length).toBe(16_384);
    expect(chePemDayDu(["x", DAU, ...d, "sau"].join("\n"), T).text).toBe(["x", T, "sau"].join("\n"));
    expect(chePemDayDu(["x", DAU, ...d, "AbCd", "sau"].join("\n"), T).text).toBe(["x", T, "AbCd", "sau"].join("\n"));
  });
  it("S2 dòng đầu sau header dài ĐÚNG 15 ⇒ không phải thân; ĐÚNG 16 ⇒ thân", () => {
    const d15 = ["x", DAU, dongGia(1, 15), "sau"].join("\n");
    expect(chePemDayDu(d15, T).text).toBe(d15);
    expect(chePemDayDu(["x", DAU, dongGia(1, 16), "sau"].join("\n"), T).text).toBe(["x", T, "sau"].join("\n"));
  });
  it("S3 gọi TRỰC TIẾP chePemThieuEnd trên khối CÓ END ⇒ không đổi byte (khối có END là việc của chePem)", () => {
    const s = ["a", DAU, ...than(4), CUOI, "b"].join("\n");
    expect(chePemThieuEnd(s, T)).toEqual({ text: s, n: 0 });
  });
  it("S4 header GIỮA dòng (theo sau là chữ trong câu) ⇒ không che, kể cả khi dòng sau là base64", () => {
    const s = ["abc -----BEGIN PRIVATE KEY----- chữ thường trong câu", ...than(3), "sau"].join("\n");
    expect(chePemDayDu(s, T).text).toBe(s);
  });
  it("S5 một dòng có \\r\\n thoát (chuỗi JSON Windows) ⇒ che tới trước ký tự lạ", () => {
    const tho = `{"k":"${DAU}\\r\\n${than(3).join("\\r\\n")}\\r\\nAB==","z":1}`;
    expect(chePemDayDu(tho, T).text).toBe(`{"k":"${T}","z":1}`);
  });
  it("S6 thân có '/' và '+' ở dòng đầu và dòng giữa ⇒ che trọn", () => {
    const d1 = "+/" + dongGia(3, 60) + "/+";
    const d2 = dongGia(4, 30) + "//++" + dongGia(5, 30);
    expect(d1.length).toBe(64);
    expect(d2.length).toBe(64);
    expect(chePemDayDu(["x", DAU, d1, d2, ...than(2), "sau"].join("\n"), T).text).toBe(["x", T, "sau"].join("\n"));
  });
  it("S7 dòng TRỐNG ngay sau thân ⇒ giữ nguyên dòng trống (không nuốt xuống dòng)", () => {
    expect(chePemDayDu(["x", DAU, ...than(3), "", "chữ"].join("\n"), T).text).toBe(["x", T, "", "chữ"].join("\n"));
  });
  it.fails("G5a khoá CÙNG DÒNG với header, ngăn bằng khoảng trắng ⇒ kỳ vọng ĐÚNG: che (hiện chưa)", () => {
    const s = `KEY=-----BEGIN PRIVATE KEY----- ${dongGia(1)} ${dongGia(2)}`;
    expect(chePemDayDu(s, T).text).not.toContain(dongGia(1));
  });
  it.fails("G5b độ dài dòng không đều (64 rồi 76) ⇒ kỳ vọng ĐÚNG: che trọn (hiện chỉ che tới chỗ đổi độ dài)", () => {
    const d = [dongGia(1), dongGia(2, 76), dongGia(3, 76)];
    expect(chePemDayDu(["x", DAU, ...d, "sau"].join("\n"), T).text).toBe(["x", T, "sau"].join("\n"));
  });
});
