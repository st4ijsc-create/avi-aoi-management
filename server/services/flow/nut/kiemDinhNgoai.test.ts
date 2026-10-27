/**
 * ★ Đợt 10.4 (T1c) — node `ai.kiem-dinh-ngoai`: chonModel CỐ ĐỊNH `ngoai:…` (không auto / cục bộ / biểu thức); mỗi item một lần kiểm định qua
 * CỔNG (giả: `datHamGoiNgoaiNut`) với nhà máy chủ luồng + mức của động cơ; KHÔNG công cụ; kết quả qua `parseKetQuaKiemDinh`; trần item;
 * hạng ngoai-ghi + atMostOnce; lúc lưu kiểm chonModel; chạy thử chỉ xem trước; xuất/nhập đưa chonModel về trống.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { layNut, type NguCanhChay } from "../dangKyNut";
import { datHamGoiNgoaiNut, datPhuThuocChonModelNut } from "./ai";
import { TRAN_ITEM_KIEM_DINH } from "./kiemDinhNgoai";
import { kiemThamSoNutMoi } from "../kiemThamSoNut";
import { NUT_XEM_TRUOC } from "../chayThuNut";
import { lamSachLuong } from "../xuatNhap";
import { coNodeNgoai } from "../../ai/ngoai/duyetNgoai";
import type { YeuCauGoiNgoai } from "../../ai/ngoai/congNgoai";
import type { FlowDefinition } from "../../../../shared/flow/model";
import "./index";

const F = 42;
const HOP_LE = { ketLuan: "dat", diem: 90, loi: [{ muc: "nhe", moTa: "đặt tên biến" }], baiHocDeXuat: [] };
const nhan: YeuCauGoiNgoai[] = [];
let traVe: string[] = [];
datHamGoiNgoaiNut(async (yc) => {
  nhan.push(yc);
  return { noiDung: traVe.shift() ?? JSON.stringify(HOP_LE), toolCalls: [], tokenVao: 10, tokenRa: 5 };
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
});
afterEach(() => {
  nhan.length = 0;
  traVe = [];
});

const ngu = (items: Array<{ json: Record<string, unknown> }>, muc: "ky-thuat" | "van-hanh" = "ky-thuat"): NguCanhChay => {
  const n = {
    runId: "r1", flowId: "f1", nodeId: "kd", lan: 1, idempotencyKey: "r1:kd:1", inputs: { main: items }, nodes: {}, env: {},
    run: { id: "r1", flowId: "f1", batDau: "x" }, version: 3, nhaMayLuong: F,
  } as NguCanhChay;
  Object.defineProperty(n, "mucDuLieu", { value: async () => muc, enumerable: false });
  return n;
};
const NUT = () => layNut("ai.kiem-dinh-ngoai")!;
const TS = { chonModel: "ngoai:anthropic:claude-thu", cauHoi: "{{ $json.hoi }}", traLoi: "{{ $json.dap }}", tieuChi: "đúng + an toàn" };
const loiCua = async (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);

describe("ai.kiem-dinh-ngoai — chạy", () => {
  it("mỗi item một lần kiểm định qua cổng: nhà máy chủ luồng + phiên bản + nguồn mức 'luong'; KHÔNG congCu; đầu ra kiemDinh + kiemDinhVet", async () => {
    const ra = (await NUT().chay(TS, ngu([{ json: { hoi: "cộng 2 số", dap: "a+b", giu: 1 } }], "van-hanh"))) as { main: Array<{ json: Record<string, unknown> }> };
    expect(nhan).toHaveLength(1);
    const y = nhan[0]!;
    expect(y).not.toHaveProperty("congCu");
    expect(y.dich).toEqual({ nhaCungCap: "anthropic", model: "claude-thu" });
    expect(y.mucDich).toBe("kiem-dinh");
    expect(y.ngu).toMatchObject({ nhaMayChuDuLieu: [F], flowId: "f1", runId: "r1", phienBan: 3, tuDong: true, nguonMuc: { loai: "luong" } });
    expect(y.tinNhan[1]!.noiDung).toContain("cộng 2 số");
    expect(y.tinNhan[1]!.noiDung).toContain("a+b");
    const j = ra.main[0]!.json;
    expect(j).toMatchObject({ giu: 1, kiemDinh: { ketLuan: "dat", diem: 90 }, kiemDinhVet: { nhaCungCap: "anthropic", model: "claude-thu", soLanGoi: 1 } });
  });

  it("truongRa tuỳ chỉnh; kết quả sai định dạng 2 lần ⇒ node LỖI (không item nửa vời)", async () => {
    const ra = (await NUT().chay({ ...TS, truongRa: "kd" }, ngu([{ json: { hoi: "q", dap: "a" } }]))) as { main: Array<{ json: Record<string, unknown> }> };
    expect(ra.main[0]!.json).toHaveProperty("kd");
    traVe = ["rác", "vẫn rác"];
    expect(await loiCua(NUT().chay(TS, ngu([{ json: { hoi: "q", dap: "a" } }])))).toContain("NGOAI_SAI_SCHEMA");
  });

  it("chonModel không phải ngoai cố định (auto / vai-tro / biểu thức / vắng) ⇒ lỗi, cổng KHÔNG được gọi", async () => {
    for (const c of ["auto", "vai-tro:chat", "{{ $json.m }}", undefined, "ngoai:anthropic:khong-co"]) {
      expect(await loiCua(NUT().chay({ ...TS, chonModel: c }, ngu([{ json: { hoi: "q", dap: "a" } }]))), String(c)).toBeTruthy();
    }
    expect(nhan).toHaveLength(0);
  });

  it("rà kiem-dinh D7 — truongRa sai tên LÚC CHẠY (a-b / rỗng / không phải chuỗi) ⇒ node lỗi, cổng KHÔNG được gọi", async () => {
    for (const truongRa of ["a-b", "", 5, "__proto__x-"]) {
      expect(await loiCua(NUT().chay({ ...TS, truongRa }, ngu([{ json: { hoi: "q", dap: "a" } }]))), String(truongRa)).toContain("truongRa");
    }
    expect(nhan).toHaveLength(0);
  });

  it(`vượt ${TRAN_ITEM_KIEM_DINH} item ⇒ lỗi rõ, không gọi; traLoi rỗng ⇒ lỗi`, async () => {
    const nhieu = Array.from({ length: TRAN_ITEM_KIEM_DINH + 1 }, () => ({ json: { hoi: "q", dap: "a" } }));
    expect(await loiCua(NUT().chay(TS, ngu(nhieu)))).toContain(`tối đa ${TRAN_ITEM_KIEM_DINH}`);
    expect(await loiCua(NUT().chay(TS, ngu([{ json: { hoi: "q", dap: "  " } }])))).toContain("traLoi rỗng");
    expect(nhan).toHaveLength(0);
  });

  it("đăng ký: hạng ngoai-ghi, atMostOnce", () => {
    expect(NUT()).toMatchObject({ tacDungPhu: "ngoai-ghi", lapLai: "atMostOnce" });
  });
});

describe("ai.kiem-dinh-ngoai — lưu / chạy thử / xuất", () => {
  const def = (chonModel: unknown) => ({ nodes: [{ id: "kd", type: "ai.kiem-dinh-ngoai", parameters: { ...TS, chonModel } }] });
  it("lúc lưu: chonModel phải là ngoai cố định; VẮNG / rỗng (việc phải điền) chấp nhận; truongRa sai tên ⇒ lỗi", () => {
    expect(kiemThamSoNutMoi(def("ngoai:anthropic:claude-thu"))).toEqual([]);
    expect(kiemThamSoNutMoi(def(""))).toEqual([]);
    expect(kiemThamSoNutMoi(def(undefined))).toEqual([]);
    for (const c of ["auto", "vai-tro:chat", "{{ $json.m }}", 5]) {
      const l = kiemThamSoNutMoi(def(c));
      expect(l, String(c)).toHaveLength(1); // ĐÚNG một lỗi (không nhân đôi với kiểm chonModel chung của node ai.*)
      expect(l[0], String(c)).toContain("chonModel");
    }
    // biên luong-ui báo: node mới thả lên canvas (chonModel "" + biểu thức cauHoi/traLoi + truongRa mặc định) ⇒ lưu được
    expect(kiemThamSoNutMoi({ nodes: [{ id: "n", type: "ai.kiem-dinh-ngoai", parameters: { chonModel: "", cauHoi: "{{ $json.cauHoi }}", traLoi: "{{ $json.traLoi }}", truongRa: "kiemDinh" } }] })).toEqual([]);
    expect(kiemThamSoNutMoi({ nodes: [{ id: "kd", type: "ai.kiem-dinh-ngoai", parameters: { ...TS, truongRa: "a-b" } }] }).join()).toContain("truongRa");
  });

  it("node ngoai ⇒ phiên bản cần duyệt (coNodeNgoai); chạy thử chỉ XEM TRƯỚC; xuất ⇒ bỏ chonModel + ĐÚNG MỘT việc chon-model", () => {
    const d = { id: "x", name: "x", version: 1, nodes: [{ id: "kd", type: "ai.kiem-dinh-ngoai", typeVersion: 1, name: "kd", position: [0, 0], parameters: { ...TS } }], connections: [] } as unknown as FlowDefinition;
    expect(coNodeNgoai(d)).toBe(true);
    expect(NUT_XEM_TRUOC.has("ai.kiem-dinh-ngoai")).toBe(true);
    const { luong, viec } = lamSachLuong(d);
    expect(luong.nodes[0]!.parameters).not.toHaveProperty("chonModel");
    expect(viec.filter((v) => v.nodeId === "kd")).toEqual([{ nodeId: "kd", truong: "chonModel", viec: "chon-model" }]); // đúng MỘT việc
  });
});
