/**
 * ★ Đợt 10.3 Task 6 — node AI Luồng + `ai.agent` dùng model NGOÀI đi qua CỔNG (giả ở đây: `datHamGoiNgoaiNut`): yêu cầu mang nhà máy
 * CHỦ LUỒNG + hàm mức dữ liệu của động cơ (node không khai); agent chỉ cấp luồng con hạng thuần / đọc + tra tài liệu; mức dữ liệu
 * từng lượt gồm kết quả tool đã ghép; tool ngoài tập cấp ⇒ cổng ném ⇒ node dừng.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ hang: {} as Record<string, string> }));
vi.mock("./luong", async (goc) => {
  const that = await goc<typeof import("./luong")>();
  return {
    ...that,
    kiemGoiLuongCon: vi.fn(async (_ngu: unknown, flowId: string) => ({
      version: 1,
      hang: h.hang[flowId] ?? "thuan",
      nutVao: "a",
      def: { nodes: [{ id: "a", type: "kich-hoat.thu-cong" }], connections: [] },
    })),
  };
});

import { layNut, type NguCanhChay, type VetModel } from "../dangKyNut";
import { datHamGoiNgoaiNut, datPhuThuocChonModelNut } from "./ai";
import { datHamTimTaiLieu } from "./agent";
import { LoiNgoai } from "../../ai/ngoai/loi";
import type { YeuCauGoiNgoai } from "../../ai/ngoai/congNgoai";

const F = 42;
const nhan: YeuCauGoiNgoai[] = [];
let traVe: Array<{ noiDung: string; toolCalls: Array<{ ten: string; thamSo: unknown }> } | Error> = [];
datHamGoiNgoaiNut(async (yc) => {
  nhan.push(yc);
  const r = traVe.shift() ?? { noiDung: "xong", toolCalls: [] };
  if (r instanceof Error) throw r;
  return { ...r, tokenVao: 3, tokenRa: 4 };
});
datPhuThuocChonModelNut(async () => ({
  anh: { taiLuc: 1, vaiTro: new Map(), profile: new Map(), gan: [] },
  hoSoCoDo: new Set(),
  kheDangGiu: null,
  uocTinhDoiKheGiay: async () => null,
  ngoai: { layModelDaBat: async (f) => (f === F ? [{ nhaCungCap: "anthropic", model: "claude-thu", nhan: "C" }] : []) },
}));
afterAll(() => {
  datHamGoiNgoaiNut(null);
  datPhuThuocChonModelNut(null);
  datHamTimTaiLieu(null);
});
afterEach(() => {
  nhan.length = 0;
  traVe = [];
  h.hang = {};
});

const ngu = (o: Partial<NguCanhChay> & { muc?: "ky-thuat" | "van-hanh" } = {}, vet: VetModel[] = []): NguCanhChay => {
  const { muc = "ky-thuat", ...rest } = o;
  const n = {
    runId: "r1", flowId: "f1", nodeId: "n", lan: 1, idempotencyKey: "r1:n:1", inputs: { main: [{ json: { a: 1 } }] }, nodes: {}, env: {},
    run: { id: "r1", flowId: "f1", batDau: "x" }, version: 1, nhaMayLuong: F, ghiModel: (v: VetModel) => void vet.push(v), ...rest,
  } as NguCanhChay;
  Object.defineProperty(n, "mucDuLieu", { value: async () => muc, enumerable: false });
  return n;
};

describe("node AI + model ngoài", () => {
  it("ai.llm chonModel ngoai:… ⇒ MỘT lời gọi cổng: nhà máy chủ luồng, nguồn mức 'luong' (của động cơ), không qua engine local; vết mang nhà cung cấp", async () => {
    const vet: VetModel[] = [];
    const ra = (await layNut("ai.llm")!.chay({ loiNhac: "Tóm tắt", chonModel: "ngoai:anthropic:claude-thu" }, ngu({ muc: "van-hanh" }, vet))) as { main: Array<{ json: Record<string, unknown> }> };
    expect(ra.main[0]!.json.traLoi).toBe("xong");
    expect(nhan).toHaveLength(1);
    expect(nhan[0]!.dich).toEqual({ nhaCungCap: "anthropic", model: "claude-thu" });
    expect(nhan[0]!.ngu).toMatchObject({ nhaMayChuDuLieu: [F], nhaMayNguoiGoi: null, flowId: "f1", runId: "r1", tuDong: true });
    expect(nhan[0]!.ngu.nguonMuc.loai).toBe("luong");
    expect(await (nhan[0]!.ngu.nguonMuc as { mucDuLieu: () => Promise<string> }).mucDuLieu()).toBe("van-hanh");
    expect(vet[0]).toMatchObject({ vaiTro: "ngoai", model: "claude-thu", nhaCungCap: "anthropic", tokVao: 3, tokRa: 4 });
  });

  it("luồng toàn hệ thống (nhaMayLuong null) ⇒ danh mục ngoài rỗng ⇒ lỗi node, cổng không được gọi", async () => {
    await expect(layNut("ai.llm")!.chay({ loiNhac: "x", chonModel: "ngoai:anthropic:claude-thu" }, ngu({ nhaMayLuong: null }))).rejects.toThrow(/chonModel/);
    expect(nhan).toHaveLength(0);
  });

  it("lỗi cổng (vd NGOAI_DU_LIEU_VAN_HANH) ⇒ lỗi node mang mã, không rơi về model local", async () => {
    traVe = [new LoiNgoai("NGOAI_DU_LIEU_VAN_HANH")];
    await expect(layNut("ai.tom-tat")!.chay({ chonModel: "ngoai:anthropic:claude-thu" }, ngu())).rejects.toThrow(/NGOAI_DU_LIEU_VAN_HANH/);
  });
});

describe("ai.agent + model ngoài", () => {
  const khai = [
    { flowId: "con-thuan", moTa: "đọc", thamSo: [{ ten: "q", kieu: "chuoi" }] },
    { flowId: "con-ot", moTa: "ghi thiết bị", thamSo: [] },
    { flowId: "con-ghi", moTa: "gửi ra ngoài", thamSo: [] },
  ];

  it("chỉ cấp luồng con hạng thuần / đọc + tra tài liệu; hạng ot / ngoai-ghi bị loại", async () => {
    h.hang = { "con-thuan": "thuan", "con-ot": "ot", "con-ghi": "ngoai-ghi" };
    await layNut("ai.agent")!.chay({ loiNhac: "x", luongCon: khai, traTaiLieu: true, chonModel: "ngoai:anthropic:claude-thu" }, ngu());
    expect(nhan[0]!.congCu!.map((c) => c.ten).sort()).toEqual(["luong_con_thuan", "tra_tai_lieu"]);
  });

  it("phân loại THEO LƯỢT: lượt 1 kỹ thuật; sau khi ghép kết quả tra tài liệu ⇒ lượt 2 van-hanh", async () => {
    datHamTimTaiLieu(async () => ({ doan: [{ nguon: "sop.pdf", diem: 0.9, noiDung: "quy trình" }], daTim: ["all"] }) as never);
    traVe = [{ noiDung: "", toolCalls: [{ ten: "tra_tai_lieu", thamSo: { query: "quy trình" } }] }, { noiDung: "trả lời", toolCalls: [] }];
    const ra = (await layNut("ai.agent")!.chay({ loiNhac: "x", traTaiLieu: true, chonModel: "ngoai:anthropic:claude-thu" }, ngu())) as {
      main: Array<{ json: Record<string, unknown> }>;
    };
    expect(ra.main[0]!.json.traLoi).toBe("trả lời");
    expect(nhan).toHaveLength(2);
    const muc = (i: number) => (nhan[i]!.ngu.nguonMuc as { mucDuLieu: () => Promise<string> }).mucDuLieu();
    expect(await muc(0)).toBe("ky-thuat");
    expect(await muc(1)).toBe("van-hanh");
    expect(nhan[1]!.tinNhan.some((m) => m.vaiTro === "tool" && m.tenTool === "tra_tai_lieu")).toBe(true);
  });

  it("cổng từ chối toolCalls ngoài tập cấp (NGOAI_TOOL_KHONG_CAP) ⇒ node DỪNG, không chạy công cụ nào", async () => {
    let daTra = false;
    datHamTimTaiLieu(async () => ((daTra = true), { doan: [], daTim: [] }) as never);
    traVe = [new LoiNgoai("NGOAI_TOOL_KHONG_CAP", "ot_write")];
    await expect(layNut("ai.agent")!.chay({ loiNhac: "x", traTaiLieu: true, chonModel: "ngoai:anthropic:claude-thu" }, ngu())).rejects.toThrow(/NGOAI_TOOL_KHONG_CAP/);
    expect(daTra).toBe(false);
  });
});
