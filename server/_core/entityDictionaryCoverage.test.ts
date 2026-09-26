/**
 * F3 — mọi `entity` truyền cho `appError(..., "ENTITY_NOT_FOUND", { entity })` PHẢI có
 * khoá `errors.entity.<entity>` ở CẢ BA locale.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ LỚP LỖI NÀY DO CHÍNH ĐỢT DI TRÚ F3 TẠO RA
 * ══════════════════════════════════════════════════════════════════════════════════
 * Câu hiện ra cho người dùng là `errors.ENTITY_NOT_FOUND` = "Không tìm thấy {{entity}}."
 * `localizeParams()` phía client tra `{{entity}}` qua từ điển `errors.entity.*`. Khi
 * khoá thiếu, nó trả **chuỗi thô** — nên người dùng Việt đọc *"Không tìm thấy
 * programDeployment."* và người dùng Trung đọc *"未找到 programDeployment。"*.
 *
 * Không lỗi, không cảnh báo, tsc xanh, mọi cổng khác xanh. Chỉ chỗ này thấy được.
 *
 * ⚠ Và đây là cái bẫy tinh vi hơn: luật máy móc *"lấy từ đầu câu làm tên thực thể"*
 * sinh ra `model` / `deployment` / `experiment` — trong khi từ điển ĐÃ CÓ `aiModel`,
 * `edgeDeployment`, `abTestExperiment`. Nếu lúc đó cứ thế thêm ba khoá mới, từ điển sẽ
 * có hai từ cho cùng một vật và không cổng nào phát hiện được. Vì thế đợt di trú ánh
 * xạ theo (FILE, CÂU) đích danh chứ không theo mặt chữ — xem `scripts` báo cáo lô 4.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = resolve(SERVER, "..", "client", "src", "i18n", "locales");

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkTs(full));
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(full);
  }
  return out;
}

function flatten(obj: unknown, prefix = "", out: Record<string, unknown> = {}) {
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}
const doc = (lg: string) => flatten(JSON.parse(readFileSync(join(LOCALES, `${lg}.json`), "utf8")));

/** Mọi `{ entity: "..." }` truyền cho appError trong toàn `server/**`. */
function entityDaDung(): Array<{ file: string; entity: string }> {
  const out: Array<{ file: string; entity: string }> = [];
  for (const file of walkTs(SERVER)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/appError\([^)]*?\{\s*entity:\s*["']([a-zA-Z][a-zA-Z0-9_]*)["']/g)) {
      out.push({ file: file.replace(SERVER, "").split("\\").join("/"), entity: m[1] });
    }
  }
  return out;
}

describe("F3 — từ điển `errors.entity.*` phải phủ mọi entity server truyền đi", () => {
  it("cầu chì: phép quét phải THẤY entity, không thì nó đang canh tập rỗng", () => {
    // Thiếu bước này, khẳng định dưới đây đúng một cách vô nghĩa (∀ trên tập rỗng) —
    // đúng lớp lỗi đã trả giá ở Pha 4 (glob rỗng ⇒ vitest im lặng, cổng khai xanh).
    expect(entityDaDung().length).toBeGreaterThan(50);
  });

  it("★★★ MỌI entity phải có khoá ở vi, en VÀ zh — thiếu là người dùng đọc chữ THÔ", () => {
    const vi = doc("vi"), en = doc("en"), zh = doc("zh");
    const thieu = [...new Set(entityDaDung().map((x) => x.entity))]
      .filter((e) => {
        const k = `errors.entity.${e}`;
        return vi[k] === undefined || en[k] === undefined || zh[k] === undefined;
      })
      .sort();
    if (thieu.length) {
      console.error("[F3] entity KHÔNG có trong từ điển:", thieu);
    }
    expect(thieu).toEqual([]);
  });

  it("từ điển vi/en/zh phải cân nhau — một nhánh lệch là một ngôn ngữ đọc chữ thô", () => {
    const vi = doc("vi"), en = doc("en"), zh = doc("zh");
    const ks = (d: Record<string, unknown>) =>
      Object.keys(d).filter((k) => k.startsWith("errors.entity.")).sort();
    expect(ks(en)).toEqual(ks(vi));
    expect(ks(zh)).toEqual(ks(vi));
  });
});
