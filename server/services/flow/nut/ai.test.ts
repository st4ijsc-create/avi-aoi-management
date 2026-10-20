/**
 * Đợt 8.1 — node AI: (1) đường mặc định đi qua Cổng AI với audit `flow_<loại>` và model theo VAI TRÒ;
 * (2) hành vi node với hàm gọi giả (trích xuất hỏi lại khi sai schema, phân loại danh sách đóng, bọc dữ liệu không tin cậy).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ route: [] as any[], chat: [] as any[] }));
vi.mock("../../aiGateway", () => ({
  routeInference: vi.fn(async (req: any, exec: any) => {
    h.route.push(req);
    const { result } = await exec({}, null, `[da-che]${req.text}`);
    return { result, decision: {}, abVariant: null };
  }),
}));
vi.mock("../../aiGgufEngine", () => ({
  chatCompletion: vi.fn(async (opts: any, modelId?: string) => {
    h.chat.push({ opts, modelId });
    return { text: "  ket qua  ", tokensPrompt: 1, tokensGenerated: 1 };
  }),
}));

import { datHamGoiAi, kiemTheoTruong, type HamGoiAi } from "./ai";
import { layNut, type NguCanhChay } from "../dangKyNut";

const ngu = (main: { json: Record<string, unknown> }[]): NguCanhChay => ({
  runId: "r", flowId: "f", nodeId: "n", lan: 1, idempotencyKey: "r:n:1", inputs: { main }, nodes: {}, env: {}, run: { id: "r", flowId: "f", batDau: "x" },
});

describe("node AI (Đợt 8.1)", () => {
  afterEach(() => {
    h.route.length = 0;
    h.chat.length = 0;
  });

  it("ai.llm mặc định: Cổng AI (audit flow_llm, văn bản đã che) + model theo vai trò code.plc; nghĩ tắt mặc định", async () => {
    process.env.GGUF_CODE_MODEL = "Coder-30B.gguf";
    const ra = await layNut("ai.llm")!.chay({ vaiTro: "code.plc", loiNhac: "Viết FB cho {{ $json.may }}" }, ngu([{ json: { may: "BT1" } }]));
    expect(h.route[0]).toMatchObject({ task: "code", auditTask: "flow_llm", text: "Viết FB cho BT1" });
    expect(h.chat[0].modelId).toBe("Coder-30B");
    expect(h.chat[0].opts.messages[1].content).toBe("[da-che]Viết FB cho BT1");
    expect(h.chat[0].opts.disableThinking).toBe(true);
    expect(ra.main[0].json).toEqual({ may: "BT1", traLoi: "ket qua" });
  });

  it("ai.trich-xuat: sai schema ⇒ hỏi lại kèm lỗi; đúng ⇒ trường đã kiểm; sai hai lần ⇒ ném", async () => {
    const tra = ['{"ma": 5}', '{"ma": "L-01", "soLuong": 3}'];
    const loiNhac: string[] = [];
    const cu = datHamGoiAi((async (y) => { loiNhac.push(y.nguoiDung); return tra.shift()!; }) as HamGoiAi);
    try {
      const thamSo = { truong: [{ ten: "ma", kieu: "chuoi", batBuoc: true }, { ten: "soLuong", kieu: "so" }] };
      const ra = await layNut("ai.trich-xuat")!.chay(thamSo, ngu([{ json: { vanBan: "Lô L-01, 3 chiếc" } }]));
      expect(ra.main[0].json.trichXuat).toEqual({ ma: "L-01", soLuong: 3 });
      expect(loiNhac[1]).toMatch(/Lần trước sai: trường "ma" phải là chuoi/);
      expect(loiNhac[0]).toMatch(/<du_lieu>[\s\S]*L-01[\s\S]*<\/du_lieu>/);
      tra.push("không phải json", "{}");
      await expect(layNut("ai.trich-xuat")!.chay(thamSo, ngu([{ json: {} }]))).rejects.toThrow(/sai schema hai lần/);
    } finally {
      datHamGoiAi(cu);
    }
  });

  it("ai.phan-loai: chỉ nhãn trong danh sách, ngoài danh sách ⇒ khac", async () => {
    const tra = ["Bảo trì.", "linh tinh"];
    const cu = datHamGoiAi((async () => tra.shift()!) as HamGoiAi);
    try {
      const ra = await layNut("ai.phan-loai")!.chay({ nhan: ["Bảo trì", "Chất lượng"] }, ngu([{ json: { a: 1 } }, { json: { a: 2 } }]));
      expect(ra.main.map((x) => x.json.nhan)).toEqual(["Bảo trì", "khac"]);
    } finally {
      datHamGoiAi(cu);
    }
  });

  it("ai.tom-tat: gom mọi item thành một", async () => {
    const cu = datHamGoiAi((async (y) => `tóm ${y.nguoiDung.includes('"a": 2')}`) as HamGoiAi);
    try {
      const ra = await layNut("ai.tom-tat")!.chay({}, ngu([{ json: { a: 1 } }, { json: { a: 2 } }]));
      expect(ra.main).toEqual([{ json: { tomTat: "tóm true", soItem: 2 } }]);
    } finally {
      datHamGoiAi(cu);
    }
  });

  it("kiemTheoTruong: bắt buộc, kiểu, khối ```json", () => {
    expect(kiemTheoTruong('```json\n{"a": true}\n```', [{ ten: "a", kieu: "boolean" }])).toEqual({ ok: true, v: { a: true } });
    expect(kiemTheoTruong("{}", [{ ten: "a", kieu: "so", batBuoc: true }])).toMatchObject({ ok: false });
  });
});
