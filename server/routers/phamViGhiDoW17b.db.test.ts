/**
 * ★★★ Lô W17b — SÀN QUYỀN GHI của cấu hình / danh mục TOÀN CỤC được miễn trừ trong sổ phamViGhi (kiểm định 2026-10-25).
 * Các miễn trừ ấy nói "dùng chung toàn tập đoàn, giữ bằng quyền module / vai". Test này CHỨNG MINH phần "giữ bằng quyền": người vai thấp (operator) và
 * giám sát viên KHÔNG có hàng quyền module nào gọi từng thủ tục ghi ⇒ bị từ chối (FORBIDDEN) TRƯỚC khi chạm dữ liệu.
 * Ngoại lệ có chủ ý (qualityProcedure = admin · supervisor · quality_inspector): mẫu cổng chất lượng tuỳ biến + danh mục lỗi — giám sát viên QUA sàn vai
 * (chủ dự án duyệt 2026-10-24: danh mục dùng chung); operator vẫn bị chặn.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const RUN = `pw22${process.pid}${Date.now().toString(36)}`;
let op!: { id: number; name: string };
let sup!: { id: number; name: string };
const ctxOf = (u: { id: number; name: string }, role: string) => ({ user: { id: u.id, role, name: u.name, openId: u.name, twoFactorEnabled: true } }) as never;

async function goi(router: unknown, duong: string, ctx: never, vao: unknown): Promise<string> {
  let cur: unknown = (router as { createCaller: (c: never) => unknown }).createCaller(ctx);
  for (const p of duong.split(".")) cur = (cur as Record<string, unknown>)?.[p];
  if (typeof cur !== "function") return "KHONG_CO_HAM";
  try {
    await (cur as (i: unknown) => Promise<unknown>)(vao);
    return "THANH_CONG";
  } catch (e) {
    return String((e as { code?: string }).code ?? "LOI_LA");
  }
}

beforeAll(async () => {
  op = await taoNguoiDungTest("op", "operator", { tienTo: "pw22", ts: RUN, ten: "PW22 op" });
  sup = await taoNguoiDungTest("sup", "supervisor", { tienTo: "pw22", ts: RUN, ten: "PW22 sup" });
}, 60_000);

// [mô-đun, đường thủ tục, đầu vào hợp lệ tối thiểu]
const E = {};
type Ca = [() => Promise<unknown>, string, unknown];
const nhomChat = (): Ca[] => [
  [async () => (await import("./componentLibraryRouter")).componentLibraryRouter, "packages.update", E],
  [async () => (await import("./componentLibraryRouter")).componentLibraryRouter, "packages.delete", E],
  [async () => (await import("./componentLibraryRouter")).componentLibraryRouter, "packages.restore", E],
  [async () => (await import("./componentLibraryRouter")).componentLibraryRouter, "footprints.create", E],
  [async () => (await import("./componentLibraryRouter")).componentLibraryRouter, "footprints.update", E],
  [async () => (await import("./componentLibraryRouter")).componentLibraryRouter, "footprints.delete", E],
  [async () => (await import("./componentLibraryRouter")).componentLibraryRouter, "linkMaterial", E],
  [async () => (await import("./causalGraphRouter")).causalGraphRouter, "addNode", E],
  [async () => (await import("./causalGraphRouter")).causalGraphRouter, "updateNode", E],
  [async () => (await import("./causalGraphRouter")).causalGraphRouter, "deleteNode", E],
  [async () => (await import("./causalGraphRouter")).causalGraphRouter, "replaceGraph", E],
  [async () => (await import("./aiModelRouter")).aiModelRouter, "createCard", E],
  [async () => (await import("./aiModelRouter")).aiModelRouter, "updateCard", E],
  [async () => (await import("./aiModelRouter")).aiModelRouter, "approveCard", E],
  [async () => (await import("./processRouter")).processRouter, "update", E],
  [async () => (await import("./processRouter")).processRouter, "delete", E],
  [async () => (await import("./processRouter")).processRouter, "reorder", E],
  [async () => (await import("./alertRouters")).yieldThresholdRouter, "update", E],
  [async () => (await import("./alertRouters")).yieldThresholdRouter, "updateWithHistory", E],
  [async () => (await import("./mqttOeeRouters")).mqttAlertRouter, "update", E],
  [async () => (await import("./mqttOeeRouters")).mqttAlertRouter, "delete", E],
  [async () => (await import("./mqttOeeRouters")).mqttAlertRouter, "toggle", E],
  // masterData: các router con
  [async () => (await import("./masterDataRouter")).masterDataRouter, "skills.update", E],
  [async () => (await import("./masterDataRouter")).masterDataRouter, "skills.delete", E],
  [async () => (await import("./masterDataRouter")).masterDataRouter, "uom.update", E],
  [async () => (await import("./masterDataRouter")).masterDataRouter, "uom.delete", E],
  [async () => (await import("./masterDataRouter")).masterDataRouter, "uom.updateConversion", E],
  [async () => (await import("./masterDataRouter")).masterDataRouter, "uom.deleteConversion", E],
  [async () => (await import("./masterDataRouter")).masterDataRouter, "materials.updateClass", E],
  [async () => (await import("./masterDataRouter")).masterDataRouter, "materials.deleteClass", E],
  // webhook: sàn admin nằm TRONG thân (sau zod) ⇒ cần đầu vào hợp lệ
  [async () => (await import("./webhookRouter")).webhookRouter, "update", { id: 1, name: "x" }],
  [async () => (await import("./webhookRouter")).webhookRouter, "delete", { id: 1 }],
  [async () => (await import("./webhookRouter")).webhookRouter, "test", { id: 1 }],
  [async () => (await import("./webhookRouter")).webhookRouter, "toggle", { id: 1, isEnabled: true }],
  [async () => (await import("./webhookRouter")).webhookRouter, "clearLogs", { webhookId: 1 }],
];

describe("W17b — sàn quyền ghi của cấu hình / danh mục toàn cục", () => {
  it("operator VÀ giám sát viên không có hàng quyền module ⇒ FORBIDDEN ở mọi thủ tục (nhóm giữ bằng quyền module / admin)", async () => {
    const lech: string[] = [];
    for (const [lay, duong, vao] of nhomChat()) {
      const r = await lay();
      for (const [nhan, u, role] of [["operator", op, "operator"], ["supervisor", sup, "supervisor"]] as const) {
        const ma = await goi(r, duong, ctxOf(u, role), vao);
        if (ma !== "FORBIDDEN") lech.push(`${duong} (${nhan}) = ${ma}`);
      }
    }
    expect(lech).toEqual([]);
  }, 180_000);

  it("nhóm qualityProcedure (mẫu cổng chất lượng tuỳ biến · danh mục lỗi): operator ⇒ FORBIDDEN; giám sát viên QUA sàn vai (quyết định có chủ ý) ⇒ không FORBIDDEN", async () => {
    const ca: Array<[() => Promise<unknown>, string, unknown]> = [
      [async () => (await import("./qualityGateTemplateRouter")).qualityGateTemplateRouter, "updateCustom", E],
      [async () => (await import("./qualityGateTemplateRouter")).qualityGateTemplateRouter, "deleteCustom", E],
      [async () => (await import("./productRouters")).defectCatalogRouter, "update", E],
      [async () => (await import("./productRouters")).defectCatalogRouter, "delete", E],
    ];
    const lech: string[] = [];
    for (const [lay, duong, vao] of ca) {
      const r = await lay();
      const o = await goi(r, duong, ctxOf(op, "operator"), vao);
      const s = await goi(r, duong, ctxOf(sup, "supervisor"), vao);
      if (o !== "FORBIDDEN") lech.push(`${duong} (operator) = ${o}`);
      if (s === "FORBIDDEN") lech.push(`${duong} (supervisor) = FORBIDDEN (đổi quyết định?)`);
    }
    expect(lech).toEqual([]);
  }, 120_000);
});
