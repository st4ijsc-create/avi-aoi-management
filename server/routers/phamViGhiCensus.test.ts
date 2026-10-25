/**
 * ★★★ 2026-10-24 — **CỔNG ĐIỀU TRA DÂN SỐ PHẠM VI GHI** (anh em của `phamViDocCensus.test.ts`, vế MUTATION).
 *
 * `phamViDocCensus` canh `.query` (nhóm A) và xếp ~1.198 `.mutation` vào nhóm D "không ai canh". File này canh nhóm D:
 *
 *     ∀ `.mutation` dưới `server/**` có `.input(...)` mang khoá định danh thực thể (id · machineId · stationId · lineId · factoryId ·
 *     adapterId · robotId · serial · lotId · orderId …): chuỗi gọi của nó phải với tới một bộ phân giải phạm vi
 *     (phamViCua · idsTrongPhamVi · adapterTrongPhamVi · mayTrongPhamVi · assert*InScope · trongPhamVi …) — HOẶC có tên trong
 *     sổ nợ `phamViGhiBaseline.ts` (chỉ được co lại).
 *
 * ⚠⚠ CỔNG XANH KHÔNG CHỨNG MINH KHÔNG CÒN LỖ GHI. Nó chứng minh: (1) bề mặt đã ĐẾM; (2) nợ KHÔNG PHÌNH; (3) vị từ BẮT ĐƯỢC hình
 * dạng lỗ (§6, ghi đè tệp ảo — không có tệp thử vật lý). Con số THẬT của lỗ nằm ở `phamViGhiDo.db.test.ts` (đo ĐỎ trên CSDL).
 * "Có cổng" là bằng chứng THEO TÊN, không chứng minh cổng áp lên đúng khoá nhận được; đọc header `phamViGhiScan.ts`.
 */
import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { quetPhamViGhi, laNoGhi, laSanToanQuyen, laKhoaDinhDanh, type MutationGhi } from "./phamViGhiScan";
import { quetPhamViDoc, nhomCua } from "./phamViDocScan";
import { MIEN_TRU_GHI, NO_PHAM_VI_GHI } from "./phamViGhiBaseline";

const GOC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const QUET = quetPhamViGhi(GOC);
const NO = QUET.mutation.filter(laNoGhi);
const SO = new Set(NO_PHAM_VI_GHI);
const MIEN = new Set(Object.keys(MIEN_TRU_GHI));

/** Ghim (đo 2026-10-24). Đổi một số là một LỜI KHAI: mutation mới ⇒ +tổng; trả nợ ⇒ −nợ (và xoá dòng sổ). */
const GHIM = { tongMutation: 1198, no: 159 } as const; // W17a: reportArtifact.delete có cổng phạm vi thật (gỡ miễn trừ) 160 → 159; // W17: abTest ×2 sổ → miễn trừ (router không mount) — tổng nợ không đổi, sổ 5 → 3; // 2026-10-25 gộp L6a (167) + W16 (kho vật tư + quy tắc leo thang theo nhà máy, mig 0424/0425: alertEscalation ×4 + mesControlTower ×3 có khoá thật) −7 ⇒ 160, đo bằng census

describe("§1 bộ quét không mù", () => {
  it("không có ô mù và duyệt đủ file", () => {
    expect(QUET.mu).toEqual([]);
    expect(QUET.soFileDuyet).toBeGreaterThan(300);
  });
  it("tổng mutation khớp nhóm D của phamViDoc (hai bộ quét độc lập cùng đếm một bề mặt)", () => {
    const d = quetPhamViDoc(GOC).thuTuc.filter((t) => nhomCua(t) === "D").length;
    expect(QUET.mutation.length).toBe(d);
  });
  it("khoá sổ nợ duy nhất — không có hai mutation trùng khoá (file#đườngRouter.tên)", () => {
    expect(new Set(QUET.mutation.map((m) => m.khoa)).size).toBe(QUET.mutation.length);
    expect(new Set(NO_PHAM_VI_GHI).size).toBe(NO_PHAM_VI_GHI.length);
  });
});

