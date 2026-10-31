// Đợt 11.3-C — chuẩn hoá câu trả lời aiAgent.keHoachDangCho / duyetKeHoach: lỗi nằm trong THÂN; trạng thái lạ ⇒ "cho"; không bao giờ suy ra "đã duyệt".
import { describe, expect, it } from "vitest";
import { chuanHoaDuyetKeHoach, chuanHoaKeHoachDangCho } from "./agentApi";

const B = "f".repeat(64);

describe("chuanHoaKeHoachDangCho", () => {
  it("ok ⇒ băm, trạng thái, bước; trạng thái lạ ⇒ 'cho'; băm sai ⇒ null", () => {
    expect(chuanHoaKeHoachDangCho({ ok: true, note: null, bam: B, trangThai: "duyet", viec: [{ noiDung: "a", trangThai: "xong" }, { noiDung: 5 }, { noiDung: "b", trangThai: "la" }] })).toEqual({
      ok: true,
      ma: null,
      bam: B,
      trangThai: "duyet",
      viec: [{ noiDung: "a", trangThai: "xong" }, { noiDung: "b", trangThai: "cho" }],
    });
    expect(chuanHoaKeHoachDangCho({ ok: true, bam: B, trangThai: "ky-la", viec: [] }).trangThai).toBe("cho");
    expect(chuanHoaKeHoachDangCho({ ok: true, bam: "xyz", trangThai: "cho", viec: [] }).bam).toBeNull();
  });
  it("ok=false hoặc rác ⇒ ok=false kèm mã trong thân; không ném", () => {
    expect(chuanHoaKeHoachDangCho({ ok: false, note: "NOT_FOUND" })).toMatchObject({ ok: false, ma: "NOT_FOUND" });
    expect(chuanHoaKeHoachDangCho(null)).toMatchObject({ ok: false, ma: "LOI" });
    expect(chuanHoaKeHoachDangCho("x")).toMatchObject({ ok: false });
  });
});

describe("chuanHoaDuyetKeHoach", () => {
  it("ok + quyết định; ok thiếu quyết định ⇒ trangThai null (KHÔNG suy ra đã duyệt)", () => {
    expect(chuanHoaDuyetKeHoach({ ok: true, note: null, trangThai: "bac", luc: "L" })).toEqual({ ok: true, ma: null, trangThai: "bac", luc: "L" });
    expect(chuanHoaDuyetKeHoach({ ok: true, trangThai: "gi-do" }).trangThai).toBeNull();
  });
  it("lỗi trong thân: CONFLICT / DA_QUYET giữ nguyên mã; rác ⇒ LOI", () => {
    expect(chuanHoaDuyetKeHoach({ ok: false, note: "CONFLICT" })).toMatchObject({ ok: false, ma: "CONFLICT" });
    expect(chuanHoaDuyetKeHoach({ ok: false, note: "DA_QUYET" })).toMatchObject({ ok: false, ma: "DA_QUYET" });
    expect(chuanHoaDuyetKeHoach(undefined)).toMatchObject({ ok: false, ma: "LOI" });
  });
});
