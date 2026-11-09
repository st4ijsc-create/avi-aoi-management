import { describe, expect, it, vi } from "vitest";
import {
  TRAN_MOT_LUOT_MS,
  TRAN_TONG_MS,
  cauNhacSuaMa,
  chanDoanChoModel,
  ghiChuDaSua,
  headerTuKiemMa,
  kiemVaSuaMa,
  soVongTuKiem,
  trichKhoiMaKiem,
  tuKiemMaBat,
  type ChanDoanMa,
  type KetQuaBienDichMa,
  type KetQuaTuKiemMa,
} from "./tuKiemMa";

const CS = "```csharp\nclass A {}\n```";
const loi = (n = 1): ChanDoanMa[] => Array.from({ length: n }, (_, i) => ({ dong: i + 1, cot: 2, ma: "CS0122", thongDiep: "inaccessible" }));
const ok: KetQuaBienDichMa = { trangThai: "ok", chanDoan: [] };
const do_ = (n = 1): KetQuaBienDichMa => ({ trangThai: "loi", chanDoan: loi(n) });

describe("cờ", () => {
  it("chỉ đúng '1' mới bật", () => {
    expect(tuKiemMaBat({})).toBe(false);
    expect(tuKiemMaBat({ AI_CHAT_TU_KIEM_MA: "" })).toBe(false);
    expect(tuKiemMaBat({ AI_CHAT_TU_KIEM_MA: "true" })).toBe(false);
    expect(tuKiemMaBat({ AI_CHAT_TU_KIEM_MA: "0" })).toBe(false);
    expect(tuKiemMaBat({ AI_CHAT_TU_KIEM_MA: " 1 " })).toBe(true);
  });
  it("số vòng: mặc định 2, kẹp 1..3, rác ⇒ 2", () => {
    expect(soVongTuKiem({})).toBe(2);
    expect(soVongTuKiem({ AI_CHAT_TU_KIEM_VONG: "1" })).toBe(1);
    expect(soVongTuKiem({ AI_CHAT_TU_KIEM_VONG: "3" })).toBe(3);
    expect(soVongTuKiem({ AI_CHAT_TU_KIEM_VONG: "9" })).toBe(3);
    expect(soVongTuKiem({ AI_CHAT_TU_KIEM_VONG: "0" })).toBe(2);
    expect(soVongTuKiem({ AI_CHAT_TU_KIEM_VONG: "-1" })).toBe(2);
    expect(soVongTuKiem({ AI_CHAT_TU_KIEM_VONG: "1.5" })).toBe(2);
    expect(soVongTuKiem({ AI_CHAT_TU_KIEM_VONG: "abc" })).toBe(2);
  });
  it("hằng trần theo thiết kế được duyệt", () => {
    expect(TRAN_TONG_MS).toBe(90_000);
    expect(TRAN_MOT_LUOT_MS).toBe(10_000);
  });
});

