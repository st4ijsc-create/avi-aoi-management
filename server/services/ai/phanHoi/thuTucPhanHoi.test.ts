/**
 * Đợt 5.1 — THÂN thủ tục phản hồi (`thuTucPhanHoi.ts`) với phụ thuộc TIÊM (không CSDL, không tRPC):
 *   • quyền fail-closed; phạm vi chủ (lượt chạy / đề xuất của người khác ⇒ NOT_FOUND, cùng mã với "không có");
 *   • văn bản lưu lấy từ SỔ MÁY CHỦ (khối trả lời / args của hàng ai_pending_actions) — không từ client — và ĐÃ CHE;
 *   • tệp cấm (.env…) ⇒ phiếu được ghi nhưng KHÔNG lưu nội dung; xuất loại tệp cấm + che lần hai;
 *   • quyết định từ cửa duyệt: chỉ `executed` ⇒ duyet; `ap_mot_phan` (một phần khối) ⇒ KHÔNG ghi (diff ≠ thứ đã áp);
 *   • tổng hợp + xuất mọi người: CHỈ admin.
 */
import { describe, expect, it, vi } from "vitest";
import type { SuKienAgent } from "@shared/agentCore/kieu";
import {
  ghiQuyetDinhTuCuaDuyet,
  thuTucPhanHoi,
  thuTucPhanHoiCuaToi,
  thuTucTongHopPhanHoi,
  thuTucXuatBoDuLieu,
  type PhuThuocPhanHoi,
} from "./thuTucPhanHoi";

const RUN = "11111111-2222-4333-8444-555555555555";
const ACT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const BI_MAT = "sk-abcdefghijklmnopqrstuvwxyz0123";
const KY = { id: 7, role: "engineer" };
const ADMIN = { id: 1, role: "admin" };

function suKien(...es: SuKienAgent[]) {
  return es.map((suKien, i) => ({ seq: i + 1, suKien }));
}

function taoPhuThuoc(over: Partial<PhuThuocPhanHoi> = {}) {
  const ghi: Record<string, unknown[]> = { traLoi: [], diff: [], quyetDinh: [] };
  const pt: PhuThuocPhanHoi = {
    kiemQuyen: vi.fn(async () => true),
    chiTietLuot: vi.fn(async (runId: string, userId: number) =>
      runId === RUN && userId === KY.id
        ? {
            projectId: "repo",
            cauHoi: `Sửa hàm, khoá api_key=${BI_MAT}`,
            suKien: suKien(
              { loai: "chu", noiDung: "Khối 0" },
              { loai: "goi-tool", goi: { id: "g", ten: "read_file", thamSo: {} }, luot: 1 },
              { loai: "chu", noiDung: `Khối 1 với api_key=${BI_MAT}` },
            ),
          }
        : null,
    ),
    layAction: vi.fn(async (actionId: string, userId: number) =>
      actionId === ACT && userId === KY.id
        ? {
            tool: "apply_diff",
            status: "executed",
            argsJson: { path: "src/a.ts", original: "x\n", modified: `x\nconst k = "api_key=${BI_MAT}";\n` },
          }
        : null,
    ),
    timRun: vi.fn(async (userId: number, actionId: string) =>
      userId === KY.id && actionId === ACT ? { id: RUN, projectId: "repo", cauHoi: "Thêm hằng số" } : null,
    ),
    ghiPhieuTraLoi: vi.fn(async (p) => {
      ghi.traLoi!.push(p);
      return { ok: true as const, hang: null };
    }),
    ghiPhieuDiff: vi.fn(async (p) => {
      ghi.diff!.push(p);
      return { ok: true as const, hang: null };
    }),
    ghiQuyetDinhDiff: vi.fn(async (p) => {
      ghi.quyetDinh!.push(p);
      return { ok: true as const, hang: null };
    }),
    danhSachCuaToi: vi.fn(async (userId: number) => [{ id: `cua-${userId}` }] as never),
    tongHop: vi.fn(async () => ({ traLoi: { len: 1, xuong: 0 }, traLoiVscode: { len: 0, xuong: 0 }, diff: { len: 0, xuong: 0, duyet: 1, bac: 0 }, soNguoi: 1 })),
    docHangChoXuat: vi.fn(async (userId: number | null) => [
      { loai: "diff", quyetDinh: "duyet", danhGia: null, cauHoi: `dùng api_key=${BI_MAT}`, noiDung: "+a\n", duongDan: "src/a.ts", projectId: "repo", runId: RUN, actionId: `x-${userId}`, nguon: "web" },
      { loai: "diff", quyetDinh: "duyet", danhGia: 1, cauHoi: "q", noiDung: "+b\n", duongDan: ".env", projectId: "repo", runId: RUN, actionId: "env", nguon: "web" },
    ]),
    ...over,
  };
  return { pt, ghi };
}

