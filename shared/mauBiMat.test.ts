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
import { cheChuoi } from "../server/services/ai/ngoai/cheDuLieu";

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
  ["Anthropic sk-ant-api03-", "sk-ant-api03-" + lap("Kq7Zx2Wm9Rt4_Lp-", 95), lap("Kq7Zx2Wm9Rt4_Lp-", 95).slice(3, 19)],
  ["Anthropic sk-ant-admin01-", "sk-ant-admin01-" + lap("Vb8-Nc3_Hd6Jf1", 80), lap("Vb8-Nc3_Hd6Jf1", 80).slice(2, 18)],
  // Theo chu-du-an-HST 14/11 (B1): tiền tố đặc hiệu DÍNH chữ phía trước vẫn là khoá (trước đây là ca âm của Đợt 4).
  ["GitHub ghp_ dính chữ (xghp_)", "x" + "ghp_" + lap(ALNUM, 36), lap(ALNUM, 36).slice(4, 20)],
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

/**
 * ★★★ 2026-11-14 — lô mauBiMat, chu-du-an-HST chọn phương án B1 (đo trước khi chọn: kho mã repo 1,13M dòng ⇒ 0 khớp mới; bộ
 * ca âm tổng hợp ⇒ nguyên văn đặc tả cũ che oan "task-admin-…"/"desk-proj-…"/"risk_live_…"/"MAKIAGE…", B1 thì không).
 *   · Anthropic `sk-ant-(api|admin)NN-` KHÔNG đòi biên trái — dính chữ/số/gạch phía trước vẫn che, ở MỌI bộ che rời máy và
 *     cả bộ che AI ngoài (`cheDuLieu.cheChuoi`).
 *   · `sk-` chung, `sk-(proj|svcacct|admin)-`, `[sr]k_live_`, `AKIA` GIỮ biên trái.
 * GIỚI HẠN ĐÃ BIẾT: khoá OpenAI/Stripe/AWS dính chữ phía trước vẫn lọt, bằng hiện nay.
 */
const KHOA_ANT = "sk-ant-api03-" + lap("Kq7Zx2Wm9Rt4_Lp-", 95);
const LOI_ANT = lap("Kq7Zx2Wm9Rt4_Lp-", 95).slice(30, 46);
const BO_CHE_CO_AI_NGOAI: Array<[string, (s: string) => string]> = [...BO_CHE, ["AI ngoài cheDuLieu.cheChuoi", (s) => cheChuoi(s).giaTri]];

describe("★★★ B1 — khoá Anthropic ở mọi dạng, kể cả DÍNH liền phía trước", () => {
  const DANG: Array<[string, string]> = [
    ["trần", KHOA_ANT],
    ["dính chữ thường (esk-ant-…)", `e${KHOA_ANT}`],
    ["dính sau 'task-' (task-sk-ant-…)", `task-${KHOA_ANT}`],
    ["dính số (9sk-ant-…)", `9${KHOA_ANT}`],
    ["dính gạch dưới (_sk-ant-…)", `_${KHOA_ANT}`],
    ["nhãn KEY=", `KEY=${KHOA_ANT}`],
    ["nhãn ANTHROPIC_API_KEY=", `ANTHROPIC_API_KEY=${KHOA_ANT}`],
    ['JSON "apiKey":', JSON.stringify({ apiKey: KHOA_ANT }, null, 2)],
    ["JSON lồng (chuỗi JSON trong JSON)", JSON.stringify({ cauHinh: JSON.stringify({ nhaCungCap: { apiKey: KHOA_ANT } }) })],
    ["dính chữ trong JSON", `{"x":"abc${KHOA_ANT}"}`],
  ];
  for (const [tenBo, che] of BO_CHE_CO_AI_NGOAI) {
    for (const [nhan, vao] of DANG) {
      it(`${tenBo} — ${nhan}`, () => {
        const ra = che(`dau ${vao} cuoi`);
        expect(ra, `lõi còn trong: ${ra.slice(0, 120)}`).not.toContain(LOI_ANT);
        expect(ra).not.toContain("sk-ant-api03-Kq7");
        expect(ra.startsWith("dau ")).toBe(true);
      });
    }
  }
});

describe("B1 — ngưỡng thân khoá Anthropic {20,} (rà kiem-dinh 14/11: mutant {20,}→{2,} sống)", () => {
  const dau = `sk-${"ant"}-api03-`;
  it("thân 19 ký tự ⇒ GIỮ nguyên; thân 20 ký tự ⇒ che", () => {
    expect(cheTokenCoTienTo(`x ${dau}${"Ab3_-".repeat(4).slice(0, 19)} y`, "[X]")).toBe(`x ${dau}${"Ab3_-".repeat(4).slice(0, 19)} y`);
    expect(cheTokenCoTienTo(`x ${dau}${"Ab3_-".repeat(4)} y`, "[X]")).toBe("x [X] y");
  });
});

