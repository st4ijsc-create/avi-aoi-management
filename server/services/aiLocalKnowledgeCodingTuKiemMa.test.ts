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
    expect(r?.trangThai).toBe("con-loi");
    expect(goiLai).toHaveBeenCalledTimes(1);
    const r2 = await chayTuKiemMa({ cauTraLoi: CS, goiLai, env: { AI_CHAT_TU_KIEM_MA: "1" } });
    expect(r2?.soVong).toBe(2);
  });
  it("lỗi bất ngờ không ném ra ngoài (trừ huỷ)", async () => {
    const goiLai = vi.fn(async () => "");
    const r = await chayTuKiemMa({ cauTraLoi: CS, goiLai, env: { AI_CHAT_TU_KIEM_MA: "1" } });
    expect(r).not.toBeNull();
  });
});
