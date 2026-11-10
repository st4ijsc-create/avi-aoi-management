import { describe, expect, it, vi } from "vitest";
import { chayTuKiemMa } from "./aiLocalKnowledgeCodingTuKiemMa";

vi.mock("./ai/tuKiemMa/bienDichMa", () => ({
  bienDichMa: vi.fn(async () => ({ trangThai: "loi", chanDoan: [{ dong: 1, cot: 1, ma: "CS0122", thongDiep: "x" }] })),
}));

const CS = "```csharp\nclass A {}\n```";

describe("chayTuKiemMa (lát nối)", () => {
  it("cờ TẮT (mặc định) ⇒ null và KHÔNG gọi model", async () => {
    const goiLai = vi.fn(async () => "x");
    expect(await chayTuKiemMa({ cauTraLoi: CS, goiLai, env: {} })).toBeNull();
    expect(await chayTuKiemMa({ cauTraLoi: CS, goiLai, env: { AI_CHAT_TU_KIEM_MA: "0" } })).toBeNull();
    expect(goiLai).not.toHaveBeenCalled();
  });
  it("cờ BẬT ⇒ chạy vòng, tôn trọng AI_CHAT_TU_KIEM_VONG", async () => {
    const goiLai = vi.fn(async () => "```csharp\nclass B {}\n```");
    const r = await chayTuKiemMa({ cauTraLoi: CS, goiLai, env: { AI_CHAT_TU_KIEM_MA: "1", AI_CHAT_TU_KIEM_VONG: "1" } });
    expect(r?.ketQua.trangThai).toBe("con-loi");
    expect(r?.nguon).toBe("env");
    expect(goiLai).toHaveBeenCalledTimes(1);
    const r2 = await chayTuKiemMa({ cauTraLoi: CS, goiLai, env: { AI_CHAT_TU_KIEM_MA: "1" } });
    expect(r2?.ketQua.soVong).toBe(2);
  });
  it("★★★ theo-luot: context true ⇒ chạy (nguon luot); context vắng/false ⇒ null; env vắng/0 + context true ⇒ null, KHÔNG gọi model", async () => {
    const goiLai = vi.fn(async () => "```csharp\nclass B {}\n```");
    const env = { AI_CHAT_TU_KIEM_MA: "theo-luot" };
    const r = await chayTuKiemMa({ cauTraLoi: CS, goiLai, env, tuKiemMaLuot: true });
    expect(r?.nguon).toBe("luot");
    expect(goiLai).toHaveBeenCalled();
    goiLai.mockClear();
    expect(await chayTuKiemMa({ cauTraLoi: CS, goiLai, env })).toBeNull();
    expect(await chayTuKiemMa({ cauTraLoi: CS, goiLai, env, tuKiemMaLuot: false })).toBeNull();
    expect(await chayTuKiemMa({ cauTraLoi: CS, goiLai, env: {}, tuKiemMaLuot: true })).toBeNull();
    expect(await chayTuKiemMa({ cauTraLoi: CS, goiLai, env: { AI_CHAT_TU_KIEM_MA: "0" }, tuKiemMaLuot: true })).toBeNull();
    expect(goiLai).not.toHaveBeenCalled();
  });
  it("lỗi bất ngờ không ném ra ngoài (trừ huỷ)", async () => {
    const goiLai = vi.fn(async () => "");
    const r = await chayTuKiemMa({ cauTraLoi: CS, goiLai, env: { AI_CHAT_TU_KIEM_MA: "1" } });
    expect(r).not.toBeNull();
  });
});