describe("★★★ B1 — ca âm bắt buộc (chu-du-an-HST 14/11): tên tự nhiên dạng gần tiền tố KHÔNG bị che", () => {
  const AM_B1 = [
    "task-admin-dashboard-settings-2026-11-14",
    "desk-proj-booking-calendar-floor-3-west",
    "risk-svcacct-review-checklist-2026-q4-final",
    "risk_live_monitoringPanelsOverview",
    "MAKIAGEPRODUCTIONLINE7",
    "SLOVAKIAREGIONCODE2026XY",
    "task-v9-probe-abcdefghijklmnop",
    "risk-assessment-for-line-12345",
    "disk-usage-report-2026-11-14",
    `desk-${"booking-".repeat(6)}2026`,
    "sk-",
  ];
  for (const [tenBo, che] of BO_CHE_CO_AI_NGOAI) {
    // Bộ che extension có luật RIÊNG từ trước `sk[-_][A-Za-z0-9_-]{16,}` và `AKIA[0-9A-Z]{16}` KHÔNG biên trái (nguCanh.ts) ⇒
    // che thừa các tên chứa "sk-"/"sk_"/"AKIA" — có từ trước lô này, hướng an toàn, ghi vào báo cáo; không ghim ở đây.
    const coLuatRieng = (s: string) => tenBo.startsWith("extension") && /sk[-_]|AKIA/.test(s);
    // Bộ che LUỒNG mất ngữ cảnh TRÁI khi đã nhả phần đầu (đuôi giữ bắt đầu ngay ở "sk-"/"sk_" ⇒ biên trái khớp ở đầu bộ đệm) ⇒
    // che thừa "task-admin-…", "risk_live_…". Đo trên main a4d3ebf66 (trước lô này): cũng che y vậy — có từ trước, hướng an toàn.
    const luongMatNguCanh = (s: string) => tenBo.includes("Streaming") && /sk-(?:proj|svcacct|admin)-|k_live_/.test(s);
    for (const s of AM_B1) {
      if (coLuatRieng(s) || luongMatNguCanh(s)) continue;
      it(`${tenBo} — ${s.slice(0, 44)}`, () => expect(che(s)).toBe(s));
    }
  }
});

describe("B1 — bộ ca âm tổng hợp cố định (đối kháng, KHÔNG phải dữ liệu thật)", () => {
  const DAU = ["task", "risk", "desk", "disk", "mask", "ask", "flask", "kiosk", "dusk", "whisk", "brisk", "tusk", "Task", "Risk", "Desk", "Disk", "TASK", "RISK"];
  const GIUA_AM = ["-admin-", "-proj-", "-svcacct-", "_live_"];
  const DUOI = [
    "dashboard-settings-2026-11-14", "panel-v2-probe-abcdefghijklmnop", "assessment-for-line-12345-final",
    "usage-report-2026-11-14-weekly", "monitoringPanelsOverview", "checklist_station_07_backup", "Q4-review-meeting-notes-long",
  ];
  const am = DAU.flatMap((a) => GIUA_AM.flatMap((g) => DUOI.map((d) => `${a}${g}${d}`)));
  // Chỉ từ kết thúc bằng "sk" CHỮ THƯỜNG mới ghép thành "sk-ant-…" (TASK-ant-… không phải hình khoá).
  const duong = DAU.filter((a) => a.endsWith("sk")).flatMap((a) => ["-ant-api03-", "-ant-admin01-"].flatMap((g) => DUOI.map((d) => `${a}${g}${d}`)));

  it("504 tên <từ…sk/rk><-admin-|-proj-|-svcacct-|_live_><slug> ⇒ bộ mẫu chung che 0", () => {
    expect(am).toHaveLength(18 * 4 * 7);
    const bi = am.filter((s) => cheTokenCoTienTo(s, "[X]") !== s);
    expect(bi).toEqual([]);
  });

  it("224 chuỗi <từ…sk>-ant-(api03|admin01)-<slug ≥ 20> mang ĐÚNG hình khoá Anthropic dính chữ ⇒ che 224 (ca dương, không phải che oan)", () => {
    expect(duong).toHaveLength(16 * 2 * 7);
    const sot = duong.filter((s) => !cheTokenCoTienTo(s, "[X]").includes("[X]"));
    expect(sot).toEqual([]);
  });
});

