/**
 * R1b-2a T8 (kiem-dinh M4, Q7) — THUẦN: `cotNhipDoi` so cột nhịp (samplingMs / deadband / unit) như đường ĐỌC, và `kiemSuaTag.canTotp` chỉ
 * đòi mã khi tag ĐƯỢC BẢO VỆ có cột nhịp THẬT SỰ đổi. Ca DB đầu–cuối (TOTP thật, audit, import): deviceAdapterRouter.troLaiKenh.r1b.db.test.ts.
 */
import { describe, expect, it } from "vitest";
import { COT_NHIP_BAO_VE, anhNhipAudit, cotNhipDoi, kiemSuaTag, type HangTagTroLai } from "./troLaiKenh";

const hang = (cot: Partial<HangTagTroLai> = {}): HangTagTroLai =>
  ({
    id: 1,
    adapterId: 7,
    tagKey: "sp",
    address: "40001",
    dataType: "int",
    scale: null,
    offset: null,
    writable: true,
    isEnabled: true,
    stopValue: null,
    channelKind: null,
    writeMin: null,
    writeMax: null,
    writeStep: null,
    actuationLevel: null,
    samplingMs: null,
    deadband: null,
    unit: null,
    ...cot,
  }) as HangTagTroLai;

describe("R1b-2a T8 — cotNhipDoi (so như đường đọc)", () => {
  it("hằng đúng ba cột theo thứ tự", () => {
    expect(COT_NHIP_BAO_VE).toEqual(["samplingMs", "deadband", "unit"]);
  });

  it("trường vắng = giữ; null trên hàng NULL = không đổi; '' / khoảng trắng ≡ NULL cho unit", () => {
    const cu = hang();
    expect(cotNhipDoi(cu, {})).toEqual([]);
    expect(cotNhipDoi(cu, { samplingMs: null, deadband: null, unit: null })).toEqual([]);
    expect(cotNhipDoi(cu, { unit: "" })).toEqual([]);
    expect(cotNhipDoi(cu, { unit: "   " })).toEqual([]);
    expect(cotNhipDoi(cu, { samplingMs: undefined })).toEqual([]);
  });

  it("số so theo Number (chuỗi decimal từ DB ≡ số cùng giá trị); khác giá trị / bỏ cấu hình / NaN = ĐỔI", () => {
    const cu = hang({ samplingMs: 500, deadband: "0.5" as unknown as number, unit: "bar" });
    expect(cotNhipDoi(cu, { samplingMs: 500, deadband: 0.5, unit: "bar" })).toEqual([]);
    expect(cotNhipDoi(cu, { unit: " bar " })).toEqual([]);
    expect(cotNhipDoi(cu, { samplingMs: 501 })).toEqual(["samplingMs"]);
    expect(cotNhipDoi(cu, { deadband: null })).toEqual(["deadband"]);
    expect(cotNhipDoi(cu, { unit: "psi" })).toEqual(["unit"]);
    expect(cotNhipDoi(cu, { unit: "Bar" })).toEqual(["unit"]); // hoa/thường là đổi
    expect(cotNhipDoi(hang({ deadband: Number.NaN }), { deadband: Number.NaN })).toEqual(["deadband"]); // lạ ⇒ chiều an toàn
    expect(cotNhipDoi(cu, { samplingMs: 1, deadband: 2, unit: "x" })).toEqual(["samplingMs", "deadband", "unit"]);
  });
});

describe("R1b-2a T8 — kiemSuaTag: cột nhịp trên tag được bảo vệ", () => {
  it("tag ĐÃ KHAI đổi CHỈ samplingMs ⇒ canTotp, doi (trỏ lại) rỗng, doiNhip + nhip trước/sau; audit có nhip", () => {
    const kq = kiemSuaTag({ cu: hang({ actuationLevel: 3 }), patch: { samplingMs: 500 }, luatCu: [], kenhCheDoCu: false });
    expect(kq).toMatchObject({ canTotp: true, doi: [], doiNhip: ["samplingMs"], baoVe: true });
    expect(kq.nhip).toEqual({ truoc: { samplingMs: null, deadband: null, unit: null }, sau: { samplingMs: 500, deadband: null, unit: null } });
    expect(anhNhipAudit(kq)).toEqual({ doiNhip: ["samplingMs"], nhip: kq.nhip });
  });

  it("kênh chế độ đổi unit ⇒ canTotp; tag THƯỜNG đổi cả ba ⇒ không mã; tag đã khai gửi lại y nguyên ⇒ không mã, audit không có nhip", () => {
    expect(kiemSuaTag({ cu: hang(), patch: { unit: "x" }, luatCu: [], kenhCheDoCu: true }).canTotp).toBe(true);
    expect(kiemSuaTag({ cu: hang(), patch: { samplingMs: 1, deadband: 2, unit: "x" }, luatCu: [], kenhCheDoCu: false }).canTotp).toBe(false);
    const kq = kiemSuaTag({ cu: hang({ writeMin: 0, samplingMs: 500 }), patch: { samplingMs: 500, unit: null }, luatCu: [], kenhCheDoCu: false });
    expect(kq).toMatchObject({ canTotp: false, doiNhip: [] });
    expect(anhNhipAudit(kq)).toEqual({});
  });

  it("nguồn của luật (không alert) ĐÃ DUYỆT dù tắt ⇒ đổi deadband cần mã; luật alert ⇒ không", () => {
    const luat = (action: string) => [{ id: 9, name: "r", action, enabled: false, approvedBy: 1, commandValue: null, commandTag: null, sourceKey: "sp" }] as never;
    expect(kiemSuaTag({ cu: hang(), patch: { deadband: 0.5 }, luatCu: [], nguonCu: luat("stop_line"), kenhCheDoCu: false }).canTotp).toBe(true);
    expect(kiemSuaTag({ cu: hang(), patch: { deadband: 0.5 }, luatCu: [], nguonCu: luat("alert"), kenhCheDoCu: false }).canTotp).toBe(false);
  });
});