describe("trichKhoiMaKiem", () => {
  it("nhận nhãn cs/csharp/c#, ts/typescript, py/python và trả đúng ngôn ngữ + mã", () => {
    expect(trichKhoiMaKiem("```cs\nx\n```")).toEqual({ ngonNgu: "cs", ma: "x\n" });
    expect(trichKhoiMaKiem("```C#\nx\n```")?.ngonNgu).toBe("cs");
    expect(trichKhoiMaKiem("```TypeScript\nx\n```")?.ngonNgu).toBe("ts");
    expect(trichKhoiMaKiem("```ts\nx\n```")?.ngonNgu).toBe("ts");
    expect(trichKhoiMaKiem("```python\nx\n```")?.ngonNgu).toBe("py");
    expect(trichKhoiMaKiem("```py\nx\n```")?.ngonNgu).toBe("py");
    expect(trichKhoiMaKiem("```python3\nx\n```")?.ngonNgu).toBe("py");
  });
  it("hai khối mã ⇒ null (không đoán đơn vị biên dịch)", () => {
    expect(trichKhoiMaKiem("```cs\na\n```\ntext\n```cs\nb\n```")).toBeNull();
    expect(trichKhoiMaKiem("```cs\na\n```\n```python\nb\n```")).toBeNull();
  });
  it("khối ngôn ngữ khác (st, java) ⇒ null; khối phụ (text/bash/không nhãn) đứng cạnh thì vẫn nhận", () => {
    expect(trichKhoiMaKiem("```cs\na\n```\n```java\nb\n```")).toBeNull();
    expect(trichKhoiMaKiem("```st\nPROGRAM p\n```")).toBeNull();
    expect(trichKhoiMaKiem("```cs\na\n```\nVí dụ:\n```text\n3\n```")?.ngonNgu).toBe("cs");
    expect(trichKhoiMaKiem("```cs\na\n```\n```bash\ndotnet run\n```")?.ngonNgu).toBe("cs");
    expect(trichKhoiMaKiem("```cs\na\n```\n```\nraw\n```")?.ngonNgu).toBe("cs");
  });
  it("không có khối / khối rỗng / chỉ khối phụ ⇒ null", () => {
    expect(trichKhoiMaKiem("chỉ chữ")).toBeNull();
    expect(trichKhoiMaKiem("```cs\n   \n```")).toBeNull();
    expect(trichKhoiMaKiem("```text\nx\n```")).toBeNull();
    expect(trichKhoiMaKiem(undefined as unknown as string)).toBeNull();
  });
});

