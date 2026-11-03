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

type KetQua = { muc: string; goi: Array<{ loai: string; vt: string }>; dong: Array<{ loai: string }>; chuoi: Array<{ loai: string; vt: string; tr: string }> };
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
    // ★ kiểm định P5: đường /api/trpc/<router>.<proc>, mảng đường dẫn, fetch thô — chuỗi ký tự mang tên router (có "." + thủ tục, hoặc đúng bằng tên) ngoài test = 0.
    //   Bỏ đuôi tệp (aiVisionLanguage.ts) và chuỗi nhật ký "[tên] …" (service giữ).
    const chuoi = kq.flatMap((k) => k.chuoi.filter((x) => x.loai !== "test")
      .filter((x) => {
        const ten = k.muc.replace(/\./g, "\\.");
        return new RegExp("(^|[^A-Za-z0-9_])" + ten + "\\.(?!(?:tsx?|mjs|cjs|js)\\b)[A-Za-z]").test(x.tr) || new RegExp("^" + ten + "$").test(x.tr.trim());
      })
      .map((x) => k.muc + " @ " + x.vt + " \"" + x.tr + "\""));
    expect(chuoi).toEqual([]);
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

describe("Dọn vệ sinh lô B — trang/thành phần client mồ côi và bộ phát giả lập DB đã gỡ không quay lại", () => {
  const doc = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const DA_XOA = [
    "client/src/pages/SPCAdvanced.tsx", "client/src/pages/AnnotationStatistics.tsx", "client/src/pages/AnalyticsSettings.tsx",
    "client/src/components/ImageAnnotation.tsx", "client/src/components/ImageComparison.tsx", "client/src/components/BatchImageExport.tsx",
    "client/src/components/ProductMachineMappingContent.tsx", "client/src/components/AIAnnotationAssistant.tsx", "client/src/components/AnnotationExportImport.tsx",
    "client/src/components/AnnotationTemplates.tsx", "client/src/components/AnnotationVersionHistory.tsx", "client/src/components/HistoryBatchOperations.tsx",
    "scripts/sim-factory/sim-live-daemon.mjs", "server/services/simOtTelemetryService.ts",
  ];
  for (const f of DA_XOA) it(`${f}: không còn`, () => expect(fs.existsSync(path.join(ROOT, f))).toBe(false));
  it("App.tsx không còn khai AnalyticsSettings; index.ts không còn gọi bộ phát telemetry giả; package.json không còn sim:live", () => {
    expect(doc("client/src/App.tsx")).not.toMatch(/AnalyticsSettings/);
    expect(doc("server/_core/index.ts")).not.toMatch(/simOtTelemetry|startSimOtTelemetry/);
    expect(doc("package.json")).not.toMatch(/sim-live-daemon|"sim:live"/);
    // E0-1: lịch quét twinFidelity (ghi simulation_runs mỗi giờ, 80 941 hàng, fidelity 0 %) đã gỡ; kiểm tay `twinGov.runFidelityCheck` vẫn còn.
    expect(doc("server/_core/backgroundJobs.ts")).not.toMatch(/startTwinFidelitySweep/);
  });
});
