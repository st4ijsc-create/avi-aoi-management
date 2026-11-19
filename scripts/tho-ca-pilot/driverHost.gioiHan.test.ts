/**
 * Trần lượt CỦA THẺ có thật sự tới agent không (HA-3, sửa dòng `taoQuanLyLuotChay({ gioiHan })` ở driverHost)?
 *
 * Bộ quản lý lượt (`taoQuanLyLuotChay`) và lõi vòng agent (`chayVongAgent`) là THẬT; model là GIẢ, tiêm qua `CauHinhHostThat.phuThuocQuanLy`.
 * Không CSDL, không mạng: chỉ các mô-đun CSDL mà bộ quản lý lượt gọi bị `vi.mock` (liệt kê dưới, mỗi mô-đun nêu vì sao):
 *  - db/aiAgentRuns      — sổ ai_agent_runs: taoHangLuotChay (INSERT lúc tạo lượt), capNhatHangLuotChay / docHangLuotChay / danhSachHangLuotChay (luuNgay, chiTiet).
 *  - db/aiAgentKeHoach   — chotMoiKeHoachDangCho: gọi ở cuối MỌI lượt (đóng kế hoạch treo).
 *  - db/aiAgentTheDuyet  — dongTheCuaCay: gọi ở cuối mọi lượt (đóng thẻ duyệt treo).
 *  - db/aiAgentLichSu    — luuLichSu / xoaLichSu / donLichSuCu: chỉ khi cờ AI_AGENT_TIEP_TUC bật (mặc định tắt); mock để lỡ bật vẫn không chạm DB.
 *  - db/aiCodingLessons  — danhSachBaiHoc / luuBaiHoc: chỉ khi cờ bài học bật.
 *  - _core/accessControl — checkPermission: công cụ đọc thật (readToolRbac → repoReadTools) tra quyền bằng SELECT; thay bằng "cho phép".
 *  - db/connection       — KHÔNG phải chức năng: ba cửa getDb / getJobsDb / getReadDb chỉ được đếm (trả null) để ca cuối khẳng định 0 lần gọi.
 * Mock thiếu một mô-đun ⇒ ca đỏ vì lỗi lạ (không phải vì trần) hoặc cửa kết nối bị gọi: ca cuối bắt điều đó.
 * KHÔNG mock: quanLyLuotChay, lõi vòng agent, aiLocalTools (đọc tệp THẬT trong thư mục tạm).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GoiModel, ManhModel } from "@shared/agentCore";

// Mock từng phần (`importOriginal` + ghi đè đúng các hàm bộ quản lý gọi): nhiều mô-đun khác nhập các tên còn lại ngay lúc nạp (vd choDuyetKeHoach nhập nopKeHoach).
vi.mock("../../server/db/aiAgentRuns", async (goc) => ({
  ...(await goc<typeof import("../../server/db/aiAgentRuns")>()),
  taoHangLuotChay: vi.fn(async () => true),
  capNhatHangLuotChay: vi.fn(async () => undefined),
  docHangLuotChay: vi.fn(async () => null),
  danhSachHangLuotChay: vi.fn(async () => []),
}));
vi.mock("../../server/db/aiAgentKeHoach", async (goc) => ({
  ...(await goc<typeof import("../../server/db/aiAgentKeHoach")>()),
  chotMoiKeHoachDangCho: vi.fn(async () => 0),
}));
vi.mock("../../server/db/aiAgentTheDuyet", async (goc) => ({
  ...(await goc<typeof import("../../server/db/aiAgentTheDuyet")>()),
  dongTheCuaCay: vi.fn(async () => 0),
}));
vi.mock("../../server/db/aiAgentLichSu", async (goc) => ({
  ...(await goc<typeof import("../../server/db/aiAgentLichSu")>()),
  luuLichSu: vi.fn(async () => undefined),
  xoaLichSu: vi.fn(async () => undefined),
  donLichSuCu: vi.fn(async () => 0),
  docLichSu: vi.fn(async () => null),
}));
vi.mock("../../server/db/aiCodingLessons", async (goc) => ({
  ...(await goc<typeof import("../../server/db/aiCodingLessons")>()),
  danhSachBaiHoc: vi.fn(async () => []),
  luuBaiHoc: vi.fn(async () => undefined),
}));

// Công cụ đọc THẬT (read_file) kiểm quyền qua checkPermission → getDb (SELECT bảng phân quyền): thay bằng "cho phép" để không đọc CSDL.
vi.mock("../../server/_core/accessControl", async (goc) => ({
  ...(await goc<typeof import("../../server/_core/accessControl")>()),
  checkPermission: vi.fn(async () => true),
}));

// Lưới "không chạm CSDL": ba cửa mở kết nối của mô-đun connection chỉ được ĐẾM (trả null); ca cuối khẳng định 0 lần. Hàng rào, không phải chức năng được kiểm.
vi.mock("../../server/db/connection", async (goc) => ({
  ...(await goc<typeof import("../../server/db/connection")>()),
  getDb: vi.fn(async () => null),
  getJobsDb: vi.fn(async () => null),
  getReadDb: vi.fn(async () => null),
}));

import { phuThuocHostThat } from "./driverHost";
import * as ketNoi from "../../server/db/connection";
import * as soRuns from "../../server/db/aiAgentRuns";

const DU_AN = "gioihan-pilot";
const NGUOI = { id: 5, role: "engineer", name: "pilot" };
let THU_MUC = "";
const BIEN_CU: Record<string, string | undefined> = {};
const BIEN = ["AI_REPO_SANDBOX_ROOTS", "AI_AGENT_SO_LUOT_TOI_DA", "AI_AGENT_TIEP_TUC"] as const;

beforeAll(() => {
  THU_MUC = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pilot-gioihan-")));
  // mỗi lượt đọc MỘT tệp khác: lõi dừng "lap-lai" nếu cùng một lời gọi công cụ lặp lại
  for (let k = 1; k <= 8; k++) fs.writeFileSync(path.join(THU_MUC, `f${k}.txt`), `tep ${k}\n`);
  for (const k of BIEN) BIEN_CU[k] = process.env[k];
  delete process.env.AI_AGENT_SO_LUOT_TOI_DA; // trần của thẻ phải thắng bằng CHÍNH nó, không nhờ biến môi trường
  delete process.env.AI_AGENT_TIEP_TUC;
  process.env.AI_REPO_SANDBOX_ROOTS = `${DU_AN}=Gioi han pilot|${THU_MUC}`;
});
afterAll(() => {
  for (const k of BIEN) {
    if (BIEN_CU[k] === undefined) delete process.env[k];
    else process.env[k] = BIEN_CU[k];
  }
  fs.rmSync(THU_MUC, { recursive: true, force: true });
});
afterEach(() => vi.clearAllMocks());

/** Model giả: MỖI lượt xin đọc một tệp KHÁC (f1.txt, f2.txt…; không tự dừng) cho tới lượt thứ `tuDungSau`, lượt đó trả lời chữ không tool call. `dem.n` = số lần model được gọi. */
function modelGia(tuDungSau: number, dem: { n: number }): GoiModel {
  return async function* (): AsyncGenerator<ManhModel> {
    dem.n += 1;
    if (dem.n >= tuDungSau) {
      yield { loai: "chu", noiDung: "xong" };
      yield { loai: "xong", toolCalls: [], usage: { vao: 10, ra: 5, nghi: 0 } };
      return;
    }
    yield {
      loai: "xong",
      toolCalls: [{ id: `c${dem.n}`, type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: `f${dem.n}.txt` }) } }],
      usage: { vao: 10, ra: 5, nghi: 0 },
    } as ManhModel;
  };
}

