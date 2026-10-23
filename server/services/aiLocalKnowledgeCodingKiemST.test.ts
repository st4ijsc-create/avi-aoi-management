/**
 * ★★ Đợt 9 — lát mỏng vòng kiểm biên dịch ST của trợ lý / Cmd+K: cờ, sự kiện SSE, gói gửi client, khối bổ sung.
 * Trình biên dịch GIẢ (mã chứa "AND ;" ⇒ lỗi) — không docker, không GPU, không model.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./flow/lib/bienDichST", async (importOriginal) => {
  const that = await importOriginal<typeof import("./flow/lib/bienDichST")>();
  return {
    ...that,
    bienDichST: async (ma: string) =>
      ma.includes("AND ;")
        ? { ok: false, ms: 3, chanDoan: [{ tep: "ma.st", dong: 4, cot: 3, mucDo: "error", ma: "E007", thongDiep: "Unexpected token" }] }
        : { ok: true, ms: 3, chanDoan: [] },
  };
});

import { boTepTuCauTraLoi, chayKiemBienDichST, dtoKiemBienDich, khoiBoSungSauBienDich } from "./aiLocalKnowledgeCodingKiemST";
import type { StreamEvent } from "./aiLocalKnowledgeService";

const FB_DUNG = "FUNCTION_BLOCK A\nVAR_INPUT x : BOOL; END_VAR\nVAR_OUTPUT y : BOOL; END_VAR\n  y := x;\nEND_FUNCTION_BLOCK";
const FB_SAI = "FUNCTION_BLOCK A\nVAR_INPUT x : BOOL; END_VAR\nVAR_OUTPUT y : BOOL; END_VAR\n  y := x AND ;\nEND_FUNCTION_BLOCK";
const tl = (ma: string) => `Đây là mã:\n\`\`\`st\n${ma}\n\`\`\`\nGiải thích.`;

afterEach(() => {
  delete process.env.AI_KIEM_BIEN_DICH_ST;
});

async function chay(cauTraLoi: string, goiLai: (t: string, l: string) => Promise<string>, beMat: "tro-ly" | "cmdk" = "tro-ly") {
  const g = chayKiemBienDichST({ beMat, cauTraLoi, goiLai });
  const su: StreamEvent[] = [];
  for (;;) {
    const n = await g.next();
    if (n.done) return { su, kq: n.value };
    su.push(n.value);
  }
}

describe("chayKiemBienDichST — cờ và sự kiện", () => {
  it("cờ TẮT (mặc định) ⇒ null, KHÔNG sự kiện, KHÔNG gọi model", async () => {
    const goiLai = vi.fn(async () => tl(FB_DUNG));
    const { su, kq } = await chay(tl(FB_SAI), goiLai);
    expect(kq).toBeNull();
    expect(su).toEqual([]);
    expect(goiLai).not.toHaveBeenCalled();
  });

  it("cờ bật cho bề mặt KHÁC ⇒ vẫn tắt (cmdk không bật cho tro-ly)", async () => {
    process.env.AI_KIEM_BIEN_DICH_ST = "cmdk";
    const { su, kq } = await chay(tl(FB_SAI), async () => tl(FB_DUNG), "tro-ly");
    expect(kq).toBeNull();
    expect(su).toEqual([]);
  });

  it("cờ bật, câu trả lời không có mã ST ⇒ null, không sự kiện", async () => {
    process.env.AI_KIEM_BIEN_DICH_ST = "all";
    const { su, kq } = await chay("Chỉ là văn bản, không có mã.", async () => "");
    expect(kq).toBeNull();
    expect(su).toEqual([]);
  });

  it("mã sạch ⇒ dang-kiem rồi xong(sach); không khối bổ sung", async () => {
    process.env.AI_KIEM_BIEN_DICH_ST = "tro-ly";
    const { su, kq } = await chay(tl(FB_DUNG), async () => "x");
    expect(su.map((e) => (e.type === "kiem_bien_dich" ? e.phase : e.type))).toEqual(["dang-kiem", "xong"]);
    const xong = su[1] as Extract<StreamEvent, { type: "kiem_bien_dich" }>;
    expect(xong.ketQua).toMatchObject({ trangThai: "sach", soVong: 0, cauTraLoiDau: null });
    expect(khoiBoSungSauBienDich(kq!, "vi")).toBe("");
  });

  it("lỗi rồi model sửa được ⇒ da-sua: gói mang bản ĐẦU, khối bổ sung có tiêu đề + bản đã sửa (3 ngôn ngữ)", async () => {
    process.env.AI_KIEM_BIEN_DICH_ST = "all";
    const goiLai = vi.fn(async (tin: string) => {
      expect(tin).toContain("E007");
      return tl(FB_DUNG);
    });
    const dau = tl(FB_SAI);
    const { su, kq } = await chay(dau, goiLai);
    expect(goiLai).toHaveBeenCalledTimes(1);
    expect(kq!.trangThai).toBe("da-sua");
    const xong = su[1] as Extract<StreamEvent, { type: "kiem_bien_dich" }>;
    expect(xong.ketQua).toMatchObject({ trangThai: "da-sua", soVong: 1, soLoiDaSua: 1, cauTraLoiDau: dau, chanDoan: [] });
    expect(khoiBoSungSauBienDich(kq!, "vi")).toContain("Bản đã sửa sau biên dịch");
    expect(khoiBoSungSauBienDich(kq!, "en")).toContain("Version corrected after compiling");
    expect(khoiBoSungSauBienDich(kq!, "zh")).toContain("编译后修正的版本");
    expect(khoiBoSungSauBienDich(kq!, "vi")).toContain("y := x;");
  });

  it("model không sửa được ⇒ con-loi: gói mang chẩn đoán (≤20, không mã nguồn), bổ sung liệt kê lỗi, bản gốc không bị thay", async () => {
    process.env.AI_KIEM_BIEN_DICH_ST = "all";
    const { su, kq } = await chay(tl(FB_SAI), async () => tl(FB_SAI));
    expect(kq!.trangThai).toBe("con-loi");
    const xong = su[1] as Extract<StreamEvent, { type: "kiem_bien_dich" }>;
    expect(xong.ketQua!.chanDoan).toHaveLength(1);
    expect(xong.ketQua!.chanDoan[0]).toMatchObject({ dong: 4, ma: "E007" });
    expect(JSON.stringify(xong.ketQua!.chanDoan)).not.toContain("FUNCTION_BLOCK");
    const them = khoiBoSungSauBienDich(kq!, "vi");
    expect(them).toContain("error[E007]");
    expect(them).not.toContain("Bản đã sửa");
  });

  it("model hỏng giữa vòng ⇒ không ném, ra con-loi (câu trả lời không bị chặn)", async () => {
    process.env.AI_KIEM_BIEN_DICH_ST = "all";
    const { kq } = await chay(tl(FB_SAI), async () => {
      throw new Error("model_khong_tra_loi");
    });
    expect(kq!.trangThai).toBe("con-loi");
  });
});

describe("dtoKiemBienDich / boTepTuCauTraLoi", () => {
  it("chỉ lấy khối ST đầu tiên; không có ⇒ null", () => {
    expect(boTepTuCauTraLoi(tl(FB_DUNG))).toContain("FUNCTION_BLOCK A");
    expect(boTepTuCauTraLoi("không có mã")).toBeNull();
  });
  it("cauTraLoiDau null khi bản trả về TRÙNG bản đầu (không có gì để xem lại)", () => {
    const k = { trangThai: "con-loi", lyDo: null, phuongNgu: "st", trinhDich: "rusty", soVong: 2, soLoiDaSua: 0, chanDoanCuoi: [], cauTraLoiDau: "a", cauTraLoiCuoi: "a", msThem: 1 } as const;
    expect(dtoKiemBienDich(k).cauTraLoiDau).toBeNull();
    expect(dtoKiemBienDich({ ...k, cauTraLoiCuoi: "b" }).cauTraLoiDau).toBe("a");
  });
});

// ★ Đợt 9 (2026-10-23) — phần hợp nhất từ e7220eb9e (bản thứ hai đã xoá): opt-out của lượt + nhịp tiến độ trong lúc sửa.
describe("chayKiemBienDichST — opt-out của lượt + nhịp dang-kiem", () => {
  async function chayVoi(y: Partial<Parameters<typeof chayKiemBienDichST>[0]> & { cauTraLoi: string; goiLai: (t: string, l: string) => Promise<string> }) {
    const g = chayKiemBienDichST({ beMat: "tro-ly", ...y });
    const su: StreamEvent[] = [];
    for (;;) {
      const n = await g.next();
      if (n.done) return { su, kq: n.value };
      su.push(n.value);
    }
  }
  it("★★★ cờ BẬT nhưng tatBoiLuot ⇒ null, KHÔNG sự kiện, KHÔNG gọi model (nhánh 'tắt' của A/B cùng server)", async () => {
    process.env.AI_KIEM_BIEN_DICH_ST = "tro-ly";
    const goiLai = vi.fn(async () => tl(FB_DUNG));
    const { su, kq } = await chayVoi({ cauTraLoi: tl(FB_SAI), goiLai, tatBoiLuot: true });
    expect(kq).toBeNull();
    expect(su).toEqual([]);
    expect(goiLai).not.toHaveBeenCalled();
  });
  it("★★ lượt sửa CHẬM ⇒ phát lại dang-kiem theo nhịp (SSE không im), rồi xong", async () => {
    process.env.AI_KIEM_BIEN_DICH_ST = "tro-ly";
    const goiLai = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 60));
      return tl(FB_DUNG);
    });
    const { su, kq } = await chayVoi({ cauTraLoi: tl(FB_SAI), goiLai, nhipMs: 10 });
    const pha = su.map((e) => (e as { phase?: string }).phase);
    expect(pha.filter((p) => p === "dang-kiem").length).toBeGreaterThanOrEqual(3);
    expect(pha.at(-1)).toBe("xong");
    expect(kq?.trangThai).toBe("da-sua");
  });
});