describe("§1 phiếu câu trả lời", () => {
  it("văn bản khối lấy từ SỔ máy chủ theo chiSoTin (luật gộp client) và ĐÃ CHE; cauHoi cũng che", async () => {
    const { pt, ghi } = taoPhuThuoc();
    const kq = await thuTucPhanHoi(KY, { loai: "tra-loi", runId: RUN, chiSoTin: 1, danhGia: -1, lyDo: "  sai  " }, pt);
    expect(kq).toMatchObject({ ok: true, note: null });
    const p = ghi.traLoi![0] as Record<string, unknown>;
    expect(p).toMatchObject({ userId: KY.id, runId: RUN, chiSoTin: 1, danhGia: -1, lyDo: "sai", projectId: "repo" });
    expect(String(p.noiDung)).toContain("Khối 1");
    expect(JSON.stringify(p)).not.toContain(BI_MAT);
  });

  it("lượt chạy của NGƯỜI KHÁC / không có ⇒ NOT_FOUND, 0 ghi; khối ngoài tầm ⇒ NOT_FOUND", async () => {
    const { pt, ghi } = taoPhuThuoc();
    expect(await thuTucPhanHoi({ id: 99, role: "engineer" }, { loai: "tra-loi", runId: RUN, chiSoTin: 0, danhGia: 1 }, pt)).toMatchObject({ ok: false, note: "NOT_FOUND" });
    expect(await thuTucPhanHoi(KY, { loai: "tra-loi", runId: RUN, chiSoTin: 2, danhGia: 1 }, pt)).toMatchObject({ ok: false, note: "NOT_FOUND" });
    expect(ghi.traLoi).toHaveLength(0);
  });

  it("thiếu quyền / kiểm quyền NÉM ⇒ PERMISSION_DENIED (fail-closed), không đọc sổ", async () => {
    const { pt } = taoPhuThuoc({ kiemQuyen: vi.fn(async () => { throw new Error("db"); }) });
    expect(await thuTucPhanHoi(KY, { loai: "tra-loi", runId: RUN, chiSoTin: 0, danhGia: 1 }, pt)).toMatchObject({ ok: false, note: "PERMISSION_DENIED" });
    expect(pt.chiTietLuot).not.toHaveBeenCalled();
  });
});

describe("§2 phiếu diff", () => {
  it("diff dựng từ args của hàng ai_pending_actions (không từ client), ĐÃ CHE; runId/chỉ dẫn do MÁY CHỦ tìm", async () => {
    const { pt, ghi } = taoPhuThuoc();
    const kq = await thuTucPhanHoi(KY, { loai: "diff", actionId: ACT, danhGia: 1 }, pt);
    expect(kq).toMatchObject({ ok: true });
    const p = ghi.diff![0] as Record<string, unknown>;
    expect(p).toMatchObject({ userId: KY.id, actionId: ACT, runId: RUN, cauHoi: "Thêm hằng số", duongDan: "src/a.ts", danhGia: 1 });
    expect(String(p.noiDung)).toMatch(/^--- a\/src\/a\.ts\n\+\+\+ b\/src\/a\.ts\n@@/);
    expect(String(p.noiDung)).not.toContain(BI_MAT);
  });

  it("đề xuất của người khác ⇒ NOT_FOUND; tool không phải apply_diff ⇒ KHONG_PHAI_DIFF", async () => {
    const { pt } = taoPhuThuoc();
    expect(await thuTucPhanHoi({ id: 99, role: "admin" }, { loai: "diff", actionId: ACT, danhGia: 1 }, pt)).toMatchObject({ ok: false, note: "NOT_FOUND" });
    const { pt: pt2 } = taoPhuThuoc({ layAction: vi.fn(async () => ({ tool: "run_command", status: "executed", argsJson: { command: "ls" } })) });
    expect(await thuTucPhanHoi(KY, { loai: "diff", actionId: ACT, danhGia: 1 }, pt2)).toMatchObject({ ok: false, note: "KHONG_PHAI_DIFF" });
  });

  it("tệp CẤM (.env) ⇒ phiếu ghi được nhưng noiDung = null (không bao giờ lưu byte tệp bí mật)", async () => {
    const { pt, ghi } = taoPhuThuoc({
      layAction: vi.fn(async () => ({ tool: "apply_diff", status: "executed", argsJson: { path: ".env", original: "", modified: "A=1\n" } })),
    });
    expect(await thuTucPhanHoi(KY, { loai: "diff", actionId: ACT, danhGia: -1 }, pt)).toMatchObject({ ok: true });
    expect((ghi.diff![0] as Record<string, unknown>).noiDung).toBeNull();
  });
});