/** Tạo lượt bằng host THẬT (bộ quản lý + lõi thật, model giả) rồi chờ lượt kết thúc. */
async function chayLuot(gioiHan: { soLuotToiDa?: number; msToiDa?: number }, tuDungSau: number) {
  const dem = { n: 0 };
  const dep = await phuThuocHostThat({
    nguoi: NGUOI,
    phuThuocQuanLy: {
      goiModel: modelGia(tuDungSau, dem),
      kiemQuyen: async () => true,
      chiMucMa: null,
      giuSauKhiXongMs: 1_000,
    },
  });
  const tao = await dep.taoLuot({ cauHoi: "doc cac tep f*.txt", projectId: DU_AN, gioiHan });
  if (!tao.ok) throw new Error(`không tạo được lượt: ${tao.loi}`);
  const han = Date.now() + 20_000;
  for (;;) {
    const t = await dep.trangThaiLuot!(tao.runId);
    if (t && t.trangThai !== "dang-chay") return { soLanGoiModel: dem.n, trangThai: t.trangThai, lyDoDung: t.lyDoDung };
    if (Date.now() > han) throw new Error("lượt không kết thúc trong 20 giây");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("trần lượt của thẻ tới agent (bộ quản lý + lõi vòng agent THẬT, model giả, không CSDL)", () => {
  it("★★★ gioiHan { soLuotToiDa: 2 } ⇒ model được gọi ĐÚNG 2 lần, lyDoDung = het-luot (model muốn chạy tới lượt 6)", async () => {
    const r = await chayLuot({ soLuotToiDa: 2 }, 6);
    expect(r.soLanGoiModel).toBe(2);
    expect(r.lyDoDung).toBe("het-luot");
  });
  it("★★★ đối chứng: thẻ chỉ có msToiDa (không soLuotToiDa) ⇒ model được gọi quá 2 lần (đúng 6, tự dừng ở lượt 6), lyDoDung KHÔNG phải het-luot — ca trên không xanh vì model tự dừng", async () => {
    const r = await chayLuot({ msToiDa: 600_000 }, 6);
    expect(r.soLanGoiModel).toBe(6);
    expect(r.lyDoDung).not.toBe("het-luot");
  });
  it("★★ trần 3 ⇒ đúng 3 lần (không phải hằng số 2 của ca trước)", async () => {
    const r = await chayLuot({ soLuotToiDa: 3 }, 6);
    expect(r.soLanGoiModel).toBe(3);
    expect(r.lyDoDung).toBe("het-luot");
  });
  it("★★ bộ quản lý chỉ ghi vào sổ qua mock (taoHangLuotChay đúng 1 lần mỗi lượt): không cửa kết nối CSDL nào (getDb / getJobsDb / getReadDb) bị gọi", async () => {
    await chayLuot({ soLuotToiDa: 2 }, 6);
    expect(vi.mocked(soRuns.taoHangLuotChay)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ketNoi.getDb)).not.toHaveBeenCalled();
    expect(vi.mocked(ketNoi.getJobsDb)).not.toHaveBeenCalled();
    expect(vi.mocked(ketNoi.getReadDb)).not.toHaveBeenCalled();
  });
});
