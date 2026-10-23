/**
 * ★ Đợt 9 (2026-10-23) — vòng kiểm biên dịch ST của TRỢ LÝ (engine + trình biên dịch GIẢ; lõi `kiemVaSuaST` THẬT).
 */
import { describe, expect, it, vi } from "vitest";
import type { GgufChatMessage } from "../../aiGgufEngine";
import { chayKiemBienDichTroLy, nenKiemBienDichTroLy, type KetQuaKiemTroLy, type TienDoKiem } from "./kiemBienDichTroLy";

const FB_SAI = "FUNCTION_BLOCK A\nVAR_INPUT x : BOOL; END_VAR\nVAR_OUTPUT y : BOOL; END_VAR\n  y := x AND ;\nEND_FUNCTION_BLOCK";
const FB_DUNG = "FUNCTION_BLOCK A\nVAR_INPUT x : BOOL; END_VAR\nVAR_OUTPUT y : BOOL; END_VAR\n  y := x;\nEND_FUNCTION_BLOCK";
const rao = (ma: string) => `Mã:\n\`\`\`st\n${ma}\n\`\`\``;
const bienDich = vi.fn(async (ma: string) =>
  ma.includes("AND ;")
    ? { ok: false, chanDoan: [{ tep: "ma.st", dong: 4, cot: 13, mucDo: "error" as const, ma: "E007", thongDiep: "Unexpected token ;" }], ms: 3 }
    : { ok: true, chanDoan: [], ms: 3 },
);
const ketQua = (text: string) => ({ text, tokensPrompt: 9, tokensGenerated: 9, modelId: "gia", totalTimeMs: 1, tokensPerSecond: 1, finishReason: "stop" }) as never;

async function chayHet(it: AsyncGenerator<TienDoKiem, KetQuaKiemTroLy>): Promise<{ kq: KetQuaKiemTroLy; tienDo: TienDoKiem[] }> {
  const tienDo: TienDoKiem[] = [];
  for (;;) {
    const n = await it.next();
    if (n.done) return { kq: n.value, tienDo };
    tienDo.push(n.value);
  }
}

describe("nenKiemBienDichTroLy — cờ + opt-out của lượt", () => {
  it("mặc định (agent-plc,v1-stream) ⇒ TẮT; tro-ly / all ⇒ bật; opt-out false ⇒ tắt; off ⇒ tắt", () => {
    expect(nenKiemBienDichTroLy({}, {})).toBe(false);
    expect(nenKiemBienDichTroLy({}, { AI_KIEM_BIEN_DICH_ST: "tro-ly" })).toBe(true);
    expect(nenKiemBienDichTroLy({}, { AI_KIEM_BIEN_DICH_ST: "agent-plc,tro-ly" })).toBe(true);
    expect(nenKiemBienDichTroLy({}, { AI_KIEM_BIEN_DICH_ST: "all" })).toBe(true);
    expect(nenKiemBienDichTroLy({ kiemBienDichST: false }, { AI_KIEM_BIEN_DICH_ST: "tro-ly" })).toBe(false);
    expect(nenKiemBienDichTroLy({}, { AI_KIEM_BIEN_DICH_ST: "off" })).toBe(false);
    expect(nenKiemBienDichTroLy(undefined, { AI_KIEM_BIEN_DICH_ST: "v1" })).toBe(false);
  });
});