describe("kiemVaSuaMa", () => {
  const goiLaiGia = (...tra: string[]) => {
    const f = vi.fn(async (_t: string, _l: string) => tra.shift() ?? "");
    return f;
  };

  it("không có khối mã duy nhất ⇒ bo-qua, không gọi biên dịch", async () => {
    const bienDich = vi.fn(async () => ok);
    const r = await kiemVaSuaMa({ cauTraLoi: "xin chào", goiLai: goiLaiGia(), bienDich });
    expect(r.trangThai).toBe("bo-qua");
    expect(r.lyDo).toBe("khong-co-khoi-ma-duy-nhat");
    expect(bienDich).not.toHaveBeenCalled();
  });

  it("bản đầu sạch ⇒ sach, 0 vòng, không gọi model", async () => {
    const goiLai = goiLaiGia();
    const r = await kiemVaSuaMa({ cauTraLoi: CS, goiLai, bienDich: async () => ok });
    expect(r).toMatchObject({ trangThai: "sach", ngonNgu: "cs", soVong: 0, kyTuSinhThem: 0, cauTraLoiCuoi: CS });
    expect(goiLai).not.toHaveBeenCalled();
  });

  it("hạ tầng không kiểm được ⇒ khong-kiem-duoc + lý do, giữ nguyên câu", async () => {
    const goiLai = goiLaiGia();
    const r = await kiemVaSuaMa({ cauTraLoi: CS, goiLai, bienDich: async () => ({ trangThai: "khong-kiem-duoc", chanDoan: [], lyDo: "het-gio" }) });
    expect(r).toMatchObject({ trangThai: "khong-kiem-duoc", lyDo: "het-gio", soVong: 0, cauTraLoiCuoi: CS });
    expect(goiLai).not.toHaveBeenCalled();
  });

  it("biên dịch ném ⇒ khong-kiem-duoc (không ném ra ngoài); AbortError thì ném", async () => {
    const r = await kiemVaSuaMa({ cauTraLoi: CS, goiLai: goiLaiGia(), bienDich: async () => { throw new Error("boom"); } });
    expect(r.trangThai).toBe("khong-kiem-duoc");
    expect(r.lyDo).toContain("boom");
    const huy = Object.assign(new Error("a"), { name: "AbortError" });
    await expect(kiemVaSuaMa({ cauTraLoi: CS, goiLai: goiLaiGia(), bienDich: async () => { throw huy; } })).rejects.toBe(huy);
  });

  it("đỏ rồi sửa xong ở vòng 1 ⇒ da-sua, câu cuối = bản sửa, soLoiDaSua = số lỗi bản đầu", async () => {
    const sua = "```csharp\nclass B {}\n```";
    const bienDich = vi.fn().mockResolvedValueOnce(do_(3)).mockResolvedValueOnce(ok);
    const goiLai = goiLaiGia(sua);
    const r = await kiemVaSuaMa({ cauTraLoi: CS, goiLai, bienDich });
    expect(r).toMatchObject({ trangThai: "da-sua", soVong: 1, soLoiDaSua: 3, cauTraLoiCuoi: sua, cauTraLoiDau: CS, kyTuSinhThem: sua.length });
    expect(goiLai).toHaveBeenCalledTimes(1);
    const [tin, lanTruoc] = goiLai.mock.calls[0]!;
    expect(lanTruoc).toBe(CS);
    expect(tin).toContain("CS0122");
    expect(tin).toContain("line 1:2");
  });

  it("sửa ở vòng 2 ⇒ soVong = 2, lời nhắc vòng 2 mang lỗi của bản sửa vòng 1 và câu trước là bản vòng 1", async () => {
    const v1 = "```csharp\nclass V1 {}\n```";
    const v2 = "```csharp\nclass V2 {}\n```";
    const bienDich = vi.fn().mockResolvedValueOnce(do_(2)).mockResolvedValueOnce({ trangThai: "loi", chanDoan: [{ dong: 7, cot: 1, ma: "CS1002", thongDiep: "; expected" }] }).mockResolvedValueOnce(ok);
    const goiLai = goiLaiGia(v1, v2);
    const r = await kiemVaSuaMa({ cauTraLoi: CS, goiLai, bienDich, vongToiDa: 2 });
    expect(r).toMatchObject({ trangThai: "da-sua", soVong: 2, cauTraLoiCuoi: v2 });
    expect(goiLai.mock.calls[1]![0]).toContain("CS1002");
    expect(goiLai.mock.calls[1]![0]).not.toContain("CS0122");
    expect(goiLai.mock.calls[1]![1]).toBe(v1);
  });

  it("hết vòng vẫn đỏ ⇒ con-loi; KHÔNG thay câu trả lời; chẩn đoán là của bản ít lỗi nhất", async () => {
    const v1 = "```csharp\nclass V1 {}\n```";
    const v2 = "```csharp\nclass V2 {}\n```";
    const bienDich = vi.fn().mockResolvedValueOnce(do_(4)).mockResolvedValueOnce(do_(1)).mockResolvedValueOnce(do_(2));
    const r = await kiemVaSuaMa({ cauTraLoi: CS, goiLai: goiLaiGia(v1, v2), bienDich, vongToiDa: 2 });
    expect(r.trangThai).toBe("con-loi");
    expect(r.soVong).toBe(2);
    expect(r.chanDoanCuoi).toHaveLength(1);
    expect(r.cauTraLoiCuoi).toBe(CS);
    expect(bienDich).toHaveBeenCalledTimes(3);
  });

  it("vongToiDa chặn số lần gọi model", async () => {
    const goiLai = goiLaiGia("```csharp\nclass B {}\n```", "```csharp\nclass C {}\n```", "```csharp\nclass D {}\n```");
    const r = await kiemVaSuaMa({ cauTraLoi: CS, goiLai, bienDich: async () => do_(1), vongToiDa: 1 });
    expect(goiLai).toHaveBeenCalledTimes(1);
    expect(r.soVong).toBe(1);
    const goiLai0 = goiLaiGia("x");
    const r0 = await kiemVaSuaMa({ cauTraLoi: CS, goiLai: goiLai0, bienDich: async () => do_(1), vongToiDa: 0 });
    expect(goiLai0).not.toHaveBeenCalled();
    expect(r0).toMatchObject({ trangThai: "con-loi", soVong: 0 });
  });

  it("bản sửa không còn đúng một khối cùng ngôn ngữ ⇒ dừng, con-loi, không biên dịch bản đó", async () => {
    for (const hong of ["xin lỗi tôi không sửa được", "```python\nx = 1\n```", "```csharp\na\n```\n```csharp\nb\n```", ""]) {
      const bienDich = vi.fn(async () => do_(1));
      const goiLai = goiLaiGia(hong, "```csharp\nclass B {}\n```");
      const r = await kiemVaSuaMa({ cauTraLoi: CS, goiLai, bienDich, vongToiDa: 2 });
      expect(r.trangThai).toBe("con-loi");
      expect(goiLai).toHaveBeenCalledTimes(1);
      expect(bienDich).toHaveBeenCalledTimes(1);
      expect(r.kyTuSinhThem).toBe(hong.length);
    }
  });

  it("model lỗi giữa vòng ⇒ con-loi với bản đầu; AbortError thì ném", async () => {
    const r = await kiemVaSuaMa({ cauTraLoi: CS, goiLai: async () => { throw new Error("502"); }, bienDich: async () => do_(2) });
    expect(r).toMatchObject({ trangThai: "con-loi", soVong: 1, cauTraLoiCuoi: CS });
    const huy = Object.assign(new Error("a"), { name: "AbortError" });
    await expect(kiemVaSuaMa({ cauTraLoi: CS, goiLai: async () => { throw huy; }, bienDich: async () => do_(1) })).rejects.toBe(huy);
  });

  it("bản sửa biên dịch mà hạ tầng lỗi ⇒ dừng con-loi (không báo da-sua)", async () => {
    const bienDich = vi.fn().mockResolvedValueOnce(do_(2)).mockResolvedValueOnce({ trangThai: "khong-kiem-duoc", chanDoan: [], lyDo: "het-gio" });
    const goiLai = goiLaiGia("```csharp\nclass B {}\n```", "```csharp\nclass C {}\n```");
    const r = await kiemVaSuaMa({ cauTraLoi: CS, goiLai, bienDich, vongToiDa: 2 });
    expect(r.trangThai).toBe("con-loi");
    expect(goiLai).toHaveBeenCalledTimes(1); // không kiểm được bản sửa ⇒ dừng, không đốt thêm vòng
    expect(r.chanDoanCuoi).toHaveLength(2); // vẫn là chẩn đoán của bản đầu
  });

  it("hòa số lỗi giữa hai bản sửa ⇒ giữ chẩn đoán của bản ĐẾN TRƯỚC (so sánh nghiêm ngặt)", async () => {
    const mot = (ma: string): KetQuaBienDichMa => ({ trangThai: "loi", chanDoan: [{ dong: 1, cot: 1, ma, thongDiep: ma }] });
    const bienDich = vi.fn().mockResolvedValueOnce(do_(2)).mockResolvedValueOnce(mot("X")).mockResolvedValueOnce(mot("Y"));
    const r = await kiemVaSuaMa({ cauTraLoi: CS, goiLai: goiLaiGia("```csharp\nclass B {}\n```", "```csharp\nclass C {}\n```"), bienDich, vongToiDa: 2 });
    expect(r.chanDoanCuoi.map((d) => d.ma)).toEqual(["X"]);
  });

  it("lượt model chạy quá trần tổng ⇒ lượt biên dịch kế được cấp đúng 1 ms (không âm, không 0)", async () => {
    let t = 0;
    const gom: number[] = [];
    await kiemVaSuaMa({
      cauTraLoi: CS, bayGio: () => t, tranMs: 5000, vongToiDa: 1,
      goiLai: async () => { t += 9000; return "```csharp\nclass B {}\n```"; },
      bienDich: async (_k, tranMs) => { gom.push(tranMs); return do_(1); },
    });
    expect(gom).toEqual([5000, 1]);
  });

  it("trần tổng: hết giờ trước vòng ⇒ không gọi model; đồng hồ tiêm", async () => {
    let t = 1000;
    const bayGio = () => t;
    const goiLai = goiLaiGia("```csharp\nclass B {}\n```");
    const r = await kiemVaSuaMa({
      cauTraLoi: CS, goiLai, bayGio, tranMs: 5000, vongToiDa: 2,
      bienDich: async () => { t += 5000; return do_(1); },
    });
    expect(goiLai).not.toHaveBeenCalled();
    expect(r).toMatchObject({ trangThai: "con-loi", soVong: 0, msThem: 5000 });
  });

  it("thời gian mỗi lượt biên dịch = min(trần một lượt, phần còn lại), tối thiểu 1 ms", async () => {
    let t = 0;
    const gom: number[] = [];
    await kiemVaSuaMa({
      cauTraLoi: CS, goiLai: goiLaiGia("```csharp\nclass B {}\n```"), bayGio: () => t, tranMs: 12_000, tranMotLuotMs: 10_000, vongToiDa: 1,
      bienDich: async (_k, tranMs) => { gom.push(tranMs); t += 8000; return do_(1); },
    });
    expect(gom).toEqual([10_000, 4_000]);
  });

  it("signal đã huỷ ⇒ không vào vòng sửa", async () => {
    const ac = new AbortController();
    ac.abort();
    const goiLai = goiLaiGia("x");
    const r = await kiemVaSuaMa({ cauTraLoi: CS, goiLai, bienDich: async () => do_(1), signal: ac.signal });
    expect(goiLai).not.toHaveBeenCalled();
    expect(r.trangThai).toBe("con-loi");
  });
});

