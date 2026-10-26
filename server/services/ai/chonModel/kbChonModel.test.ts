/**
 * ★ Đợt 10.1 A2 — `context.chonModel` của KB / trợ lý lập trình: `parseContext` chỉ nhận hình dạng `CHON_MODEL_RE`; tuyến
 * giải bằng `apChonModelKb` (lạ ⇒ 400/404); nhánh vận hành dùng `modelVaiTro.modelId` (đối số cuối của
 * `generateWithOllamaStream`); vắng ⇒ không đổi.
 */
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ goi: [] as Array<{ modelId: unknown }> }));

vi.mock("../../aiGgufEngine", async (goc) => {
  const that = await goc<typeof import("../../aiGgufEngine")>();
  return {
    ...that,
    isGgufAvailable: vi.fn(async () => true),
    generateTextStream: async function* (_o: unknown, modelId?: string) {
      h.goi.push({ modelId });
      yield { type: "token", token: "ok" };
      yield { type: "done", fullText: "ok", tokensPrompt: 1, tokensGenerated: 1 };
    },
  };
});
vi.mock("../../aiGateway", async (goc) => {
  const that = await goc<typeof import("../../aiGateway")>();
  return {
    ...that,
    planInference: vi.fn(async (o: { text?: string }) => ({
      decision: { modelId: "model-planner" },
      abVariant: null,
      record: vi.fn(),
      safeText: o?.text ?? "",
      safetyFlags: { injectionRisk: "none", redactions: 0 },
      sanitizeOutput: (t: string) => t,
    })),
  };
});
vi.mock("../../../db/connection", () => ({ getDb: async () => undefined }));

import { parseContext } from "../../../routes/aiLocalKnowledgeApi";
import { generateWithOllamaStream, type KbRetrieveResult } from "../../aiLocalKnowledgeService";
import { apChonModelKb } from "./kbChonModel";
import { NGOAI_RONG, type PhuThuocDanhMuc } from "./kieu";

const dep = async (): Promise<PhuThuocDanhMuc> => ({
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
});

const RETRIEVE = {
  question: "how do I acknowledge an alert?",
  intent: "howto",
  language: "en",
  entities: [],
  confidence: 0.4,
  citations: [],
  contexts: [],
  rerankMs: null,
} as unknown as KbRetrieveResult;

describe("parseContext — chonModel", () => {
  it("nhận đúng hình dạng; auto / tên tệp / rác ⇒ không đặt", () => {
    expect(parseContext({ chonModel: "vai-tro:code.plc" })?.chonModel).toBe("vai-tro:code.plc");
    expect(parseContext({ chonModel: "ho-so:p4b" })?.chonModel).toBe("ho-so:p4b");
    for (const v of ["auto", "Qwen.gguf", "../x", 7, "vai-tro:"]) expect(parseContext({ chonModel: v, codingMode: true })?.chonModel).toBeUndefined();
  });

  it("client KHÔNG đặt được modelVaiTro trực tiếp", () => {
    expect(parseContext({ modelVaiTro: { modelId: "X" }, codingMode: true })?.modelVaiTro).toBeUndefined();
  });
});

describe("apChonModelKb", () => {
  it("vắng ⇒ ngữ cảnh y nguyên (cùng đối tượng)", async () => {
    const ctx = { codingMode: true as const };
    expect(await apChonModelKb(ctx, dep)).toEqual({ ok: true, context: ctx });
    expect(await apChonModelKb(undefined, dep)).toEqual({ ok: true, context: undefined });
  });

  it("ho-so:p4b ⇒ modelVaiTro.modelId = tệp của hồ sơ; vai-tro ⇒ model định tuyến", async () => {
    const a = await apChonModelKb({ chonModel: "ho-so:p4b" }, dep);
    expect(a.ok && a.context?.modelVaiTro).toMatchObject({ modelId: "Model-Nho", nguon: "chon-tuong-minh" });
    const b = await apChonModelKb({ chonModel: "vai-tro:code.plc" }, dep);
    expect(b.ok && b.context?.modelVaiTro).toMatchObject({ modelId: "Model-Code", vaiTro: "code.plc" });
  });

  it("ho-so lạ ⇒ 400; vai không sinh chữ ⇒ 400; ngoai ⇒ 404 — không rơi về mặc định", async () => {
    expect(await apChonModelKb({ chonModel: "ho-so:khong-co" }, dep)).toMatchObject({ ok: false, status: 400, code: "chonModelKhongHopLe" });
    expect(await apChonModelKb({ chonModel: "vai-tro:embed" }, dep)).toMatchObject({ ok: false, status: 400, code: "chonModelKhongSinhChu" });
    expect(await apChonModelKb({ chonModel: "ngoai:anthropic:x" }, dep)).toMatchObject({ ok: false, status: 404 });
  });
});

describe("nhánh vận hành — modelChon tới engine", () => {
  it("có modelChon ⇒ engine nhận đúng model đó; vắng ⇒ model của planner (như cũ)", async () => {
    h.goi = [];
    for await (const _ of generateWithOllamaStream(RETRIEVE.question, RETRIEVE, [], "technical", null, 1, undefined, undefined, "Model-Chon")) { /* drain */ }
    for await (const _ of generateWithOllamaStream(RETRIEVE.question, RETRIEVE, [], "technical")) { /* drain */ }
    expect(h.goi.map((g) => g.modelId)).toEqual(["Model-Chon", "model-planner"]);
  });
});
