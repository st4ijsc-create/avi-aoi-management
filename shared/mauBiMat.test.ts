/**
 * ★★★ Đợt 4 (2026-10-17) — MỘT NGUỒN mẫu token có tiền tố cho CẢ HAI bộ che rời máy:
 *   · máy chủ: `aiSafety.redactSecretsOnly` / `redactSecretsAndPII` / `StreamingSecretRedactor`;
 *   · extension: `loi/nguCanh.cheBiMat` (mọi đường đọc/ngữ cảnh/ghost text đi qua nó).
 *
 * Đo trước (bộ đầu-cuối `scripts/ai-eval/vscode-e2e`, `--config ro`): khoá `ghp_…` hardcode trong một tệp mã thường
 * (`cau-hinh/dich-vu.json`, khoá JSON `githubPat`) RÒ 21/21 lượt — `cheBiMat` không có luật `ghp_`, và luật "gán khoá =
 * giá trị" không khớp tên trường `githubPat`. Máy chủ có `ghp_` nhưng thiếu mọi tiền tố khác (gho_/github_pat_/glpat-/
 * xox?-/AIza/sk_live_/npm_/sk-proj-).
 *
 * ⚠ Token giả DỰNG bằng nối chuỗi (không có hằng nguyên khối trong repo) để máy quét bí mật của nơi đẩy mã không báo
 *   nhầm, và để mỗi mẫu có lõi riêng kiểm được "không còn một mảnh nào".
 */
import { describe, it, expect } from "vitest";
import { cheTokenCoTienTo, MAU_TOKEN_CO_TIEN_TO, RE_TOKEN_CO_TIEN_TO_DANG_GO } from "./mauBiMat";
import { redactSecretsAndPII, redactSecretsOnly, StreamingSecretRedactor } from "../server/services/ai/aiSafety";
import { cheBiMat } from "../vscode-extension/src/loi/nguCanh";

const lap = (mau: string, n: number) => mau.repeat(Math.ceil(n / mau.length)).slice(0, n);
const ALNUM = "Ab3dE5gH7jK9mN1pQ2rS4tU6vW8xY0z";

/** [nhãn, token, lõi phải biến mất] */
const DUONG: Array<[string, string, string]> = [
  ...["ghp_", "gho_", "ghu_", "ghs_", "ghr_"].map((p): [string, string, string] => [`GitHub ${p}`, p + lap(ALNUM, 36), lap(ALNUM, 36).slice(4, 20)]),
  ["GitHub github_pat_", "github_pat_" + "11ABCDEFG0" + lap("xY9_kL2mQ8", 72), lap("xY9_kL2mQ8", 72).slice(10, 26)],
  ["GitLab glpat-", "glpat-" + lap("Zx8-Cv7_Bn", 20), lap("Zx8-Cv7_Bn", 20).slice(2, 18)],
  ["Slack xoxb-", "xoxb-" + "176536724810-1987469832311-" + lap("pdFZKVeTuE8sk7oO", 24), lap("pdFZKVeTuE8sk7oO", 24)],
  ["Slack xoxp-", "xoxp-" + "1234567890-9876543210-1122334455-" + lap("a1b2c3d4e5f6", 32), lap("a1b2c3d4e5f6", 32)],
  ["AWS AKIA", "AKIA" + "Q7RZ2MXW4KTB9VNC", "Q7RZ2MXW4KTB9VNC"],
  ["Google AIza", "AIza" + lap("Sy9_Kq-3Lm", 35), lap("Sy9_Kq-3Lm", 35).slice(3, 19)],
  ["Stripe sk_live_", "sk_live_" + lap("51HqLyjWDarjtT1zdp7dc", 24), lap("51HqLyjWDarjtT1zdp7dc", 24).slice(0, 16)],
  ["Stripe rk_live_", "rk_live_" + lap("9Tz8Yx7Wv6Uu5", 24), lap("9Tz8Yx7Wv6Uu5", 24).slice(0, 16)],
  ["npm npm_", "npm_" + lap("Q1w2E3r4T5y6U7i8", 36), lap("Q1w2E3r4T5y6U7i8", 36).slice(0, 16)],
  ["OpenAI sk-proj-", "sk-proj-" + lap("Hj3_Kl9-Mn2Pq", 48), lap("Hj3_Kl9-Mn2Pq", 48).slice(5, 21)],
  [
    "JWT eyJ",
    ["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkF2aSJ9", "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"].join("."),
    "dozjgNryP4J3jVmNHl0w5N",
  ],
  [
    "PEM",
    ["-----BEGIN RSA PRIVATE KEY-----", "MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gun", "VTLw7onLRnrq0/IzW7yWR7QkrmBL7jTKEn5u+qKhbwKfBstIs+bMY2Zkp18gnTxK", "-----END RSA PRIVATE KEY-----"].join("\n"),
    "MIIEowIBAAKCAQEAu1SU1LfVLPHC",
  ],
];