describe("§2 con số ghim", () => {
  it(`tổng ${GHIM.tongMutation} · nợ ${GHIM.no}`, () => {
    expect({ tong: QUET.mutation.length, no: NO.length, sổ: NO_PHAM_VI_GHI.length }).toEqual({
      tong: GHIM.tongMutation,
      no: GHIM.no,
      sổ: GHIM.no - MIEN.size,
    });
  });
  it("in nợ theo bậc (để không ai quên)", () => {
    const bac = (b: string): number => NO.filter((m) => m.bac === b).length;
    // eslint-disable-next-line no-console
    console.info(`[phamViGhi] nợ ${NO.length}/${QUET.mutation.length}: điều khiển ${bac("dieu-khien")} · sản xuất ${bac("san-xuat")} · cấu hình ${bac("cau-hinh")}`);
    expect(NO.length).toBeGreaterThan(0);
  });
});

describe("§4 mutation MỚI nhận khoá định danh mà không có cổng ⇒ ĐỎ", () => {
  it("không mutation nợ nào ngoài sổ", () => {
    const moi = NO.map((m) => m.khoa).filter((k) => !SO.has(k) && !MIEN.has(k));
    expect(moi, `mutation mới nhận khoá định danh mà không qua bộ phân giải phạm vi:\n${moi.join("\n")}`).toEqual([]);
  });
});

describe("§5 mục đã vá mà quên gỡ khỏi sổ ⇒ ĐỎ (chống sổ hoá thạch)", () => {
  it("mọi dòng sổ vẫn là nợ thật", () => {
    const nay = new Set(NO.map((m) => m.khoa));
    const ma = NO_PHAM_VI_GHI.filter((k) => !nay.has(k));
    expect(ma, `đã có cổng / đã xoá / đã đổi tên — gỡ dòng khỏi phamViGhiBaseline.ts:\n${ma.join("\n")}`).toEqual([]);
  });
});

describe("§5b miễn trừ có lý do — không hoá thạch, không trùng sổ nợ", () => {
  it("mỗi mục miễn trừ: có lý do, vẫn khớp hình dạng nợ, không nằm trong sổ nợ", () => {
    const nay = new Set(NO.map((m) => m.khoa));
    const loi = Object.entries(MIEN_TRU_GHI).flatMap(([k, ly]) => [
      ...(ly.trim().length < 20 ? [`${k}: lý do quá ngắn`] : []),
      ...(!nay.has(k) ? [`${k}: không còn khớp hình dạng nợ (đã có cổng / đổi tên) — gỡ miễn trừ`] : []),
      ...(SO.has(k) ? [`${k}: nằm cả trong sổ nợ`] : []),
    ]);
    expect(loi).toEqual([]);
  });
});

