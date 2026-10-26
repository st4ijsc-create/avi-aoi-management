/**
 * ★★★ LƯỚI CO GIÃN của bộ che (kiem-dinh 2026-10-26) — `redactSecretsAndPII` / `redactSecretsOnly` phải chạy TUYẾN TÍNH trên đầu vào xấu.
 *
 * VÌ SAO: bộ che chạy trên vòng lặp sự kiện duy nhất (cùng tiến trình với đường STOP). Đo: `"10.1.1.".repeat(20000)` (140 KB) mất 11,6 s,
 * `"a.".repeat(20000)` 1,7 s … do regex `connection_string` (`\b[a-z][a-z0-9+.-]*:\/\/…` thử lại từ MỌI biên chữ), `email`, khối PEM `[\s\S]*?` không có
 * END — mỗi điểm bắt đầu quét tới hết chuỗi ⇒ O(n²). Một lời nhắn / kết quả tool vài chục KB là đủ treo máy chủ.
 *
 * ĐO BẰNG TỶ LỆ TRONG CÙNG LẦN CHẠY (không ngưỡng giây tuyệt đối — máy tải làm mọi mốc giây trôi): t(2n) / t(n) < 3 với mỗi họ đầu vào xấu.
 * Tuyến tính ⇒ ≈ 2; bậc hai ⇒ ≈ 4. Họ chạy quá nhanh (t(2n) < 30 ms) coi là hiển nhiên không bậc hai. Mỗi mốc lấy MEDIAN của 5 lần.
 */
import { describe, expect, it } from "vitest";
import { redactSecretsAndPII, redactSecretsOnly } from "./aiSafety";

const R = (c: string, n: number) => c.repeat(n);

/** Họ đầu vào xấu: mỗi họ sinh chuỗi dài ∝ n, nhắm vào một dạng quét-lại của regex. */
export const HO_DAU_VAO_XAU: Readonly<Record<string, (n: number) => string>> = {
  "a.": (n) => R("a.", n),
  "1.": (n) => R("1.", n),
  "10.1.1.": (n) => R("10.1.1.", n),
  "Ab.": (n) => R("Ab.", n),
  "a-%": (n) => R("a-", n) + "%",
  "a": (n) => R("a", n),
  "aA1": (n) => R("aA1", n),
  "_": (n) => R("_", n),
  "a cach": (n) => R("a ", n),
  "0": (n) => R("0", n),
  "09 cach": (n) => R("09 ", n),
  "PEM-khong-END": (n) => R("-----BEGIN PRIVATE KEY-----", n),
  "PEM-than-dai": (n) => "-----BEGIN PRIVATE KEY-----" + R("x", n),
  "://": (n) => R("://", n),
  "a://b:": (n) => R("a://b:", n),
  "a://b:c": (n) => "a://b:" + R("c", n),
  "a://x:": (n) => R("a://x:", n),
  "sk-": (n) => R("sk-", n),
  "eyJ": (n) => R("eyJaaaaaaaa.", n),
  "Bearer": (n) => R("Bearer ", n),
  "password=": (n) => R("password=", n),
  "AIza": (n) => R("AIza", n),
  "ghp_": (n) => R("ghp_", n),
  "xoxb-": (n) => R("xoxb-", n),
  "a@": (n) => R("a@", n),
  "a@b.": (n) => R("a@b.", n),
  "@.": (n) => R("@.", n),
  "local-dai@": (n) => R("a.", n) + "@",
  "email-mien-dai": (n) => "x@" + R("a.", n),
  "+84": (n) => R("+84 ", n),
  "0912": (n) => R("0912 ", n),
  ".": (n) => R(".", n),
  "api_key=": (n) => R("api_key=", n),
  "pwd:": (n) => R("pwd:", n),
  "a=b": (n) => R("a=b ", n),
  "nhay": (n) => R('"', n),
  "xuong-dong": (n) => R("\n", n),
  "lo-so-dien-thoai": (n) => R("lô: 0912345678 ", n),
};

function trungVi(fn: (s: string) => unknown, s: string): number {
  const mau: number[] = [];
  for (let i = 0; i < 5; i++) {
    const a = performance.now();
    fn(s);
    mau.push(performance.now() - a);
  }
  return mau.sort((x, y) => x - y)[2]!;
}

const N = 6000;
const HAM: ReadonlyArray<[string, (s: string) => unknown]> = [
  ["redactSecretsAndPII", redactSecretsAndPII],
  ["redactSecretsOnly", redactSecretsOnly],
];

describe("bộ che aiSafety — thời gian tuyến tính trên họ đầu vào xấu", () => {
  for (const [tenHam, ham] of HAM) {
    for (const [ho, sinh] of Object.entries(HO_DAU_VAO_XAU)) {
      it(`${tenHam} · ${ho}: t(2n)/t(n) < 3`, () => {
        const t1 = trungVi(ham, sinh(N));
        const t2 = trungVi(ham, sinh(2 * N));
        if (t2 < 30) return; // quá nhanh để có thể bậc hai
        expect(t2 / Math.max(t1, 0.5), `t(n)=${t1.toFixed(1)}ms t(2n)=${t2.toFixed(1)}ms`).toBeLessThan(3);
      }, 120_000);
    }
  }
});
