/**
 * ★ Đợt 10.1 A4 — `ai.agent` định tuyến model ĐÚNG phạm vi luồng (gán `flow:<id>` thắng gán toàn cục), không kéo đổi khe với
 * vai nhẹ (`khongDoiKhe`), và ghi vết `buoc.model` mỗi lượt model — cùng hợp đồng với node AI (`goiAi` / `goiAiCoVet`).
 * Trước A4: `resolveLogicalModel(vaiTro)` trần ⇒ bỏ qua phạm vi, không vết.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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
    return { text: "xong", toolCalls: [], tokensPrompt: 1, tokensGenerated: 1 };
  }),
}));

import { datAnhSoModel, layAnhSoModel, type AnhSoModel } from "../../ai/soModel/anhSoModel";
import { VAI_TRO_GOC } from "../../../../shared/aiRoles";
import { layNut, type KetQuaChay, type NguCanhChay, type VetModel } from "../dangKyNut";
import { datPhuThuocChonModelNut } from "./ai";
import "./agent";

const M35 = "Qwen3.6-35B-A3B-UD-Q4_K_XL";
const M27 = "Qwen3.6-27B-UD-Q4_K_XL";
const P = (f: string) => ({ artifactFile: `${f}.gguf`, slotClass: "nang" as const, artifactStatus: "available", license: "apache-2.0", enabled: true });
const ANH: AnhSoModel = {
  taiLuc: 1,
  vaiTro: new Map(VAI_TRO_GOC.map((v) => [v.id, { envKey: v.envKey, taskKind: v.taskKind }])),
  profile: new Map([
    ["p27", P(M27)],
    ["p35", P(M35)],
  ]),
  gan: [
    { roleId: "code.plc", scopeKind: "global", scopeId: null, profileId: "p35", envKey: null, fallback: [], mode: "active" },
    { roleId: "code.plc", scopeKind: "flow", scopeId: "f1", profileId: "p27", envKey: null, fallback: [], mode: "active" },
    { roleId: "summarize", scopeKind: "global", scopeId: null, profileId: "p27", envKey: null, fallback: [], mode: "active" },
  ],
};
const ENV = ["GGUF_DEFAULT_MODEL", "GGUF_CODE_MODEL", "LLAMA_SERVER_MODEL"] as const;
const cu: Record<string, string | undefined> = {};
let anhCu: AnhSoModel;

beforeAll(() => {
  for (const k of ENV) {
    cu[k] = process.env[k];
    process.env[k] = `${M35}.gguf`;
  }
  anhCu = layAnhSoModel();
  datAnhSoModel(ANH);
});
afterAll(() => {
  for (const k of ENV) (cu[k] === undefined ? delete process.env[k] : (process.env[k] = cu[k]));
  datAnhSoModel(anhCu);
  datPhuThuocChonModelNut(null);
});
afterEach(() => {
  h.chat.length = 0;
});

const ngu = (flowId: string, vet: VetModel[]): NguCanhChay =>
  ({
    runId: "r",
    flowId,
    nodeId: "n",
    lan: 1,
    idempotencyKey: "r:n:1",
    inputs: { main: [{ json: {} }] },
    nodes: {},
    env: {},
    run: { id: "r", flowId, batDau: "x" },
    ghiModel: (v: VetModel) => void vet.push(v),
  }) as unknown as NguCanhChay;

describe("ai.agent — phạm vi luồng (A4)", () => {
  it("★ gán phạm vi flow:f1 thắng gán toàn cục ⇒ engine nhận 27B trong f1, 35B ở luồng khác; vết ghi đúng 1 lần/lượt", async () => {
    const vet1: VetModel[] = [];
    await layNut("ai.agent")!.chay({ vaiTro: "code.plc", loiNhac: "x" }, ngu("f1", vet1));
    const vet2: VetModel[] = [];
    await layNut("ai.agent")!.chay({ vaiTro: "code.plc", loiNhac: "x" }, ngu("f2", vet2));
    expect(h.chat.map((c) => c.modelId)).toEqual([M27, M35]);
    expect(vet1).toHaveLength(1);
    expect(vet1[0]).toMatchObject({ vaiTro: "code.plc", model: M27, phamVi: "flow" });
    expect(vet2[0]).toMatchObject({ vaiTro: "code.plc", model: M35, phamVi: "global" });
  });

  it("vai NHẸ (summarize) gán hồ sơ nặng khe không giữ ⇒ không đổi khe (khongDoiKhe) ⇒ dự phòng env 35B", async () => {
    const vet: VetModel[] = [];
    await layNut("ai.agent")!.chay({ vaiTro: "summarize", loiNhac: "x" }, ngu("f9", vet));
    expect(h.chat[0]!.modelId).toBe(M35);
    expect(vet[0]).toMatchObject({ vaiTro: "summarize", duPhong: true, kheBan: true });
  });

  it("chonModel THÔ ho-so:p27 ⇒ engine nhận 27B, vết 'chọn tường minh'; chuỗi biểu thức / tên tệp ⇒ lỗi node", async () => {
    datPhuThuocChonModelNut(async () => ({
      anh: ANH,
      hoSoCoDo: new Set(["p27", "p35"]),
      kheDangGiu: M35,
      uocTinhDoiKheGiay: async () => null,
      ngoai: { layModelDaBat: async () => [] },
      env: { LLAMA_SERVER_MODEL: `${M35}.gguf` },
    }));
    const vet: VetModel[] = [];
    await layNut("ai.agent")!.chay({ vaiTro: "chat", loiNhac: "x", chonModel: "ho-so:p27" }, ngu("f9", vet));
    expect(h.chat[0]!.modelId).toBe(M27);
    expect(vet[0]!.lyDo).toEqual(["chọn tường minh ho-so:p27"]);
    for (const sai of ["{{ $json.m }}", `${M27}.gguf`, "ngoai:anthropic:x"]) {
      await expect(layNut("ai.agent")!.chay({ vaiTro: "chat", loiNhac: "x", chonModel: sai }, ngu("f9", []))).rejects.toThrow(/chonModel/);
    }
  });
});