describe("§5d router TẮT (không mount) được miễn trừ — bật lại mà chưa có cổng ⇒ ĐỎ", () => {
  it("aiAdvanced không gắn training / abTest / edge (ngày gắn lại: thêm cổng phạm vi cho thủ tục ghi, rồi gỡ miễn trừ abTest)", async () => {
    const { aiAdvancedRouter } = await import("./aiAdvancedRouter");
    const duongDan = Object.keys((aiAdvancedRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures);
    expect(duongDan.length).toBeGreaterThan(0); // cầu chì: đọc được bảng thủ tục thật
    expect(duongDan.filter((d) => /^(training|abTest|edge)./.test(d))).toEqual([]);
  });
});

describe("§5c tiền đề của quy tắc 'sàn admin không phải nợ'", () => {
  it("phạm vi của admin là TOÀN QUYỀN (factoryIds null) — nếu đổi, quy tắc laSanToanQuyen mất hiệu lực", async () => {
    const { resolveTenantFactoryScope } = await import("../db/reportAggregators");
    expect((await resolveTenantFactoryScope({ userId: 1, userRole: "admin" })).factoryIds).toBeNull();
  });
  it("không mutation sàn admin nào nằm trong sổ nợ (chúng không còn là nợ)", () => {
    const admin = QUET.mutation.filter((m) => laSanToanQuyen(m) && SO.has(m.khoa)).map((m) => m.khoa);
    expect(admin).toEqual([]);
  });
});

describe("§6 vị từ bắt được hình dạng lỗ (tệp ảo, không ghi đĩa)", () => {
  const T = "server/routers/zzGhiAo.ts";
  const khung = (than: string, input = "z.object({ machineId: z.number().int() })"): string => `
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { phamViCua } from "../db/phamVi";
import { machines } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
async function kiemTraTrongPhamVi(ctx: any, id: number) { await phamViCua(ctx.user); return id; }
export const zzGhiAoRouter = router({
  doi: protectedProcedure.use(requirePermission("machine_control", "canEdit")).input(${input}).mutation(async ({ input, ctx }) => {
    ${than}
  }),
});`;
  const tim = (src: string): MutationGhi | undefined => quetPhamViGhi(GOC, { [T]: src }).mutation.find((m) => m.file === T);

  it("ghi theo machineId mà không có cổng ⇒ nợ", () => {
    const m = tim(khung("const d: any = null; await d.update(machines).set({ name: 'x' }).where(eq(machines.id, input.machineId));"));
    expect(m, "không thấy mutation ảo").toBeDefined();
    expect(m!.khoaDinhDanh).toContain("machineId");
    expect(laNoGhi(m!)).toBe(true);
  });
  it("cùng mutation nhưng gọi bộ phân giải phạm vi ⇒ KHÔNG còn là nợ", () => {
    const m = tim(khung("await kiemTraTrongPhamVi(ctx, input.machineId); const d: any = null; await d.update(machines).set({ name: 'x' }).where(eq(machines.id, input.machineId));"));
    expect(m).toBeDefined();
    expect(m!.coCong).toBe(true);
    expect(laNoGhi(m!)).toBe(false);
  });
  it("mutation không nhận khoá định danh (chỉ chuỗi) ⇒ không vào sổ", () => {
    const m = tim(khung("const d: any = null; await d.update(machines).set({ name: input.ghiChu });", "z.object({ ghiChu: z.string() })"));
    expect(m).toBeDefined();
    expect(laNoGhi(m!)).toBe(false);
  });
  it("tệp ảo làm tổng mutation tăng đúng 1 và là nợ MỚI ngoài sổ (đúng đường §4 sẽ đỏ)", () => {
    const r = quetPhamViGhi(GOC, { [T]: khung("const d: any = null; await d.delete(machines).where(eq(machines.id, input.machineId));") });
    expect(r.mutation.length).toBe(QUET.mutation.length + 1);
    const moi = r.mutation.filter(laNoGhi).map((m) => m.khoa).filter((k) => !SO.has(k) && !MIEN.has(k));
    expect(moi).toEqual([`${T}#zzGhiAoRouter.doi`]);
  });
  it("hàm dẫn xuất tới cổng mà phạm vi là tham số TUỲ CHỌN: gọi KHÔNG truyền danh tính ⇒ vẫn là nợ; truyền ctx ⇒ có cổng", () => {
    const hamLay = "async function layMay(id: number, scope?: unknown) { if (scope) await mayTrongPhamVi(scope as never, id); return id; }";
    const kh = (g: string) => khung(g).replace("export const zzGhiAoRouter", hamLay + "\nexport const zzGhiAoRouter").replace("import { phamViCua }", "import { mayTrongPhamVi } from \"./_adapterPhamVi\";\nimport { phamViCua }");
    const ghi = "const d: any = null; await d.update(machines).set({ name: 'x' }).where(eq(machines.id, input.machineId));";
    const khong = tim(kh("await layMay(input.machineId); " + ghi));
    const co = tim(kh("await layMay(input.machineId, ctx); " + ghi));
    expect({ khong: laNoGhi(khong!), co: laNoGhi(co!) }).toEqual({ khong: true, co: false });
  });
  it(".input(<hằng schema cấp file>) — đối số là một ĐỊNH DANH — vẫn phân giải ra khoá (trước đây coi \"không khoá\")", () => {
    const src = khung("const d: any = null; await d.delete(machines).where(eq(machines.id, input.machineId));").replace(
      ".input(z.object({ machineId: z.number().int() }))",
      ".input(idIn)",
    ).replace("export const zzGhiAoRouter", "const idIn = z.object({ machineId: z.number().int() });\nexport const zzGhiAoRouter");
    const m = tim(src);
    expect(m!.khoaDinhDanh).toContain("machineId");
    expect(laNoGhi(m!)).toBe(true);
  });
  it("laKhoaDinhDanh: thực thể có; người thực hiện / siêu dữ liệu không", () => {
    for (const k of ["id", "machineId", "stationId", "lineId", "factoryId", "adapterId", "robotId", "serialNumber", "lotId", "orderId"]) expect(laKhoaDinhDanh(k), k).toBe(true);
    for (const k of ["userId", "actorId", "createdBy", "note", "name", "limit"]) expect(laKhoaDinhDanh(k), k).toBe(false);
  });
});