describe("chữ gửi model / header", () => {
  it("cauNhacSuaMa nêu tên trình biên dịch, lỗi, nhãn khối đúng ngôn ngữ và đòi MỘT khối", () => {
    const l = loi(1);
    const cs = cauNhacSuaMa("cs", l);
    expect(cs).toContain("C# compiler");
    expect(cs).toContain("```csharp");
    expect(cs).toContain("CS0122");
    expect(cs).toContain("ONE");
    expect(cauNhacSuaMa("ts", l)).toContain("```typescript");
    expect(cauNhacSuaMa("py", l)).toContain("```python");
    expect(cauNhacSuaMa("py", l)).toContain("Python parser");
  });
  it("chanDoanChoModel cắt 20 dòng và in '?' khi thiếu vị trí", () => {
    expect(chanDoanChoModel(loi(30)).split("\n")).toHaveLength(20);
    expect(chanDoanChoModel([{ dong: null, cot: null, ma: null, thongDiep: "x" }])).toBe("line ? error: x");
    expect(chanDoanChoModel([{ dong: 3, cot: null, ma: "TS1", thongDiep: "y" }])).toBe("line 3 error TS1: y");
  });
  const mau = (p: Partial<KetQuaTuKiemMa>): KetQuaTuKiemMa => ({
    trangThai: "sach", lyDo: null, ngonNgu: "cs", soVong: 0, soLoiDaSua: 0, chanDoanCuoi: [], cauTraLoiDau: "", cauTraLoiCuoi: "", kyTuSinhThem: 0, msThem: 12, ...p,
  });
  it("headerTuKiemMa", () => {
    expect(headerTuKiemMa(mau({ trangThai: "bo-qua" }))).toBe("ok=skip");
    expect(headerTuKiemMa(mau({}))).toBe("ok=1; trang-thai=sach; ngon-ngu=cs; vong=0; sua=0; con=0; ky-tu-them=0; ms=12");
    expect(headerTuKiemMa(mau({ trangThai: "da-sua", soVong: 2, soLoiDaSua: 3, kyTuSinhThem: 700 }))).toBe("ok=1; trang-thai=da-sua; ngon-ngu=cs; vong=2; sua=3; con=0; ky-tu-them=700; ms=12");
    expect(headerTuKiemMa(mau({ trangThai: "con-loi", chanDoanCuoi: loi(2) }))).toContain("ok=0");
    expect(headerTuKiemMa(mau({ trangThai: "con-loi", chanDoanCuoi: loi(2) }))).toContain("con=2");
    expect(headerTuKiemMa(mau({ trangThai: "khong-kiem-duoc" }))).toContain("ok=na");
  });
  it("ghiChuDaSua nêu số lỗi và số vòng", () => {
    const g = ghiChuDaSua(mau({ trangThai: "da-sua", soVong: 2, soLoiDaSua: 3 }));
    expect(g).toContain("3 lỗi");
    expect(g).toContain("2 vòng");
  });
});
