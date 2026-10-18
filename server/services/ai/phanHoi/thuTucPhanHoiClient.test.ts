/**
 * Đợt 5.1 (VSCode) — THÂN thủ tục phiếu của lượt agent CHẠY CỤC BỘ trong extension (`thuTucPhanHoiClient`), phụ thuộc
 * TIÊM (không CSDL, không HTTP). Lượt extension KHÔNG có hàng `ai_agent_runs` ⇒ client GỬI văn bản; máy chủ phải:
 *   • che bí mật TRƯỚC khi ghi (câu hỏi · câu trả lời · lý do) — cùng lớp `redactSecretsOnly` với phiếu web;
 *   • cắt về trần SAU khi che (che có thể làm chuỗi dài ra); bỏ ký tự NUL (cột `text` Postgres không nhận);
 *   • ghi ĐÚNG người phiên (chủ token) — không bao giờ một id lấy từ thân; khoá = (người, lượt client, chỉ số khối);
 *   • bỏ phiếu (`danhGia: null`) đi thẳng xuống tầng dữ liệu (xoá hàng của CHÍNH người này);
 *   • CSDL hỏng ⇒ `{ok:false, note:"DB_LOI"}`, không ném.
 */
import { describe, expect, it, vi } from "vitest";
import { thuTucPhanHoiClient, type GhiPhieuClient } from "./thuTucPhanHoi";
import { TRAN_KY_TU_CAU_HOI_CLIENT, TRAN_KY_TU_TRA_LOI_CLIENT } from "@shared/phanHoiAgent";

const LUOT = "0f0e0d0c-0b0a-4908-8706-050403020100";
const BI_MAT = "sk-abcdefghijklmnopqrstuvwxyz0123";
const KY = { id: 7, role: "engineer" };

function taoGhi(kq: Awaited<ReturnType<GhiPhieuClient>> = { ok: true, hang: null }) {
  const da: Array<Parameters<GhiPhieuClient>[0]> = [];
  const ghi: GhiPhieuClient = vi.fn(async (p) => {
    da.push(p);
    return kq;
  });
  return { ghi, da };
}

const coBan = { luotId: LUOT, chiSoKhoi: 2, danhGia: 1 as const, cauHoi: "Sửa hàm cộng", traLoi: "Đã sửa." };

describe("thuTucPhanHoiClient — văn bản client tự khai: che + trần + đúng chủ", () => {
  it("ghi đúng người phiên, khoá (lượt client, chỉ số khối), nguồn do tầng dữ liệu đặt — thân không mang id người", async () => {
    const { ghi, da } = taoGhi();
    const kq = await thuTucPhanHoiClient(KY, { ...coBan, duAn: "repo-1" }, ghi);
    expect(kq).toEqual({ ok: true, note: null, phieu: null });
    expect(da).toEqual([
      { userId: 7, luotClient: LUOT, chiSoTin: 2, projectId: "repo-1", danhGia: 1, lyDo: null, cauHoi: "Sửa hàm cộng", noiDung: "Đã sửa." },
    ]);
  });

  it("★ che bí mật TRƯỚC khi ghi ở cả ba ô (câu hỏi · câu trả lời · lý do)", async () => {
    const { ghi, da } = taoGhi();
    await thuTucPhanHoiClient(
      KY,
      { ...coBan, danhGia: -1, cauHoi: `dùng api_key=${BI_MAT}`, traLoi: `Đặt OPENAI_API_KEY=${BI_MAT} vào .env`, lyDo: `lộ ${BI_MAT}` },
      ghi,
    );
    expect(da).toHaveLength(1);
    expect(JSON.stringify(da[0])).not.toContain(BI_MAT);
    expect(da[0]!.danhGia).toBe(-1);
    expect(da[0]!.lyDo).toBeTruthy();
  });

  it("★ trần: cắt SAU khi che; bỏ NUL; lý do rỗng/khoảng trắng ⇒ null", async () => {
    const { ghi, da } = taoGhi();
    await thuTucPhanHoiClient(
      KY,
      { ...coBan, cauHoi: "q".repeat(TRAN_KY_TU_CAU_HOI_CLIENT + 50), traLoi: `a\u0000b${"x".repeat(TRAN_KY_TU_TRA_LOI_CLIENT)}`, lyDo: "   " },
      ghi,
    );
    expect(da[0]!.cauHoi!.length).toBe(TRAN_KY_TU_CAU_HOI_CLIENT);
    expect(da[0]!.noiDung!.length).toBe(TRAN_KY_TU_TRA_LOI_CLIENT);
    expect(da[0]!.noiDung!.startsWith("ab")).toBe(true);
    expect(da[0]!.lyDo).toBeNull();
  });

  it("bỏ phiếu (danhGia null) đi thẳng xuống tầng dữ liệu; dự án sai hình dạng ⇒ null (không phải đường dẫn máy dev)", async () => {
    const { ghi, da } = taoGhi();
    await thuTucPhanHoiClient(KY, { ...coBan, danhGia: null, duAn: "D:\\SOURCES\\repo" }, ghi);
    expect(da[0]).toMatchObject({ danhGia: null, projectId: null });
  });

  it("người không hợp lệ ⇒ PERMISSION_DENIED, không ghi; CSDL hỏng ⇒ DB_LOI, không ném", async () => {
    const a = taoGhi();
    expect(await thuTucPhanHoiClient({ id: 0, role: "x" }, coBan, a.ghi)).toMatchObject({ ok: false, note: "PERMISSION_DENIED" });
    expect(a.da).toHaveLength(0);
    const b = taoGhi({ ok: false });
    expect(await thuTucPhanHoiClient(KY, coBan, b.ghi)).toEqual({ ok: false, note: "DB_LOI", phieu: null });
  });
});
