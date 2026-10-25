/**
 * CỔNG CSDL THẬT — lô L6w (rà bảo mật tRPC, 2026-10-25): 3 thủ tục GHI vùng inspection còn nợ — feederVerify.verifyScan · inspectionVariant.setVariant (+ getVariant) · pdfReport.generateInspectionPDF.
 * Lỗ: người nhà máy A ghi lượt xác minh feeder cho máy nhà máy B (kết quả xác minh là đầu vào của cổng chạy máy — chỉ ghi bản ghi, không điều khiển thiết bị), gắn / đọc biến thể kiểm tra của lần kiểm tra nhà máy B,
 * và xuất PDF báo cáo kiểm tra (serial, kết quả đo, máy) của nhà máy B. Luật: ngoài phạm vi ≡ NOT_FOUND (máy / chuyền / sản phẩm / lần kiểm tra); admin không đổi.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createProductModel } from "../db";
import { dangKyModelSanPhamTest } from "../testing/modelSanPhamTest";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { seedHaiNhaMayDo, qChuTest, type HaiNhaMayDo } from "../testing/__haiNhaMayDoLuong";
import { readAppErrorMeta } from "../_core/appError";
import { INSPECTION_TYPES } from "../utils/inspectionVariant";
const LOAI = INSPECTION_TYPES[0];

const RUN = `l6w${process.pid}${Date.now().toString(36)}`;
let H!: HaiNhaMayDo;
type C = { fv: any; iv: any; pdf: any };
let cA: C, cAdm: C, cRong: C;
const caller = async (u: { id: number; role: string; name: string }): Promise<C> => {
  const ctx = { user: { ...u, twoFactorEnabled: true } } as never;
  const mk = async (p: string, k: string) => ((await import(p))[k] as any).createCaller(ctx);
  return { fv: await mk("./feederVerifyRouter", "feederVerifyRouter"), iv: await mk("./inspectionVariantRouter", "inspectionVariantRouter"), pdf: await mk("./pdfReportRouter", "pdfReportRouter") };
};
async function loi(chay: () => Promise<unknown>): Promise<string | null> {
  try { await chay(); return null; } catch (e) {
    const meta = readAppErrorMeta(e);
    return `${(e as { code?: string }).code ?? "?"}:${meta?.appCode ?? "?"}:${((meta?.appParams ?? {}) as { entity?: string }).entity ?? ""}`;
  }
}
const demXacMinh = async (mid: number) => Number((await H.dung(sql`SELECT count(*)::int AS n FROM feeder_setup_verifications WHERE "machineId" = ${mid}`))[0].n);

beforeAll(async () => {
  H = await seedHaiNhaMayDo(RUN, "l6w", [], dangKyModelSanPhamTest(await createProductModel({ code: RUN + "-PM", name: RUN } as never)), taoNguoiDungTest);
  cA = await caller(H.uA);
  cAdm = await caller(H.uAdmin);
  cRong = await caller(H.uRong);
}, 300_000);

afterAll(async () => {
  if (!H) return;
  await qChuTest(`DELETE FROM feeder_setup_verifications WHERE "machineId" IN (${H.A.mid}, ${H.B.mid})`).catch(() => undefined);
  await H.don();
});

describe("★★★ feederVerify.verifyScan — GHI theo máy / chuyền", () => {
  it("máy B ⇒ NOT_FOUND 'machine' và KHÔNG ghi hàng nào; máy A ghi được; chuyền B khai kèm máy A ⇒ NOT_FOUND 'line'; admin ghi được cho B", async () => {
    const truoc = await demXacMinh(H.B.mid);
    expect(await loi(() => cA.fv.verifyScan({ machineId: H.B.mid, slotCode: "S1", scannedComponentCode: "X" }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:machine");
    expect(await demXacMinh(H.B.mid)).toBe(truoc);
    const ok = await cA.fv.verifyScan({ machineId: H.A.mid, slotCode: "S1", scannedComponentCode: "X", expectedComponentCode: "X" });
    expect(ok.verdict).toBe("match");
    expect(await demXacMinh(H.A.mid)).toBe(1);
    expect(await loi(() => cA.fv.verifyScan({ machineId: H.A.mid, lineId: H.B.lid, slotCode: "S2", scannedComponentCode: "X" }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:line");
    expect(await loi(() => cAdm.fv.verifyScan({ machineId: H.B.mid, slotCode: "S1", scannedComponentCode: "X", expectedComponentCode: "X" }))).toBeNull();
    expect(await demXacMinh(H.B.mid)).toBe(truoc + 1);
    // người không gán nhà máy nào cũng không ghi được cho máy A
    expect(await loi(() => cRong.fv.verifyScan({ machineId: H.A.mid, slotCode: "S9", scannedComponentCode: "X" }))).toBe("NOT_FOUND:ENTITY_NOT_FOUND:machine");
  });
});

describe("★★★ inspectionVariant — setVariant (GHI) + getVariant (ĐỌC)", () => {
  it("lần kiểm tra của máy B ngoài phạm vi ≡ không tồn tại; lần kiểm tra của A qua cổng phạm vi", async () => {
    const khong = await loi(() => cA.iv.setVariant({ inspectionId: 2147483000, inspectionType: LOAI, payload: {} }));
    expect(khong).toBe("NOT_FOUND:ENTITY_NOT_FOUND:inspection");
    expect(await loi(() => cA.iv.setVariant({ inspectionId: H.B.insp, inspectionType: LOAI, payload: {} }))).toBe(khong);
    expect(await loi(() => cA.iv.setVariant({ inspectionId: H.A.insp, inspectionType: LOAI, payload: {} }))).not.toBe(khong);
    expect(await loi(() => cAdm.iv.setVariant({ inspectionId: H.B.insp, inspectionType: LOAI, payload: {} }))).not.toBe(khong);
    expect(await loi(() => cA.iv.getVariant({ inspectionId: H.B.insp }))).toBe(khong);
    expect(await loi(() => cA.iv.getVariant({ inspectionId: H.A.insp }))).toBeNull();
    expect(await loi(() => cAdm.iv.getVariant({ inspectionId: H.B.insp }))).toBeNull();
  });
});

describe("★★★ pdfReport.generateInspectionPDF", () => {
  it("lần kiểm tra của máy B ⇒ NOT_FOUND (không xuất PDF); của A xuất được; admin xuất được cho B", async () => {
    const khong = await loi(() => cA.pdf.generateInspectionPDF({ inspectionId: 2147483000 }));
    expect(khong).toBe("NOT_FOUND:ENTITY_NOT_FOUND:inspection");
    expect(await loi(() => cA.pdf.generateInspectionPDF({ inspectionId: H.B.insp }))).toBe(khong);
    expect(await loi(() => cA.pdf.generateInspectionPDF({ inspectionId: H.A.insp }))).toBeNull();
    expect(await loi(() => cAdm.pdf.generateInspectionPDF({ inspectionId: H.B.insp }))).toBeNull();
    expect(await loi(() => cRong.pdf.generateInspectionPDF({ inspectionId: H.A.insp }))).toBe(khong);
  });
});
