/**
 * ★ Đợt 10.1 A2 — `thamSo.chonModel` của node AI Luồng (ai.llm / trich-xuat / phan-loai / tom-tat / sinh-ma): giá trị THÔ
 * (không qua biểu thức), giải bằng hợp đồng chung; lạ ⇒ lỗi node, không rơi mặc định; vắng ⇒ định tuyến vai như cũ.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ chat: [] as Array<{ modelId?: string }> }));
vi.mock("../../aiGateway", () => ({
  routeInference: vi.fn(async (req: any, exec: any) => {
    const { result } = await exec({}, null, req.text);
    return { result, decision: {}, abVariant: null };
  }),
}));
vi.mock("../../aiGgufEngine", () => ({
  chatCompletion: vi.fn(async (_opts: any, modelId?: string) => {
    h.chat.push({ modelId });
    return { text: '{"ma":"x"}', tokensPrompt: 1, tokensGenerated: 1 };
  }),
}));

import { layNut, type NguCanhChay, type VetModel } from "../dangKyNut";
import { datPhuThuocChonModelNut } from "./ai";
import "./sinhMa";
import { NGOAI_RONG } from "../../ai/chonModel/kieu";

datPhuThuocChonModelNut(async () => ({
  anh: {
    taiLuc: 1,
    vaiTro: new Map(),
    profile: new Map([["p4b", { artifactFile: "Model-Nho.gguf", slotClass: "nho", artifactStatus: "available", license: "mit", enabled: true }]]),
    gan: [],
  },
  hoSoCoDo: new Set(["p4b"]),
  kheDangGiu: null,
  uocTinhDoiKheGiay: async () => null,
  ngoai: NGOAI_RONG,
  env: { GGUF_CODE_MODEL: "Model-Code.gguf", GGUF_DEFAULT_MODEL: "Model-Mac-Dinh.gguf" },
}));
afterAll(() => datPhuThuocChonModelNut(null));
afterEach(() => {
  h.chat.length = 0;
});

const ngu = (vet: VetModel[] = []): NguCanhChay =>
  ({
    runId: "r", flowId: "f", nodeId: "n", lan: 1, idempotencyKey: "r:n:1", inputs: { main: [{ json: { m: "ho-so:p4b" } }] },
    nodes: {}, env: {}, run: { id: "r", flowId: "f", batDau: "x" }, ghiModel: (v: VetModel) => void vet.push(v),
  }) as unknown as NguCanhChay;

describe("node AI — chonModel", () => {
  it.each([
    ["ai.llm", { loiNhac: "x" }],
    ["ai.trich-xuat", { truong: [{ ten: "ma", kieu: "chuoi" }] }],
    ["ai.phan-loai", { nhan: ["a", "b"] }],
    ["ai.tom-tat", {}],
    ["ai.sinh-ma", { moTa: "viết hàm", ngonNgu: "khac" }],
  ])("%s + chonModel ho-so:p4b ⇒ engine nhận đúng tệp hồ sơ; vết 'chọn tường minh'", async (loai, thamSo) => {
    const vet: VetModel[] = [];
    await layNut(loai)!.chay({ ...thamSo, chonModel: "ho-so:p4b" }, ngu(vet));
    expect(h.chat.map((c) => c.modelId)).toEqual(["Model-Nho"]);
    expect(vet[0]).toMatchObject({ vaiTro: "ho-so", model: "Model-Nho", nguon: "chon-tuong-minh", lyDo: ["chọn tường minh ho-so:p4b"] });
  });

  it("chonModel là BIỂU THỨC (`{{ $json.m }}`) ⇒ lỗi node — dữ liệu item không chọn được model", async () => {
    await expect(layNut("ai.llm")!.chay({ loiNhac: "x", chonModel: "{{ $json.m }}" }, ngu())).rejects.toThrow(/chonModel/);
    expect(h.chat).toHaveLength(0);
  });

  it.each(["Qwen.gguf", "ho-so:khong-co", "vai-tro:embed", "ngoai:anthropic:x"])("%s ⇒ lỗi node, engine không được gọi", async (v) => {
    await expect(layNut("ai.llm")!.chay({ loiNhac: "x", chonModel: v }, ngu())).rejects.toThrow(/chonModel/);
    expect(h.chat).toHaveLength(0);
  });

  it("vắng / auto ⇒ định tuyến vai như cũ (không qua danh mục)", async () => {
    process.env.GGUF_CODE_MODEL = "Coder-Cu.gguf";
    await layNut("ai.llm")!.chay({ loiNhac: "x", vaiTro: "code.plc" }, ngu());
    await layNut("ai.llm")!.chay({ loiNhac: "x", vaiTro: "code.plc", chonModel: "auto" }, ngu());
    expect(h.chat.map((c) => c.modelId)).toEqual(["Coder-Cu", "Coder-Cu"]);
  });
});
