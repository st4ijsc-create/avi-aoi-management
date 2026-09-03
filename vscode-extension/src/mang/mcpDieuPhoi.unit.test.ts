/**
 * ★★★ ĐỢT H / TASK H2 / B3 — lưới CỬA DUYỆT DUY NHẤT (`xinPhepNeuCan`) bằng PHỤ THUỘC GIẢ, không
 * cần mock module `vscode`. Trục chính: NHÁNH TỪ CHỐI ⇒ ĐẾM ĐƯỢC 0 lần `goiMotPhien` (tức 0 lần
 * spawn tiến trình thật, vì `goiMotPhien` là nơi DUY NHẤT `phuThuocThat` chạm `taoTienTrinhMcpNgoai`).
 */
import { describe, it, expect, vi } from "vitest";

// ★ `mcpDieuPhoi.ts` nhập `vscode` chỉ để dựng `phuThuocThat` (ranh giới I/O thật, KHÔNG được lưới
// này đụng tới — xem docblock tệp nguồn). Lưới ở đây chỉ gọi các hàm CỐT LÕI qua phụ thuộc GIẢ, nên
// bản mock dưới đây chỉ cần đủ hình dạng để MODULE import được, không cần hành vi thật.
vi.mock("vscode", () => ({
  workspace: { getConfiguration: () => ({ get: () => ({}) }) },
  window: { showWarningMessage: async () => undefined },
}));

import {
  xinPhepNeuCan,
  layDanhSachToolMcpNgoai,
  goiToolMcpNgoai,
  datBatTatMcpNgoai,
  dsToolMcpDangCoSan,
  datDsToolMcpDangCoSan,
  type PhuThuocDieuPhoiMcp,
} from "./mcpDieuPhoi";
import type { CauHinhMcpServer } from "../loi/mcpCauHinh";
import type { KhoTrangThaiMcp } from "../loi/mcpDuyet";
import type { KetQuaGoiMcp } from "./mcpClient";

const CFG: CauHinhMcpServer = { ten: "demo", lenh: "npx", doi: ["-y", "some-mcp"], moi: {} };

/** Phụ thuộc giả có bộ đếm — kho sống trong bộ nhớ, `goiMotPhien` đếm số lần được gọi (= số lần
 *  "sẽ spawn" nếu là bản thật). */
function dungPhuThuocGia(dv: {
  cauHinh?: CauHinhMcpServer[];
  choPhep?: boolean;
  ketQuaGoi?: KetQuaGoiMcp;
}): PhuThuocDieuPhoiMcp & { soLanGoiMotPhien: number; soLanHoiDuyet: number; khoHienTai: KhoTrangThaiMcp } {
  let kho: KhoTrangThaiMcp = {};
  let soLanGoiMotPhien = 0;
  let soLanHoiDuyet = 0;
  const pt: PhuThuocDieuPhoiMcp = {
    docCauHinh: () => dv.cauHinh ?? [CFG],
    docTrangThai: () => kho,
    ghiTrangThai: async (k) => {
      kho = k;
    },
    hoiDuyet: async () => {
      soLanHoiDuyet++;
      return dv.choPhep ?? true;
    },
    goiMotPhien: async () => {
      soLanGoiMotPhien++;
      return dv.ketQuaGoi ?? { ok: true, ketQua: { tools: [] } };
    },
  };
  return {
    ...pt,
    get soLanGoiMotPhien() {
      return soLanGoiMotPhien;
    },
    get soLanHoiDuyet() {
      return soLanHoiDuyet;
    },
    get khoHienTai() {
      return kho;
    },
  };
}

describe("xinPhepNeuCan — B3: duyệt lần đầu, nhớ theo cấu hình", () => {
  it("★★★ NHÁNH TỪ CHỐI — người dùng bấm 'Từ chối' ⇒ ok:false, và KHÔNG MỘT LẦN NÀO goiMotPhien được gọi (0 spawn)", async () => {
    const pt = dungPhuThuocGia({ choPhep: false });
    const r = await xinPhepNeuCan(pt, CFG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.lyDo).toContain("TỪ CHỐI");
    expect(pt.soLanGoiMotPhien).toBe(0);
  });

  it("★★★ lần đầu CHO PHÉP ⇒ hỏi đúng 1 lần, ghi lại trạng thái", async () => {
    const pt = dungPhuThuocGia({ choPhep: true });
    const r = await xinPhepNeuCan(pt, CFG);
    expect(r.ok).toBe(true);
    expect(pt.soLanHoiDuyet).toBe(1);
    expect(pt.khoHienTai.demo?.daDuyetVanTay).toBeTruthy();
  });

  it("★★★ ĐÃ DUYỆT TRƯỚC ĐÓ (cấu hình không đổi) ⇒ KHÔNG hỏi lại lần thứ hai", async () => {
    const pt = dungPhuThuocGia({ choPhep: true });
    await xinPhepNeuCan(pt, CFG); // lần 1: hỏi
    const r2 = await xinPhepNeuCan(pt, CFG); // lần 2: đã duyệt, không hỏi
    expect(r2.ok).toBe(true);
    expect(pt.soLanHoiDuyet).toBe(1);
  });

  it("★★ server đang TẮT ⇒ từ chối NGAY, KHÔNG hỏi duyệt (khác hẳn từ chối bằng dialog)", async () => {
    const pt = dungPhuThuocGia({ choPhep: true });
    await pt.ghiTrangThai({ demo: { tat: true } });
    const r = await xinPhepNeuCan(pt, CFG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.lyDo).toContain("TẮT");
    expect(pt.soLanHoiDuyet).toBe(0);
  });
});

