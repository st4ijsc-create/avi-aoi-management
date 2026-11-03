/**
 * Dọn vệ sinh (E0-3 · F0-2 · Q0-1) — router đã GỠ không được quay lại, và router còn sống có người gọi THẬT không bị gỡ nhầm.
 * Bằng chứng "0 client-caller" là bản đồ AST `scripts/pha0/ban-do-client-goi.mjs` (không grep thô; đếm cả truy cập động trên trpc/utils).
 * Kiểm định chạy lại: `node scripts/pha0/ban-do-client-goi.mjs <tên>`.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");

/** Router/namespace đã gỡ khỏi `appRouter` ở lô A — không có tệp, không có khoá. */
const DA_GO = ["monteCarloFlow", "simTargets", "kbVector", "aiVisionLanguage", "aiSmartAlertRouting", "ntfClassifier", "inspectionVariant", "mpVariantSubform", "thresholdSuggestion"] as const;

/** Router mà kế hoạch gọi là "chết" nhưng AST thấy người gọi thật ⇒ chủ dự án giữ nguyên (dieu-phoi, 2026-11-04). */
const GIU_CO_NGUOI_GOI: Record<string, string> = {
  orchestrationGov: "client/src/pages/SynapsePlatformPage.tsx",
  twinGov: "client/src/pages/SynapsePlatformPage.tsx",
};

type KetQua = { muc: string; goi: Array<{ loai: string; vt: string }>; dong: Array<{ loai: string }> };
function banDo(...muc: string[]): KetQua[] {
  const ra = execFileSync(process.execPath, ["scripts/pha0/ban-do-client-goi.mjs", "--json", ...muc], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(ra) as KetQua[];
}

describe("Dọn vệ sinh — router đã gỡ không quay lại", () => {
  const routersTs = fs.readFileSync(path.join(ROOT, "server/routers.ts"), "utf8");
  for (const n of DA_GO) {
    it(`${n}: không còn khoá trong appRouter, không còn tệp router`, () => {
      expect(new RegExp(`^\\s*${n}\\s*:`, "m").test(routersTs), `routers.ts vẫn khai ${n}`).toBe(false);
      expect(fs.existsSync(path.join(ROOT, "server/routers", `${n}Router.ts`)), `${n}Router.ts còn`).toBe(false);
    });
  }
  it("aiVision.language (đường con) đã gỡ khỏi aiVisionRouter", () => {
    const s = fs.readFileSync(path.join(ROOT, "server/routers/aiVisionRouter.ts"), "utf8");
    expect(/^\s*language\s*:/m.test(s)).toBe(false);
  });
});

describe("Dọn vệ sinh — bản đồ AST: không client nào gọi tên đã gỡ; router giữ lại có người gọi thật", () => {
  it("★ 0 lời gọi AST ngoài test + 0 truy cập động trpc/utils ngoài test cho mọi router đã gỡ", () => {
    const kq = banDo(...DA_GO, "aiVision.language");
    const vi = kq.flatMap((k) => k.goi.filter((x) => x.loai !== "test").map((x) => `${k.muc} @ ${x.vt}`));
    expect(vi).toEqual([]);
    const dong = kq.flatMap((k) => k.dong.filter((x) => x.loai !== "test").map(() => k.muc));
    expect(dong).toEqual([]);
  }, 180_000);

  it("★ orchestrationGov / twinGov CÓ người gọi thật ở trang định tuyến — gỡ chúng là việc của chủ dự án (giai đoạn 4, P5), không phải của lô này", () => {
    const kq = banDo(...Object.keys(GIU_CO_NGUOI_GOI));
    for (const k of kq) {
      const dsClient = k.goi.filter((x) => x.loai === "client").map((x) => x.vt.split(":")[0]);
      expect(dsClient, k.muc).toContain(GIU_CO_NGUOI_GOI[k.muc]);
    }
    expect(fs.readFileSync(path.join(ROOT, "server/routers.ts"), "utf8")).toMatch(/^\s*orchestrationGov\s*:/m);
    expect(fs.readFileSync(path.join(ROOT, "server/routers.ts"), "utf8")).toMatch(/^\s*twinGov\s*:/m);
  }, 180_000);
});
