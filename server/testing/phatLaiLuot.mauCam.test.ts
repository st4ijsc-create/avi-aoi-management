/**
 * Bộ DÒ rò fixture (`kiemMauCam` / `dongGoi`) dùng MỘT nguồn mẫu khoá `shared/mauBiMat.ts` — lô "một nguồn mẫu" (chu-du-an-HST 14/11).
 * Thuần: không DB, không mạng, không đĩa. Mọi khoá trong tệp là GIẢ, ghép lúc chạy.
 */
import { describe, it, expect } from "vitest";
import { dongGoi, kiemMauCam } from "./phatLaiLuot";
import { cheTokenCoTienTo, MAU_TOKEN_CO_TIEN_TO } from "../../shared/mauBiMat";

const lap = (mau: string, n: number) => mau.repeat(Math.ceil(n / mau.length)).slice(0, n);
const CHU = lap("Kq7Zx2Wm9Rt4Lp8N", 120);

/** Một mẫu GIẢ đúng hình cho MỖI `ten` của shared/mauBiMat (thiếu `ten` ⇒ ca "mỗi mẫu có mẫu thử" đỏ). */
const MAU_THU: Record<string, string> = {
  github: `gh${"p"}_${CHU.slice(0, 36)}`,
  github_pat: `github${"_pat"}_${CHU.slice(0, 82)}`,
  gitlab: `glp${"at"}-${CHU.slice(0, 20)}`,
  slack: `xo${"xb"}-1234567890-${CHU.slice(0, 24)}`,
  aws: `AK${"IA"}${CHU.slice(0, 16).toUpperCase()}`,
  google: `AI${"za"}${CHU.slice(0, 35)}`,
  stripe: `sk${"_live"}_${CHU.slice(0, 24)}`,
  npm: `np${"m"}_${CHU.slice(0, 36)}`,
  openai: `sk-${"proj"}-${CHU.slice(0, 40)}`,
  anthropic: `sk-${"ant"}-api03-${CHU.slice(0, 95)}`,
};

const coToken = (s: string, ten: string) => kiemMauCam(s).includes(`token-${ten}`);

describe("kiemMauCam — mọi mẫu của shared/mauBiMat có nhãn token-<ten>", () => {
  it("mỗi mẫu dùng chung đều có mẫu thử trong tệp này", () => {
    expect(Object.keys(MAU_THU).sort()).toEqual(MAU_TOKEN_CO_TIEN_TO.map((m) => m.ten).sort());
  });
  it.each(MAU_TOKEN_CO_TIEN_TO.map((m) => m.ten))("%s: trần ⇒ có nhãn token-%s", (ten) => {
    expect(coToken(`dau ${MAU_THU[ten]} cuoi`, ten)).toBe(true);
  });
});

describe("kiemMauCam — khoá DÍNH chữ phía trước (luật khoa-* cũ dùng \\b nên lọt)", () => {
  // Mẫu `dinhTrai` (không biên trái) phải dò được cả khi dính; mẫu GIỮ biên thì không (bằng bộ che — xem shared/mauBiMat.ts).
  const DINH = MAU_TOKEN_CO_TIEN_TO.filter((m) => m.dinhTrai).map((m) => m.ten);
  const GIU_BIEN = MAU_TOKEN_CO_TIEN_TO.filter((m) => !m.dinhTrai).map((m) => m.ten);
  it("danh sách dinhTrai đúng quyết định B1", () => {
    expect(DINH).toEqual(["github", "github_pat", "gitlab", "slack", "google", "npm", "anthropic"]);
    expect(GIU_BIEN).toEqual(["aws", "stripe", "openai"]);
  });
  it.each(DINH)("%s dính chữ thường ⇒ vẫn có nhãn", (ten) => {
    expect(coToken(`x = e${MAU_THU[ten]}`, ten)).toBe(true);
  });
  it.each(GIU_BIEN)("%s dính chữ ⇒ KHÔNG có nhãn token (giữ biên như bộ che)", (ten) => {
    expect(coToken(`x = e${MAU_THU[ten]}`, ten)).toBe(false);
  });
  it("trước lô này nhãn khoa-anthropic KHÔNG bắt khoá dính chữ — nay token-anthropic bắt", () => {
    const s = `abc${MAU_THU.anthropic}`;
    expect(kiemMauCam(s)).not.toContain("khoa-anthropic");
    expect(kiemMauCam(s)).toContain("token-anthropic");
  });
});

describe("kiemMauCam — bộ DÒ mạnh ít nhất bằng bộ CHE (cùng tập chuỗi)", () => {
  const AM = [
    "task-admin-dashboard-settings-2026-11-14",
    "desk-proj-booking-calendar-floor-3-west",
    "risk-svcacct-review-checklist-2026-q4-final",
    "risk_live_monitoringPanelsOverview",
    "MAKIAGEPRODUCTIONLINE7",
    "SLOVAKIAREGIONCODE2026XY",
    "task-v9-probe-abcdefghijklmnop",
    "risk-assessment-for-line-12345",
    "disk-usage-report-2026-11-14",
    "sk-",
  ];
  const TAP = [
    ...AM,
    ...Object.values(MAU_THU),
    ...Object.values(MAU_THU).map((k) => `e${k}`),
    ...Object.values(MAU_THU).map((k) => `9${k}`),
    ...Object.values(MAU_THU).map((k) => `"apiKey": "${k}"`),
    "lghp_settingsPanelOverview2026",
    "xnpm_registryMirrorConfigurationDefaults2026",
    "zAIzaSyVeryLongIdentifierNameThatIsNotAKey123",
  ];
  it("mọi chuỗi bộ che token thay được ⇒ bộ dò có ít nhất một nhãn token-*", () => {
    const lot = TAP.filter((s) => cheTokenCoTienTo(s, "[X]") !== s && !kiemMauCam(s).some((t) => t.startsWith("token-")));
    expect(lot).toEqual([]);
  });
  it("ca âm bắt buộc của B1: không nhãn nào", () => {
    expect(AM.filter((s) => kiemMauCam(s).length > 0)).toEqual([]);
  });
});

describe("dongGoi — NÉM khi fixture còn khoá dính chữ", () => {
  const goi = (noiDung: string) =>
    dongGoi([{ loai: "luot", n: 1, options: { messages: [{ role: "user", content: noiDung }] }, manh: [] }], {
      goc: "D:/goc",
      duAnTuongDoi: ".",
      cauHoi: "q",
      cheDo: "hoi",
      suKien: [],
      lyDo: null,
    });
  it("anthropic dính chữ ⇒ ném, thông điệp nêu token-anthropic", () => {
    expect(() => goi(`cau hinh task${MAU_THU.anthropic}`)).toThrow(/token-anthropic/);
  });
  it("github dính chữ ⇒ ném, thông điệp nêu token-github", () => {
    expect(() => goi(`MY${MAU_THU.github}`)).toThrow(/token-github/);
  });
});
