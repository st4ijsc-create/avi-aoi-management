/**
 * ★★★ Chuẩn đối chiếu của ba phép che tuyến tính (`cheTuyenTinh.ts`) — kiem-dinh 2026-10-26.
 * ĐIỀU KIỆN của dieu-phoi: vá regex KHÔNG ĐƯỢC GIẢM độ phủ che. Cách chứng minh: mỗi phép mới được so với CHÍNH regex gốc (nguyên văn, giữ ở đây làm
 * "oracle") trên (a) các vector thật, (b) hàng chục nghìn chuỗi ngẫu nhiên sinh từ bảng ký tự khó (biên chữ, dấu chấm, '@', '://', ':', khoảng trắng, Unicode),
 * so BẰNG NHAU từng ký tự và cả số lần khớp. Hạt giống cố định ⇒ tái lập được.
 */
import { describe, expect, it } from "vitest";
import { cheChuoiKetNoi, cheEmail, chePem } from "./cheTuyenTinh";
import { redactSecretsAndPII } from "./aiSafety";

const RE_KET_NOI = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@]+@[^\s]+/gi;
const RE_EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const RE_PEM = /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g;
const THAY = "<#>";

function oracle(re: RegExp, s: string): { text: string; n: number } {
  let n = 0;
  const text = s.replace(re, () => (n++, THAY));
  return { text, n };
}

/** PRNG xác định (mulberry32). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MANH_KET_NOI = ["pg://", "u:p@h", "://u:p@", "x://a:b@c", "y@z", "a", "B", "z", "0", "9", "+", ".", "-", "_", "://", ":", "/", "@", " ", "\n", "\t", "x", "http", "pg", "u", "p", "é", "\u00a0", "%", "?", "h.i"];
const MANH_EMAIL = ["a", "B", "z", "0", "9", "+", ".", "-", "_", "%", "@", "@", " ", "\n", "x", "com", ".com", "vn", "co.uk", "é", ":", "/", "\u00a0", "a.b", "1"];
const MANH_PEM = ["-----BEGIN PRIVATE KEY-----", "-----BEGIN RSA PRIVATE KEY-----", "-----END PRIVATE KEY-----", "-----END RSA PRIVATE KEY-----", "-----BEGIN", "-----END", "x", "\n", " ", "KEY-----", "PRIVATE KEY-----", "ABC"];

function sinh(manh: readonly string[], rnd: () => number, toiDa: number): string {
  const so = 1 + Math.floor(rnd() * toiDa);
  let s = "";
  for (let i = 0; i < so; i++) s += manh[Math.floor(rnd() * manh.length)]!;
  return s;
}

describe("cheTuyenTinh — khớp từng ký tự với regex gốc", () => {
  const CA: ReadonlyArray<[string, (s: string, t: string) => { text: string; n: number }, RegExp, readonly string[], number]> = [
    ["chuỗi kết nối", cheChuoiKetNoi, RE_KET_NOI, MANH_KET_NOI, 14],
    ["email", cheEmail, RE_EMAIL, MANH_EMAIL, 14],
    ["khối PEM", chePem, RE_PEM, MANH_PEM, 9],
  ];
  for (const [ten, ham, re, manh, toiDa] of CA) {
    it(`${ten}: 40 000 chuỗi ngẫu nhiên ⇒ kết quả và số khớp Y HỆT regex gốc`, () => {
      const rnd = prng(0x5eed + ten.length);
      let coKhop = 0;
      for (let i = 0; i < 40_000; i++) {
        const s = sinh(manh, rnd, toiDa);
        const a = oracle(re, s);
        const b = ham(s, THAY);
        if (a.text !== b.text || a.n !== b.n) throw new Error(`${ten} lệch trên ${JSON.stringify(s)}: gốc=${JSON.stringify(a)} mới=${JSON.stringify(b)}`);
        if (a.n > 0) coKhop++;
      }
      // cầu chì: bảng mảnh thật sự sinh ra khớp (không so toàn "không khớp" với "không khớp")
      expect(coKhop, "số chuỗi có khớp").toBeGreaterThan(300);
    });
  }

  it("vector thật: chuỗi kết nối / email / PEM", () => {
    const vec: Array<[typeof cheChuoiKetNoi, RegExp, string]> = [
      [cheChuoiKetNoi, RE_KET_NOI, "postgres://aoi:S3cretPw@db.internal:5432/aoi"],
      [cheChuoiKetNoi, RE_KET_NOI, "ket noi mqtt://u:p@10.0.0.5:1883 va redis://:pw@h:6379 xong"],
      [cheChuoiKetNoi, RE_KET_NOI, "see.http://u:p@h x.y.z+q-://a:b@c"],
      [cheChuoiKetNoi, RE_KET_NOI, "https://example.com/path?x=1 khong co mat khau"],
      [cheChuoiKetNoi, RE_KET_NOI, "a://b:c@d e://f:g@h"],
      [cheEmail, RE_EMAIL, "lien he a.b+c@mail.example.com, x_y@z.vn va bad@x va @y.com"],
      [cheEmail, RE_EMAIL, "a@b.co.uk;c@d.e1 f@g.hh-"],
      [chePem, RE_PEM, "x\n-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\ny"],
      [chePem, RE_PEM, "-----BEGIN PRIVATE KEY-----\nabc\n-----BEGIN PRIVATE KEY-----\ndef\n-----END PRIVATE KEY-----\ntail"],
      [chePem, RE_PEM, "-----BEGIN PRIVATE KEY----- khong co ket thuc"],
    ];
    for (const [ham, re, s] of vec) expect(ham(s, THAY), s).toEqual(oracle(re, s));
  });

  it("độ phủ che CÔNG KHAI không đổi: các mẫu bí mật/PII điển hình vẫn bị che qua redactSecretsAndPII", () => {
    const can = [
      "postgres://aoi:S3cretPw@db.internal:5432/aoi",
      "mail toi nguyen.van@congty.com.vn nhe",
      "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----",
    ];
    for (const s of can) {
      const r = redactSecretsAndPII(s);
      expect(r.text, s).toMatch(/\[REDACTED_(SECRET|EMAIL)\]/);
      expect(r.text).not.toContain("S3cretPw");
      expect(r.text).not.toContain("nguyen.van");
      expect(r.text).not.toContain("MIIEvQIBADANBg");
      expect(r.redactions.length).toBeGreaterThan(0);
    }
  });
});