describe("§3 quyết định từ cửa duyệt thật", () => {
  it("duyet + executed ⇒ ghi quyết định 'duyet' kèm diff đã che + chỉ dẫn của lượt chạy", async () => {
    const { pt, ghi } = taoPhuThuoc();
    await ghiQuyetDinhTuCuaDuyet(KY, ACT, "duyet", null, pt);
    expect(ghi.quyetDinh![0]).toMatchObject({ quyetDinh: "duyet", lyDoBac: null, runId: RUN, cauHoi: "Thêm hằng số", duongDan: "src/a.ts" });
  });

  it("duyet nhưng ap_mot_phan (chọn một phần khối) ⇒ KHÔNG ghi: diff đầy đủ ≠ thứ đã áp", async () => {
    const { pt, ghi } = taoPhuThuoc({
      layAction: vi.fn(async () => ({ tool: "apply_diff", status: "ap_mot_phan", argsJson: { path: "a.ts", original: "", modified: "x\n" } })),
    });
    await ghiQuyetDinhTuCuaDuyet(KY, ACT, "duyet", null, pt);
    expect(ghi.quyetDinh).toHaveLength(0);
  });

  it("bac + cancelled ⇒ ghi 'bac' + lý do (đã che); CSDL ném ⇒ KHÔNG ném ra cửa duyệt", async () => {
    const { pt, ghi } = taoPhuThuoc({
      layAction: vi.fn(async () => ({ tool: "apply_diff", status: "cancelled", argsJson: { path: "a.ts", original: "", modified: "x\n" } })),
    });
    await ghiQuyetDinhTuCuaDuyet(KY, ACT, "bac", `lộ api_key=${BI_MAT}`, pt);
    expect(ghi.quyetDinh![0]).toMatchObject({ quyetDinh: "bac" });
    expect(JSON.stringify(ghi.quyetDinh![0])).not.toContain(BI_MAT);
    const { pt: hong } = taoPhuThuoc({ layAction: vi.fn(async () => { throw new Error("db chết"); }) });
    await expect(ghiQuyetDinhTuCuaDuyet(KY, ACT, "bac", "x", hong)).resolves.toBeUndefined();
  });
});

describe("§4 danh sách · tổng hợp · xuất", () => {
  it("danh sách CỦA MÌNH: userId lấy từ phiên", async () => {
    const { pt } = taoPhuThuoc();
    expect(await thuTucPhanHoiCuaToi(KY, pt)).toMatchObject({ ok: true, phieu: [{ id: "cua-7" }] });
  });

  it("tổng hợp: CHỈ admin (kỹ sư ⇒ PERMISSION_DENIED, không chạm CSDL)", async () => {
    const { pt } = taoPhuThuoc();
    expect(await thuTucTongHopPhanHoi(KY, pt)).toMatchObject({ ok: false, note: "PERMISSION_DENIED" });
    expect(pt.tongHop).not.toHaveBeenCalled();
    expect(await thuTucTongHopPhanHoi(ADMIN, pt)).toMatchObject({ ok: true, tongHop: { soNguoi: 1 } });
  });

  it("xuất: kỹ sư ⇒ CHỈ của mình; `tatCa` cần admin; JSONL loại .env và che lần hai", async () => {
    const { pt } = taoPhuThuoc();
    expect(await thuTucXuatBoDuLieu(KY, { tatCa: true }, pt)).toMatchObject({ ok: false, note: "PERMISSION_DENIED" });
    const cua = await thuTucXuatBoDuLieu(KY, {}, pt);
    expect(pt.docHangChoXuat).toHaveBeenLastCalledWith(KY.id);
    expect(cua).toMatchObject({ ok: true, soMau: 1, soBoQua: 1 });
    const dong = (cua as { jsonl: string }).jsonl.trim().split("\n").map((l) => JSON.parse(l));
    expect(dong).toHaveLength(1);
    expect(dong[0]).toMatchObject({ duong: "src/a.ts", diff: "+a\n" });
    expect((cua as { jsonl: string }).jsonl).not.toContain(BI_MAT);
    await thuTucXuatBoDuLieu(ADMIN, { tatCa: true }, pt);
    expect(pt.docHangChoXuat).toHaveBeenLastCalledWith(null);
  });

  it("xuất vượt trần ký tự ⇒ dừng ở ranh giới DÒNG + `catBot` (không trả một JSONL cụt giữa dòng)", async () => {
    const to = "+".repeat(9_000_000);
    const { pt } = taoPhuThuoc({
      docHangChoXuat: vi.fn(async () =>
        [1, 2].map((i) => ({ loai: "diff", quyetDinh: "duyet", danhGia: null, cauHoi: "q", noiDung: to, duongDan: `a${i}.ts`, projectId: "repo", runId: RUN, actionId: `a${i}`, nguon: "web" })),
      ),
    });
    const kq = (await thuTucXuatBoDuLieu(KY, {}, pt)) as { soMau: number; catBot: boolean; jsonl: string };
    expect(kq).toMatchObject({ soMau: 1, catBot: true });
    expect(kq.jsonl.endsWith("}\n")).toBe(true);
  });
});
