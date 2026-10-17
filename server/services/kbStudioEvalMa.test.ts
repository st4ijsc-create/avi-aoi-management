/**
 * Đợt 5.2 — EVAL MÃ của Training Studio (`kbStudioEvalMa.ts`), phụ thuộc TIÊM (không model thật, không biên dịch thật):
 *   • cổng "tụt" là phép so CÓ BIÊN NHIỄU (±3/36 đo trên H 12×3, quy theo số lượt) — không phải so trần;
 *   • A/B trong CÙNG một lượt: nhánh TẮT không có ngữ cảnh, nhánh BẬT có đoạn corpus ≥ ngưỡng 0,44 (đoạn dưới ngưỡng bị
 *     loại — như trợ lý VSCode LOCAL); truy hồi một lần mỗi bài;
 *   • chạy NỀN (mức ưu tiên `nen`), có % và HUỶ (signal tới tận lượt sinh + lượt chấm);
 *   • lỗi hạ tầng (llama-server chết) ⇒ `khong-do-duoc`, không phát một con số; lượt cụt ⇒ TRƯỢT có đếm;
 *   • cờ tắt ⇒ từ chối; một lượt tại một thời điểm.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mucUuTienHienTai } from "./ai/hangDoiUuTienLlm";
import {
  KbEvalMaDangChayError,
  KbEvalMaTatError,
  batDauEvalMa,
  choXongEvalMa,
  docBoBai,
  huyEvalMa,
  listBoBai,
  nguongNhieu,
  tongHopEvalMa,
  type HangEvalMa,
  type KetQuaLuotMa,
  type PhuThuocEvalMa,
} from "./kbStudioEvalMa";

afterEach(() => {
  delete process.env.KB_STUDIO_EVAL_MA_ENABLED;
});

function kq(nhanh: "tat" | "bat", dat: boolean, o: Partial<KetQuaLuotMa> = {}): KetQuaLuotMa {
  return { baiId: o.baiId ?? "b", lang: o.lang ?? "ts", lap: 1, nhanh, coNguCanh: nhanh === "bat" ? (o.coNguCanh ?? 1) : 0, dat, sinhDuocMa: true, cut: false, loiHaTang: false, loi: null, msSinh: 1, msCham: 1, ...o };
}
const lap = (n: number, f: (i: number) => KetQuaLuotMa) => Array.from({ length: n }, (_, i) => f(i));

describe("nguongNhieu — biên nhiễu ±3/36 quy theo số lượt mỗi nhánh", () => {
  it("36 ⇒ 3 · 24 ⇒ 2 · 12 ⇒ 1 · 0 ⇒ 1 (sàn)", () => {
    expect([nguongNhieu(36), nguongNhieu(24), nguongNhieu(12), nguongNhieu(0)]).toEqual([3, 2, 1, 1]);
  });
});

describe("tongHopEvalMa — cổng tụt", () => {
  it("BẬT thấp hơn TẮT QUÁ biên ⇒ tut", () => {
    const r = [...lap(12, (i) => kq("tat", i < 10)), ...lap(12, (i) => kq("bat", i < 8))];
    expect(tongHopEvalMa(r)).toMatchObject({ n: 12, tat: { dat: 10 }, bat: { dat: 8 }, chenh: -2, nguongNhieu: 1, ketLuan: "tut", tut: true });
  });

  it("chênh TRONG biên (−1 trên 12) ⇒ trong-nhieu, KHÔNG tut", () => {
    const r = [...lap(12, (i) => kq("tat", i < 10)), ...lap(12, (i) => kq("bat", i < 9))];
    expect(tongHopEvalMa(r)).toMatchObject({ chenh: -1, ketLuan: "trong-nhieu", tut: false });
  });

  it("BẬT cao hơn quá biên ⇒ nang", () => {
    const r = [...lap(12, (i) => kq("tat", i < 8)), ...lap(12, (i) => kq("bat", i < 11))];
    expect(tongHopEvalMa(r)).toMatchObject({ chenh: 3, ketLuan: "nang", tut: false });
  });

  it("KHÔNG bài nào nhận được ngữ cảnh ⇒ khong-ap-dung (A/B không nói gì về corpus) dù số chênh", () => {
    const r = [...lap(12, (i) => kq("tat", i < 10)), ...lap(12, (i) => kq("bat", i < 6, { coNguCanh: 0 }))];
    expect(tongHopEvalMa(r)).toMatchObject({ soLuotCoNguCanh: 0, ketLuan: "khong-ap-dung", tut: false });
  });

  it("đếm cụt + theo ngôn ngữ", () => {
    const r = [kq("tat", true, { lang: "cs" }), kq("bat", false, { lang: "cs", cut: true, sinhDuocMa: false })];
    const t = tongHopEvalMa(r);
    expect(t.bat.cut).toBe(1);
    expect(t.theoNgonNgu.cs).toEqual({ n: 1, tat: 1, bat: 0 });
  });
});

describe("bộ bài — đọc TỆP THẬT của bộ đo", () => {
  it("listBoBai thấy tasks (11) + tasks-hard (12) kèm băm", () => {
    const ds = listBoBai();
    expect(ds.find((b) => b.ten === "tasks-hard")).toMatchObject({ soBai: 12, ngonNgu: { ts: 3, py: 3, cs: 3, cpp: 3 } });
    expect(ds.find((b) => b.ten === "tasks")?.soBai).toBe(11);
    expect(ds.every((b) => /^[0-9a-f]{16}$/.test(b.hash))).toBe(true);
    expect(ds.some((b) => b.ten.startsWith("fake"))).toBe(false);
  });

  it("tên lạ / đường dẫn ⇒ null", () => {
    expect(docBoBai("../../package")).toBeNull();
    expect(docBoBai("fake-hard")).toBeNull();
    expect(docBoBai("tasks-khong-co")).toBeNull();
  });
});

// ─── job ──────────────────────────────────────────────────────────────────────────────────────

const BAI = [
  { id: "T1", lang: "ts", prompt: "Viết hàm cong(a,b)", test: "import { cong } from './sol.mjs'" },
  { id: "P1", lang: "py", prompt: "Viết hàm tru(a,b)", test: "from sol import tru" },
];

function soGia() {
  const hang = new Map<string, HangEvalMa & { capNhatLan: number }>();
  return {
    hang,
    so: {
      tao: vi.fn(async (h: { id: string; corpus: string; boBai: string; boBaiHash: string; soBai: number; soLap: number; tienTrinh: string; createdBy: number | null }) => {
        hang.set(h.id, { ...h, trangThai: "dang-chay", tienDo: 0, tongHop: null, ketQua: [], lyDo: null, batDau: new Date().toISOString(), ketThuc: null, capNhatLan: 0 });
      }),
      tienDo: vi.fn(async (id: string, tienDo: number, ketQua: KetQuaLuotMa[]) => {
        const h = hang.get(id)!;
        Object.assign(h, { tienDo, ketQua, capNhatLan: h.capNhatLan + 1 });
      }),
      ket: vi.fn(async (id: string, k: { trangThai: string; tongHop: unknown; ketQua: KetQuaLuotMa[]; lyDo: string | null; tienDo: number }) => {
        Object.assign(hang.get(id)!, k, { ketThuc: new Date().toISOString() });
      }),
      danhSach: vi.fn(async () => [...hang.values()]),
    },
  };
}

function phuThuoc(over: Partial<PhuThuocEvalMa> = {}) {
  const { hang, so } = soGia();
  const prompts: Array<{ system: string; prompt: string; muc: string }> = [];
  const pt: PhuThuocEvalMa = {
    docBoBai: (ten) => (ten === "tasks-gia" ? { bai: BAI, hash: "0123456789abcdef" } : null),
    truyHoi: vi.fn(async (_corpus: string, cauHoi: string) =>
      cauHoi.includes("cong")
        ? [
            { sourceRef: "api.md", text: "cong(a,b) trả a+b", score: 0.71 },
            { sourceRef: "nhieu.md", text: "ĐOẠN NHIỄU", score: 0.43 },
          ]
        : [],
    ),
    sinh: vi.fn(async (v: { system: string; prompt: string; signal: AbortSignal }) => {
      prompts.push({ system: v.system, prompt: v.prompt, muc: mucUuTienHienTai() });
      return { text: "```ts\nexport const x = 1;\n```", cut: false };
    }),
    cham: vi.fn(async (v: { bai: { id: string }; text: string; dir: string; signal: AbortSignal }) => ({
      sinhDuocMa: true,
      dat: !v.dir.endsWith("-bat"),
      loi: null,
    })),
    so,
    thuMucLam: "D:/tmp-khong-dung",
    systemPrompt: "SYS",
    ...over,
  };
  return { pt, hang, prompts };
}

describe("job eval mã — nền, A/B, %, huỷ", () => {
  it("cờ TẮT ⇒ KbEvalMaTatError, không tạo hàng", async () => {
    const { pt, hang } = phuThuoc();
    await expect(batDauEvalMa({ corpus: "c", boBai: "tasks-gia", soLap: 1, userId: 1 }, pt)).rejects.toBeInstanceOf(KbEvalMaTatError);
    expect(hang.size).toBe(0);
  });

  it("chạy trọn: 2 bài × 1 lần × 2 nhánh = 4 lượt; nhánh BẬT có ngữ cảnh ≥0,44 (đoạn 0,43 bị loại); mức `nen`; 100 %", async () => {
    process.env.KB_STUDIO_EVAL_MA_ENABLED = "true";
    const { pt, hang, prompts } = phuThuoc();
    const { id } = await batDauEvalMa({ corpus: "c", boBai: "tasks-gia", soLap: 1, userId: 1 }, pt);
    await choXongEvalMa(id);
    const h = hang.get(id)!;
    expect(h).toMatchObject({ trangThai: "xong", tienDo: 100 });
    expect(h.ketQua).toHaveLength(4);
    expect(pt.truyHoi).toHaveBeenCalledTimes(2); // một lần mỗi bài, không mỗi nhánh
    expect(prompts.every((p) => p.muc === "nen" && p.system === "SYS")).toBe(true);
    const batCong = prompts.find((p) => p.prompt.includes("cong(a,b) trả a+b"));
    expect(batCong).toBeDefined();
    expect(prompts.some((p) => p.prompt.includes("ĐOẠN NHIỄU"))).toBe(false);
    expect(prompts.filter((p) => p.prompt.includes("api.md"))).toHaveLength(1); // chỉ nhánh BẬT của T1
    // cham giả: nhánh tat đạt, bat trượt ⇒ 2/2 vs 0/2, biên 1 ⇒ tut — NHƯNG chỉ 1 lượt có ngữ cảnh
    expect(h.tongHop).toMatchObject({ n: 2, tat: { dat: 2 }, bat: { dat: 0 }, soLuotCoNguCanh: 1, ketLuan: "tut", tut: true });
  });

  it("một lượt tại một thời điểm ⇒ lượt thứ hai bị từ chối khi lượt đầu còn chạy", async () => {
    process.env.KB_STUDIO_EVAL_MA_ENABLED = "true";
    let nha!: () => void;
    const cho = new Promise<void>((r) => (nha = r));
    const { pt } = phuThuoc({
      sinh: vi.fn(async () => {
        await cho;
        return { text: "x", cut: false };
      }),
    });
    const { id } = await batDauEvalMa({ corpus: "c", boBai: "tasks-gia", soLap: 1, userId: 1 }, pt);
    await expect(batDauEvalMa({ corpus: "c", boBai: "tasks-gia", soLap: 1, userId: 1 }, pt)).rejects.toBeInstanceOf(KbEvalMaDangChayError);
    nha();
    await choXongEvalMa(id);
  });

  it("HUỶ giữa chừng ⇒ signal tới lượt sinh; trạng thái 'huy', KHÔNG tổng hợp; lượt mới được chạy ngay sau", async () => {
    process.env.KB_STUDIO_EVAL_MA_ENABLED = "true";
    let signalThay: AbortSignal | null = null;
    const { pt, hang } = phuThuoc({
      sinh: vi.fn(
        (v: { signal: AbortSignal }) =>
          new Promise<{ text: string; cut: boolean }>((_, rej) => {
            signalThay = v.signal;
            v.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
          }),
      ),
    });
    const { id } = await batDauEvalMa({ corpus: "c", boBai: "tasks-gia", soLap: 1, userId: 1 }, pt);
    await vi.waitFor(() => expect(signalThay).not.toBeNull());
    expect(huyEvalMa(id)).toBe(true);
    await choXongEvalMa(id);
    expect(signalThay!.aborted).toBe(true);
    expect(hang.get(id)).toMatchObject({ trangThai: "huy", tongHop: null });
    expect(huyEvalMa(id)).toBe(false);
    const { pt: pt2 } = phuThuoc();
    const k2 = await batDauEvalMa({ corpus: "c", boBai: "tasks-gia", soLap: 1, userId: 1 }, pt2);
    await choXongEvalMa(k2.id);
  });

  it("llama-server chết (sinh NÉM lỗi hạ tầng) ⇒ khong-do-duoc + lý do; tongHop vẫn lưu để xem, ketLuan khong-do-duoc", async () => {
    process.env.KB_STUDIO_EVAL_MA_ENABLED = "true";
    const { pt, hang } = phuThuoc({ sinh: vi.fn(async () => { throw new Error("ECONNREFUSED 127.0.0.1:8091"); }) });
    const { id } = await batDauEvalMa({ corpus: "c", boBai: "tasks-gia", soLap: 1, userId: 1 }, pt);
    await choXongEvalMa(id);
    const h = hang.get(id)!;
    expect(h.trangThai).toBe("khong-do-duoc");
    expect(h.lyDo).toMatch(/4\/4 lượt sinh lỗi hạ tầng/);
    expect(h.tongHop).toMatchObject({ ketLuan: "khong-do-duoc", tut: false });
    expect(pt.cham).not.toHaveBeenCalled();
  });

  it("lượt CỤT (model nghĩ hết trần) ⇒ TRƯỢT có đếm, không phải lỗi hạ tầng", async () => {
    process.env.KB_STUDIO_EVAL_MA_ENABLED = "true";
    const { pt, hang } = phuThuoc({ sinh: vi.fn(async () => ({ text: "", cut: true })) });
    const { id } = await batDauEvalMa({ corpus: "c", boBai: "tasks-gia", soLap: 1, userId: 1 }, pt);
    await choXongEvalMa(id);
    expect(hang.get(id)).toMatchObject({ trangThai: "xong", tongHop: { tat: { dat: 0, cut: 2 }, bat: { dat: 0, cut: 2 } } });
  });

  it("bộ bài không có ⇒ từ chối trước khi tạo hàng", async () => {
    process.env.KB_STUDIO_EVAL_MA_ENABLED = "true";
    const { pt, hang } = phuThuoc();
    await expect(batDauEvalMa({ corpus: "c", boBai: "khong-co", soLap: 1, userId: 1 }, pt)).rejects.toThrow(/bộ bài/);
    expect(hang.size).toBe(0);
  });
});
