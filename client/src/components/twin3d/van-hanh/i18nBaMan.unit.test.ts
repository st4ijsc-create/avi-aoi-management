/**
 * ★★★ ĐỢT 36 (Pareto #8) — LƯỚI i18n CHO BA MÀN TWIN 3D: mọi khoá `twin3d.*` mà MÃ tham chiếu
 * phải CÓ ở cả ba locale, và bản en/zh KHÔNG được chứa chữ Việt có dấu.
 *
 * ── VÌ SAO CẦN THÊM LƯỚI NÀY khi đã có `npm run i18n:check` + `viStringCoverage` ──
 *   · `i18n:check` KHÔNG chạy trong `vitest` (là script rời) và MÙ với khoá MẪU
 *     `t(\`twin3d.coCheGiao.${coChe}.nhan\`)` — đo Đợt 36: 10 khoá `coCheGiao` vắng cả ba locale suốt
 *     nhiều đợt mà cổng ấy xanh; người dùng en/zh thấy "đẩy + hỏi 30s" trên `/twin`.
 *   · `viStringCoverage` chỉ so vi↔en/zh THEO FILE — một khoá vắng CẢ BA là vô hình với nó.
 *   · i18next trả `defaultValue` (tiếng Việt) khi khoá vắng ⇒ không lỗi, không cảnh báo: QA Đợt 32
 *     đo "Sức khoẻ 61 % · cảnh báo" cạnh "Unknown" trên cùng màn en. Lớp lỗi này cần một cổng đo
 *     KẾT CỤC ở tầng dữ liệu dịch, chạy cùng `vitest run twin`.
 *
 * ── CÁCH ĐO ──
 *   (1) quét `t("twin3d.…"` tĩnh + tiền tố mẫu `t(\`twin3d.…` trong 4 trang Twin* + toàn bộ
 *       `components/twin3d/**` (không test) ⇒ tập khoá MÃ DÙNG (không phải khoá CÓ TRONG FILE — lỗ (1)
 *       của I-1);
 *   (2) khoá tĩnh: `flat[locale][key]` phải là chuỗi ở cả ba;
 *   (3) tiền tố mẫu: đối tượng ở đường dẫn ấy phải tồn tại và không rỗng ở cả ba; riêng `coCheGiao`
 *       liệt kê đủ 5 cơ chế × {nhan, moTa} (danh sách lấy từ `defaultValue` trong TwinVanHanh);
 *   (4) en/zh của mọi khoá `twin3d.*` KHÔNG chứa dấu tiếng Việt (bắt lỗi chép vi sang en/zh);
 *   (5) số nhiều en: `soMayNgan_one/_other`, `kpiNoi.mauSo_one/_other`, `daiHopNhat.tomTat_one/_other`.
 *
 * ⚠ KHÔNG có ngân sách/nền: một khoá thiếu là ĐỎ. Thêm `t("twin3d.x")` mới thì thêm khoá vào ba locale.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GOC = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const LOCALES = ["en", "vi", "zh"] as const;

function quetTep(dir: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(dir)) {
    const p = join(dir, ten);
    if (statSync(p).isDirectory()) quetTep(p, ra);
    else if (/\.(ts|tsx)$/.test(ten) && !/\.test\.tsx?$/.test(ten)) ra.push(p);
  }
  return ra;
}

const TEP = [
  ...["TwinVanHanh", "TwinLine", "TwinMay", "TwinStudio"].map((t) => resolve(GOC, `pages/${t}.tsx`)),
  ...quetTep(resolve(GOC, "components/twin3d")),
];

const khoaTinh = new Set<string>();
const tienToMau = new Set<string>();
for (const f of TEP) {
  const s = readFileSync(f, "utf8");
  for (const m of s.matchAll(/\bt\(\s*"(twin3d\.[A-Za-z0-9_.]+)"/g)) khoaTinh.add(m[1]);
  for (const m of s.matchAll(/\bt\(\s*`(twin3d\.[A-Za-z0-9_.]*)\$\{/g)) tienToMau.add(m[1].replace(/\.$/, ""));
}

const doc = (l: string) => JSON.parse(readFileSync(resolve(GOC, `i18n/locales/${l}.json`), "utf8")) as Record<string, unknown>;
const J = Object.fromEntries(LOCALES.map((l) => [l, doc(l)])) as Record<(typeof LOCALES)[number], Record<string, unknown>>;
const lay = (o: unknown, duong: string): unknown => duong.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Record<string, unknown>)[k] : undefined), o);
const RE_VI = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
const laLa = (o: unknown, p = ""): string[] => (o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => laLa(v, p ? `${p}.${k}` : k)) : [p]);

describe("★★★ Đợt 36 — lưới i18n ba màn twin3d (khoá MÃ DÙNG phải có ở en/vi/zh)", () => {
  it("bộ quét thấy được khoá — KHÔNG đo trên tập rỗng (G5): ≥ 300 khoá tĩnh, ≥ 5 tiền tố mẫu, có `twin3d.line.veNhaMay` và `twin3d.coCheGiao`", () => {
    expect(khoaTinh.size).toBeGreaterThanOrEqual(300);
    expect(tienToMau.size).toBeGreaterThanOrEqual(5);
    expect(khoaTinh.has("twin3d.line.veNhaMay")).toBe(true);
    expect(khoaTinh.has("twin3d.may.hang.nguyKich")).toBe(true);
    expect(tienToMau.has("twin3d.coCheGiao")).toBe(true);
  });

  it("mọi khoá tĩnh `t(\"twin3d.…\")` là chuỗi ở CẢ BA locale — 0 khoá thiếu (trước Đợt 36: 43 thiếu cả ba)", () => {
    const thieu: string[] = [];
    for (const k of [...khoaTinh].sort()) for (const l of LOCALES) if (typeof lay(J[l], k) !== "string") thieu.push(`${l}:${k}`);
    expect(thieu).toEqual([]);
  });

  it("mọi tiền tố mẫu `t(`twin3d.…${…}`)` trỏ tới một NHÓM có mặt và không rỗng ở cả ba locale", () => {
    const thieu: string[] = [];
    for (const p of [...tienToMau].sort()) for (const l of LOCALES) { const o = lay(J[l], p); if (!o || typeof o !== "object" || Object.keys(o).length === 0) thieu.push(`${l}:${p}`); }
    expect(thieu).toEqual([]);
  });

  it("`twin3d.coCheGiao`: đủ 5 cơ chế × {nhan, moTa} ở cả ba locale (khoá mẫu mà `i18n:check` mù)", () => {
    const CO_CHE = ["day", "hon_hop", "hoi", "lich_su", "chua_ro"];
    for (const l of LOCALES) for (const c of CO_CHE) for (const o of ["nhan", "moTa"]) expect(typeof lay(J[l], `twin3d.coCheGiao.${c}.${o}`), `${l}:${c}.${o}`).toBe("string");
  });

  it("en/zh của MỌI khoá `twin3d.*` không chứa chữ Việt có dấu (chép vi sang en/zh = lỗi câm cùng lớp)", () => {
    const xau: string[] = [];
    for (const l of ["en", "zh"] as const) for (const k of laLa(J[l].twin3d, "twin3d")) { const v = lay(J[l], k); if (typeof v === "string" && RE_VI.test(v)) xau.push(`${l}:${k}=${v.slice(0, 40)}`); }
    expect(xau).toEqual([]);
  });

  it("số nhiều en (I4): `soMayNgan`, `kpiNoi.mauSo`, `daiHopNhat.tomTat` có `_one`/`_other`; `_one` không có 's' cuối", () => {
    for (const k of ["twin3d.vanHanh.soMayNgan", "twin3d.kpiNoi.mauSo", "twin3d.daiHopNhat.tomTat"]) {
      const mot = lay(J.en, `${k}_one`); const nhieu = lay(J.en, `${k}_other`);
      expect(typeof mot, `${k}_one`).toBe("string");
      expect(typeof nhieu, `${k}_other`).toBe("string");
      // Danh từ đếm được ở dạng SỐ ÍT trong `_one`, SỐ NHIỀU trong `_other` ("1 machine" / "2 machines", "1 thing" / "2 things").
      expect(mot as string).toMatch(/\b(machine|thing)\b/);
      expect(mot as string).not.toMatch(/\b(machines|things)\b/);
      expect(nhieu as string).toMatch(/\b(machines|things)\b/);
    }
  });

  it("chỗ gọi truyền `count` — không có `count` thì `_one/_other` là khoá chết", () => {
    const daiLine = readFileSync(resolve(GOC, "components/twin3d/van-hanh/DaiLine.tsx"), "utf8");
    const kpi = readFileSync(resolve(GOC, "components/twin3d/van-hanh/BangKpiNoi.tsx"), "utf8");
    const dai = readFileSync(resolve(GOC, "components/twin3d/bo-cuc/DaiHopNhat.tsx"), "utf8");
    expect(daiLine).toMatch(/t\("twin3d\.vanHanh\.soMayNgan",[\s\S]{0,120}count: s\.soMay/);
    expect(kpi).toMatch(/t\("twin3d\.kpiNoi\.mauSo",[\s\S]{0,200}count: kpi\.mauSo/);
    expect(dai).toMatch(/t\("twin3d\.daiHopNhat\.tomTat",[\s\S]{0,120}count: so/);
  });
});