describe("chayKiemBienDichTroLy", () => {
  const coBan = { heThong: "SYS", prompt: "PROMPT (đã che)", modelId: "M27", maxTokens: 16000, bienDich, nhipMs: 5 };

  it("không có mã ST ⇒ bo-qua: không gọi model, không phát tiến độ, không đổi câu trả lời", async () => {
    const chat = vi.fn();
    const { kq, tienDo } = await chayHet(chayKiemBienDichTroLy({ ...coBan, cauTraLoi: "Chỉ là chữ, không có mã.", chat }));
    expect(chat).not.toHaveBeenCalled();
    expect(tienDo).toEqual([]);
    expect(kq).toMatchObject({ traLoiCuoi: null, daThay: false, tomTat: "ok=skip" });
  });

  it("★★★ bản đầu lỗi ⇒ sửa trong CÙNG hội thoại (system, user, assistant=bản trước, user=lỗi) ⇒ bản cuối đã sửa + ghi chú, daThay", async () => {
    const nhan: GgufChatMessage[][] = [];
    const chat = vi.fn(async (m: GgufChatMessage[], modelId: string | undefined, maxTokens: number) => {
      nhan.push(m);
      expect(modelId).toBe("M27");
      expect(maxTokens).toBe(16000);
      return ketQua(`<think>nghĩ</think>Đã sửa:\n\`\`\`st\n${FB_DUNG}\n\`\`\``);
    });
    const ghi = vi.fn();
    const { kq } = await chayHet(
      chayKiemBienDichTroLy({ ...coBan, cauTraLoi: rao(FB_SAI), chat, ghiLuotSua: ghi, locRa: (t) => t.replace("Đã sửa", "Đã sửa (che)") }) as never,
    );
    expect(chat).toHaveBeenCalledTimes(1);
    expect(nhan[0]!.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(nhan[0]![0]!.content).toBe("SYS");
    expect(nhan[0]![1]!.content).toBe("PROMPT (đã che)");
    expect(nhan[0]![2]!.content).toBe(rao(FB_SAI));
    expect(nhan[0]![3]!.content).toContain("E007");
    expect(kq.kq.trangThai).toBe("da-sua");
    expect(kq.daThay).toBe(true);
    expect(kq.traLoiCuoi).toContain(FB_DUNG);
    expect(kq.traLoiCuoi).not.toContain("<think>");
    expect(kq.traLoiCuoi).toContain("Đã sửa (che)");
    expect(kq.traLoiCuoi).toMatch(/---\n✓ Đã tự sửa 1 lỗi biên dịch/);
    expect(kq.tomTat).toMatch(/^ok=1; trang-thai=da-sua; vong=1; sua=1; con=0$/);
    expect(ghi).toHaveBeenCalledTimes(1);
  });

  it("sạch ngay ⇒ không gọi model; ghi chú '✓ không lỗi', KHÔNG thay văn bản", async () => {
    const chat = vi.fn();
    const { kq } = await chayHet(chayKiemBienDichTroLy({ ...coBan, cauTraLoi: rao(FB_DUNG), chat }));
    expect(chat).not.toHaveBeenCalled();
    expect(kq).toMatchObject({ daThay: false, tomTat: expect.stringMatching(/^ok=1; trang-thai=sach/) });
    expect(kq.ghiChu).toContain("không lỗi");
  });

  it("★★ lượt sửa chậm ⇒ phát tool_loop compile_st theo NHỊP (SSE không im > 300 s) rồi 'xong'", async () => {
    const chat = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 40));
      return ketQua(`\`\`\`st\n${FB_DUNG}\n\`\`\``);
    });
    const { tienDo } = await chayHet(chayKiemBienDichTroLy({ ...coBan, cauTraLoi: rao(FB_SAI), chat }));
    expect(tienDo.filter((t) => t.phase === "dang_goi").length).toBeGreaterThanOrEqual(2);
    expect(tienDo.at(-1)).toMatchObject({ type: "tool_loop", phase: "xong", toolName: "compile_st" });
  });

  it("model ném khi sửa ⇒ KHÔNG ném ra ngoài, KHÔNG mất câu trả lời đầu", async () => {
    const chat = vi.fn(async () => {
      throw new Error("khe bận");
    });
    const { kq } = await chayHet(chayKiemBienDichTroLy({ ...coBan, cauTraLoi: rao(FB_SAI), chat }));
    expect(kq.daThay).toBe(false);
    expect(kq.kq.cauTraLoiCuoi).toBe(rao(FB_SAI));
    expect(["con-loi", "khong-kiem-duoc"]).toContain(kq.kq.trangThai);
  });
});