describe("goiToolMcpNgoai — B3+B4: kết quả LUÔN qua dinhDangKetQuaMcpNgoai, hàng rào duyệt luôn chạy trước spawn", () => {
  it("★★★ server không có trong cấu hình ⇒ lỗi rành mạch, 0 lần gọi goiMotPhien", async () => {
    const pt = dungPhuThuocGia({ cauHinh: [] });
    const kq = await goiToolMcpNgoai(pt, { server: "khong-ton-tai", tool: "x", dauVao: {} });
    expect(kq).toContain("khong-ton-tai");
    expect(kq).toContain("LỖI TỪ");
    expect(pt.soLanGoiMotPhien).toBe(0);
  });

  it("★★★ bị TỪ CHỐI duyệt ⇒ KHÔNG spawn, kết quả là lỗi đã định dạng (đi qua dinhDangKetQuaMcpNgoai)", async () => {
    const pt = dungPhuThuocGia({ choPhep: false });
    const kq = await goiToolMcpNgoai(pt, { server: "demo", tool: "x", dauVao: {} });
    expect(kq).toContain("TỪ CHỐI");
    expect(kq).toContain("LỖI TỪ MCP SERVER NGOÀI");
    expect(pt.soLanGoiMotPhien).toBe(0);
  });

  it("★★ gọi thành công ⇒ trích ĐÚNG nội dung text từ content[]", async () => {
    const pt = dungPhuThuocGia({
      choPhep: true,
      ketQuaGoi: { ok: true, ketQua: { content: [{ type: "text", text: "xin chào từ tool" }] } },
    });
    const kq = await goiToolMcpNgoai(pt, { server: "demo", tool: "x", dauVao: {} });
    expect(kq).toContain("xin chào từ tool");
    expect(kq).toContain("KẾT QUẢ TỪ");
  });

  it("★★ isError:true của tool MCP ⇒ nhãn LỖI, không phải KẾT QUẢ", async () => {
    const pt = dungPhuThuocGia({
      choPhep: true,
      ketQuaGoi: { ok: true, ketQua: { content: [{ type: "text", text: "bad input" }], isError: true } },
    });
    const kq = await goiToolMcpNgoai(pt, { server: "demo", tool: "x", dauVao: {} });
    expect(kq).toContain("LỖI TỪ");
    expect(kq).toContain("bad input");
  });

  it("★★ round-trip thất bại (timeout/lỗi mạng) ⇒ lỗi đã định dạng, không ném", async () => {
    const pt = dungPhuThuocGia({ choPhep: true, ketQuaGoi: { ok: false, loi: "hết thời gian chờ" } });
    await expect(goiToolMcpNgoai(pt, { server: "demo", tool: "x", dauVao: {} })).resolves.toContain("hết thời gian chờ");
  });
});

describe("layDanhSachToolMcpNgoai — B5", () => {
  it("★★ tổng hợp tool từ nhiều server, bỏ qua server TẮT", async () => {
    const a: CauHinhMcpServer = { ten: "a", lenh: "node", doi: [], moi: {} };
    const b: CauHinhMcpServer = { ten: "b", lenh: "node", doi: [], moi: {} };
    const pt = dungPhuThuocGia({
      cauHinh: [a, b],
      choPhep: true,
      ketQuaGoi: { ok: true, ketQua: { tools: [{ name: "t1", description: "mo ta" }] } },
    });
    await pt.ghiTrangThai({ b: { tat: true } });
    const ds = await layDanhSachToolMcpNgoai(pt);
    expect(ds.every((d) => d.server !== "b")).toBe(true);
    expect(ds.some((d) => d.server === "a" && d.tool === "t1")).toBe(true);
  });

  it("★★ server lỗi (tools/list thất bại) ⇒ một mục lỗi, không ném, các server khác vẫn xử lý", async () => {
    const pt = dungPhuThuocGia({ choPhep: true, ketQuaGoi: { ok: false, loi: "không kết nối được" } });
    const ds = await layDanhSachToolMcpNgoai(pt);
    expect(ds.length).toBe(1);
    expect(ds[0]!.loi).toContain("không kết nối được");
  });
});

describe("datBatTatMcpNgoai", () => {
  it("★★ bật/tắt được ghi lại qua ghiTrangThai", async () => {
    const pt = dungPhuThuocGia({});
    await datBatTatMcpNgoai(pt, "demo", true);
    expect(pt.khoHienTai.demo?.tat).toBe(true);
  });
});

describe("dsToolMcpDangCoSan / datDsToolMcpDangCoSan — bộ nhớ đệm dạy giao thức", () => {
  it("★★★ mặc định RỖNG (không tự động kết nối)", () => {
    datDsToolMcpDangCoSan([]); // đảm bảo sạch trước khi kiểm (module-level, các lưới khác có thể đã set)
    expect(dsToolMcpDangCoSan()).toEqual([]);
  });

  it("★★ chỉ giữ mục KHÔNG lỗi", () => {
    datDsToolMcpDangCoSan([
      { server: "a", tool: "t1", moTa: "m" },
      { server: "b", tool: "", moTa: "", loi: "hỏng" },
    ]);
    expect(dsToolMcpDangCoSan()).toEqual([{ server: "a", tool: "t1", moTa: "m" }]);
  });
});
