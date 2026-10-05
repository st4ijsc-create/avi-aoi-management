/**
 * doc 81 Đợt 3 final wave (M-2 + Task 0 minor 1, khuyến nghị 2 của final review) — CENSUS: câu "tính năng đang tắt"
 * (mọi khoá i18n có đoạn cuối chứa `flagOff`: toast / banner / tip của cờ tính năng) KHÔNG nêu tên biến môi trường (GC6).
 *
 * Đo trước (2026-10-05, en.json): 15/33 khoá `*flagOff*` nêu tên biến (`Set WORKFORCE_ENABLED=true to act.`, …) — gồm
 * `SafetyWorkforce.tsx:365/368` (workforce/safety), `fleet.flagOffToast`, `fleet.resourceFlagOffToast` mà final review nêu.
 * Lưới cũ chỉ canh `engineering.deployPreview` và khối `progCopilot`.
 *
 * Hai phần, mỗi phần có cầu chì (không xanh trên tập rỗng):
 *  1. LOCALE — mọi giá trị của khoá `*flagOff*` (đệ quy, mọi namespace) ở vi/en/zh.
 *  2. NGUỒN CLIENT — câu dự phòng (đối số thứ hai) của mọi lời gọi `t("<…flagOff…>", "<câu>")` trong client/src (trừ test):
 *     câu dự phòng hiện ra khi thiếu khoá ⇒ cũng là chữ người dùng đọc.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC = resolve(__dirname, "..");
const TEN_BIEN_MOI_TRUONG = /[A-Z][A-Z0-9]+_[A-Z0-9_]+/;
const LA_KHOA_FLAG_OFF = (k: string) => /flagoff/i.test(k.split(".").pop() ?? "");
/** `t("khoa", "câu")` / `t('khoa', \`câu\`)` — khoá có `flagOff` ở đoạn cuối; câu là literal (nhiều dòng được). */
const T_FLAG_OFF = /\bt\(\s*(["'])([\w.]*\.[\w]*[Ff]lagOff\w*)\1\s*,\s*(["'`])((?:\\.|(?!\3)[^\\])*)\3/g;

function locale(l: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(SRC, "i18n/locales", `${l}.json`), "utf8")) as Record<string, unknown>;
}
function khoaFlagOff(o: unknown, duong: string, ra: Array<[string, string]>): void {
  if (typeof o === "string") {
    if (LA_KHOA_FLAG_OFF(duong)) ra.push([duong, o]);
  } else if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o)) khoaFlagOff(v, duong ? `${duong}.${k}` : k, ra);
  }
}
function tepNguon(dir: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(dir)) {
    const p = join(dir, ten);
    if (statSync(p).isDirectory()) {
      if (ten === "node_modules" || ten === "locales") continue;
      tepNguon(p, ra);
    } else if (/\.(ts|tsx)$/.test(ten) && !/\.test\.(ts|tsx)$/.test(ten)) ra.push(p);
  }
  return ra;
}
function duPhongFlagOff(src: string): Array<{ key: string; text: string }> {
  return [...src.matchAll(T_FLAG_OFF)].map((m) => ({ key: m[2], text: m[3] === "`" ? m[4].replace(/\$\{[^}]*\}/g, "") : m[4] }));
}

describe("câu cờ tính năng tắt (*flagOff*) — không tên biến môi trường", () => {
  for (const l of ["vi", "en", "zh"] as const) {
    it(`1. ${l}.json: mọi khoá *flagOff* không nêu tên biến môi trường`, () => {
      const ra: Array<[string, string]> = [];
      khoaFlagOff(locale(l), "", ra);
      expect(ra.length).toBeGreaterThanOrEqual(30); // cầu chì: đo ngày 2026-10-05 thấy 33+ khoá
      const viPham = ra.filter(([, v]) => TEN_BIEN_MOI_TRUONG.test(v)).map(([k, v]) => `${k} = ${JSON.stringify(v)}`);
      expect(viPham, `${l}.json còn tên biến môi trường:\n${viPham.join("\n")}`).toEqual([]);
    });
  }

  it("2. nguồn client: câu dự phòng của t(\"…flagOff…\", …) không nêu tên biến môi trường", () => {
    const hits = tepNguon(SRC).flatMap((p) => duPhongFlagOff(readFileSync(p, "utf8")).map((h) => ({ ...h, p })));
    expect(hits.length).toBeGreaterThanOrEqual(20); // cầu chì: phải đọc được các lời gọi
    // cầu chì: thấy đúng các chỗ final review nêu
    for (const k of ["workforce.flagOffToast", "safety.flagOffToast", "fleet.flagOffToast", "fleet.resourceFlagOffToast"]) {
      expect(hits.some((h) => h.key === k), k).toBe(true);
    }
    const viPham = hits.filter((h) => TEN_BIEN_MOI_TRUONG.test(h.text)).map((h) => `${h.p.slice(SRC.length + 1)}: ${h.key} = ${JSON.stringify(h.text)}`);
    expect(viPham, `còn tên biến môi trường:\n${viPham.join("\n")}`).toEqual([]);
  });

  it("cầu chì: bộ đo bắt câu cũ (một dòng, nhiều dòng, template) và tha khoá không flagOff / câu sạch", () => {
    expect(duPhongFlagOff(`toast.info(t("workforce.flagOffToast", "Workforce is disabled (preview). Set WORKFORCE_ENABLED=true to act."));`)
      .filter((h) => TEN_BIEN_MOI_TRUONG.test(h.text))).toHaveLength(1);
    expect(duPhongFlagOff(`offMessage={t(\n  "field.flagOffBanner",\n  "Preview mode: (FIELD_V2_ENABLED is off).",\n)}`)
      .filter((h) => TEN_BIEN_MOI_TRUONG.test(h.text))).toHaveLength(1);
    expect(duPhongFlagOff("t('ir.flagOffTip', `Enable DPC_IR_V2_ENABLED to ${verb}`)").filter((h) => TEN_BIEN_MOI_TRUONG.test(h.text))).toHaveLength(1);
    expect(duPhongFlagOff(`t("fleet.flagOffToast", \`Fleet is off — ask \${ADMIN_NAME}\`)`).filter((h) => TEN_BIEN_MOI_TRUONG.test(h.text))).toHaveLength(0);
    expect(duPhongFlagOff(`t("fleet.title", "FLEET_ORCH_ENABLED")`)).toHaveLength(0);
    expect(duPhongFlagOff(`t("fleet.flagOffToast", "Fleet orchestration is turned off on the server (preview).")`)
      .filter((h) => TEN_BIEN_MOI_TRUONG.test(h.text))).toHaveLength(0);
    const ra: Array<[string, string]> = [];
    khoaFlagOff({ a: { flagOffToast: "Set X_ENABLED=true", b: { resourceFlagOffBanner: "ok" } }, c: { title: "Y_Z" } }, "", ra);
    expect(ra.map(([k]) => k)).toEqual(["a.flagOffToast", "a.b.resourceFlagOffBanner"]);
  });
});