// ★ CHE THỪA ĐÃ CHẤP NHẬN — chu-du-an-HST xác nhận 14/11 (sau commit 8112aa94a): giữ dinhTrai cho gh?_/github_pat_/glpat-/xox/
// AIza/npm_ dù tên thường dính chữ dạng đó bị che, vì hướng sai là hướng an toàn và kho repo thật (K1) có 0 khớp mới.
// 18 ca CỐ ĐỊNH lấy từ bộ đối kháng K2: 6 ca trần đã bị che từ trước B1 (5 gh?_ + glpat-), 12 ca dính chữ bị che DO B1.
// Siết lại mẫu sau này ⇒ danh sách dưới đổi ⇒ ca này đỏ, phải cập nhật CÓ CHỦ Ý.
// LUẬT HST: mỗi lần đổi MAU_TOKEN_CO_TIEN_TO phải chạy lại K1 (quét `git archive` của main bằng RE_TOKEN_CO_TIEN_TO trước/sau);
// K1 > 0 khớp mới ⇒ DỪNG, báo chủ dự án trước khi gộp.
describe("B1 — che thừa ĐÃ CHẤP NHẬN (chu-du-an-HST 14/11): 18 ca cố định", () => {
  const CHE_THUA_DA_CHAP_NHAN: Array<[string, string]> = [
    ...["p_", "o_", "u_", "s_", "r_"].map((x): [string, string] => [`gh${x}settingsPanelOverview2026`, "[X]"]),
    ["glpat-like-name-for-a-doc-section", "[X]"],
    ...["l", "w"].flatMap((d) => ["p_", "o_", "u_", "s_", "r_"].map((x): [string, string] => [`${d}gh${x}settingsPanelOverview2026`, `${d}[X]`])),
    ["xnpm_registryMirrorConfigurationDefaults2026", "x[X]"],
    ["zAIzaSyVeryLongIdentifierNameThatIsNotAKey123", "z[X]ey123"],
  ];
  it("đúng 18 ca, mỗi ca ra ĐÚNG chuỗi ghi sẵn (6 trần che từ trước + 12 dính chữ che do B1)", () => {
    expect(CHE_THUA_DA_CHAP_NHAN).toHaveLength(18);
    expect(CHE_THUA_DA_CHAP_NHAN.map(([vao]) => [vao, cheTokenCoTienTo(vao, "[X]")])).toEqual(CHE_THUA_DA_CHAP_NHAN);
  });
});

describe("B1 — bộ che LUỒNG giữ khoá Anthropic dính chữ đang mọc (không nhả từng mảnh)", () => {
  it("mẫu ĐANG GÕ nhận sk-ant- dính chữ ở đuôi, nhả khi có ký tự kết thúc", () => {
    expect(RE_TOKEN_CO_TIEN_TO_DANG_GO.test("x = esk-ant-api03-Kq7Z")).toBe(true);
    expect(RE_TOKEN_CO_TIEN_TO_DANG_GO.test("x = esk-ant-api03-Kq7Z ")).toBe(false);
  });

  it.each([1, 3, 7, 16])("khoá dính chữ đẩy theo khúc %i ký tự ⇒ đầu ra ghép lại không còn lõi", (n) => {
    const r = new StreamingSecretRedactor();
    const vao = `cau hinh: abc${KHOA_ANT} xong`;
    let ra = "";
    for (let i = 0; i < vao.length; i += n) ra += r.push(vao.slice(i, i + n));
    ra += r.flush();
    expect(ra).not.toContain(LOI_ANT);
    expect(ra.endsWith(" xong")).toBe(true);
  });
});

describe("B1 — một nguồn: mỗi mẫu dinhTrai có tiền tố, danh sách dinhTrai đúng quyết định", () => {
  it("dinhTrai = github, github_pat, gitlab, slack, google, npm, anthropic; giữ biên = aws, stripe, openai", () => {
    expect(MAU_TOKEN_CO_TIEN_TO.filter((m) => m.dinhTrai).map((m) => m.ten)).toEqual(["github", "github_pat", "gitlab", "slack", "google", "npm", "anthropic"]);
    expect(MAU_TOKEN_CO_TIEN_TO.filter((m) => !m.dinhTrai).map((m) => m.ten)).toEqual(["aws", "stripe", "openai"]);
    for (const m of MAU_TOKEN_CO_TIEN_TO) expect(new RegExp(`^(?:${m.tienTo})`).test(m.nguon.replace(/\[([^\]])[^\]]*\]/g, "$1").replace(/\(\?:([^|)]+)[^)]*\)/g, "$1"))).toBe(true);
  });
});