/** Chữ thường MANG HÌNH tiền tố nhưng không phải khoá — KHÔNG được che (cả hai phía). */
const AM: string[] = [
  "Trang ghpages của nhóm và thư mục ghp cũ",
  "biến ghp_short và gho_abc",
  "x" + "ghp_" + lap(ALNUM, 36),
  "github_pat_ngan",
  "glpat-abc",
  "xoxb-container-large",
  "xoxo-hugs",
  "AKIA123 và AKIAXYZ là mã nội bộ",
  "AIzaNho",
  "sk_live_x",
  "npm_config_registry=https://registry.npmjs.org/ npm_package_version=1.2.3",
  "chuỗi eyJ đứng một mình",
  "const ketQua = tinhTong(a, b); // ghi chú thường",
];

/** Mỗi bộ che rời máy cần kiểm. */
const BO_CHE: Array<[string, (s: string) => string]> = [
  ["shared cheTokenCoTienTo", (s) => cheTokenCoTienTo(s, "[X]")],
  ["server redactSecretsOnly", (s) => redactSecretsOnly(s).text],
  ["server redactSecretsAndPII", (s) => redactSecretsAndPII(s).text],
  ["extension cheBiMat", (s) => cheBiMat(s)],
  [
    "server StreamingSecretRedactor (từng ký tự)",
    (s) => {
      const r = new StreamingSecretRedactor();
      let ra = "";
      for (const c of s) ra += r.push(c);
      return ra + r.flush();
    },
  ],
];

const laPemHoacJwt = (nhan: string) => nhan === "PEM" || nhan.startsWith("JWT");

describe("★★★ mẫu token có tiền tố — mỗi dạng bị che ở MỌI bộ che rời máy", () => {
  for (const [tenBo, che] of BO_CHE) {
    for (const [nhan, token, loi] of DUONG) {
      // PEM/JWT do luật RIÊNG của mỗi phía lo (đã có từ trước) — bộ mẫu chung chỉ phủ token có tiền tố.
      if (tenBo.startsWith("shared") && laPemHoacJwt(nhan)) continue;
      it(`${tenBo} — ${nhan}`, () => {
        const vao = `{\n  "dichVu": "kho-noi-bo",\n  "khoa": "${token}",\n  "thoiGianChoMs": 3000\n}\n${token} cuối dòng`;
        const ra = che(vao);
        expect(ra, `lõi "${loi}" còn trong: ${ra}`).not.toContain(loi);
        expect(ra).toContain("thoiGianChoMs");
      });
    }
  }

  it("★★★ ca thật của bộ đo: `githubPat` trong JSON (khoá không mang chữ token/secret/password)", () => {
    const tok = "ghp_" + lap("Rq7Lm2Nx9Pz4", 36);
    const json = JSON.stringify({ dichVu: "kho-noi-bo", githubPat: tok, thoiGianChoMs: 3000 }, null, 2);
    for (const [tenBo, che] of BO_CHE) expect(che(json), tenBo).not.toContain(tok.slice(8, 24));
  });
});

describe("★★ chữ thường giống tiền tố — KHÔNG bị che", () => {
  for (const [tenBo, che] of BO_CHE) {
    for (const s of AM) {
      // ⚠ Bộ che LUỒNG mất ngữ cảnh TRÁI khi đã nhả phần đầu (đuôi giữ bắt đầu NGAY tại `ghp_` ⇒ `\b`/biên trái khớp ở
      //   đầu bộ đệm) ⇒ `xghp_…` bị che THỪA. Hướng an toàn, có từ trước Đợt 4 (luật `\bghp_` cũ cũng vậy) — không canh ở đây.
      if (tenBo.includes("Streaming") && s.startsWith("xghp_")) continue;
      it(`${tenBo} — ${s.slice(0, 40)}`, () => expect(che(s)).toBe(s));
    }
  }
});

describe("mẫu dùng chung — hình dạng", () => {
  it("mỗi mẫu là một regex hợp lệ và tên không trùng", () => {
    const ten = MAU_TOKEN_CO_TIEN_TO.map((m) => m.ten);
    expect(new Set(ten).size).toBe(ten.length);
    for (const m of MAU_TOKEN_CO_TIEN_TO) expect(() => new RegExp(m.nguon)).not.toThrow();
  });

  it("mẫu ĐANG GÕ bắt tiền tố đang mọc ở đuôi bộ đệm, nhả khi có ký tự kết thúc", () => {
    expect(RE_TOKEN_CO_TIEN_TO_DANG_GO.test("x = github_pat_11ABC")).toBe(true);
    expect(RE_TOKEN_CO_TIEN_TO_DANG_GO.test("x = xoxb-1765367")).toBe(true);
    expect(RE_TOKEN_CO_TIEN_TO_DANG_GO.test('x = "github_pat_11ABC" ')).toBe(false);
    expect(RE_TOKEN_CO_TIEN_TO_DANG_GO.test("trang ghpages")).toBe(false);
  });
});
