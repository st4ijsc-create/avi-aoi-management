/**
 * ★ Đợt 10.4b L0a — bộ dựng `ghepPhan`: bảng mức theo LOẠI (máy chủ quyết, không người gọi), MAX trên toàn danh sách, `nguCanh` client bị
 * BỎ, chỉ `vaiTro`/`noiDung`/`tenTool` đi ra, dấu theo DANH TÍNH mảng (chép ⇒ mất dấu) + census các điểm gọi cổng.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ghepPhan, LOAI_KHO_KY_THUAT, mucCuaGhep, MUC_THEO_LOAI, type LoaiPhan } from "./ghepPhan";

const mot = (loai: Exclude<LoaiPhan, "truy-hoi-kb" | "nguon-kiem-dinh">) => ghepPhan([{ vaiTro: "user", phan: [{ loai, noiDung: "x" }] }]);

describe("bảng mức theo loại (kế hoạch v2.1 §2 D2)", () => {
  it.each([
    ["huong-dan-tinh", "ky-thuat"],
    ["cau-go-van-hanh", "van-hanh"],
    ["cau-go-lap-trinh", "ky-thuat"],
    ["ma-repo", "ky-thuat"],
    ["lich-su-client", "van-hanh"],
    ["ket-qua-tool-van-hanh", "van-hanh"],
    ["ghi-chu-du-an", "van-hanh"],
    ["tin-v1-client", "van-hanh"],
  ] as const)("%s ⇒ %s", (loai, muc) => {
    const r = mot(loai);
    expect(r.muc).toBe(muc);
    expect(r.phanDaGhep).toEqual([muc]);
    expect(mucCuaGhep(r.tinNhan)).toBe(muc);
  });
  it("dau-ra-model / du-lieu-luong không tự thêm mức (kế thừa / động cơ luồng)", () => {
    expect(mot("dau-ra-model").phanDaGhep).toEqual([]);
    expect(mot("du-lieu-luong").phanDaGhep).toEqual([]);
    expect(mot("du-lieu-luong").muc).toBe("ky-thuat");
  });
  it("truy-hoi-kb theo loaiKho: vendor/studio/api ⇒ ky-thuat; khác / VẮNG / null ⇒ van-hanh", () => {
    for (const k of LOAI_KHO_KY_THUAT) expect(ghepPhan([{ vaiTro: "user", phan: [{ loai: "truy-hoi-kb", loaiKho: k.toUpperCase(), noiDung: "x" }] }]).muc).toBe("ky-thuat");
    for (const k of ["nha-may", "", null, undefined, "operational"])
      expect(ghepPhan([{ vaiTro: "user", phan: [{ loai: "truy-hoi-kb", loaiKho: k, noiDung: "x" }] }]).muc).toBe("van-hanh");
  });
  it("nguon-kiem-dinh mang mức do máy chủ suy; `luong` ⇒ không tự thêm; giá trị lạ ⇒ van-hanh (đóng cứng)", () => {
    const g = (muc: unknown) => ghepPhan([{ vaiTro: "user", phan: [{ loai: "nguon-kiem-dinh", muc: muc as never, noiDung: "x" }] }]);
    expect(g("ky-thuat").muc).toBe("ky-thuat");
    expect(g("van-hanh").muc).toBe("van-hanh");
    expect(g("luong").phanDaGhep).toEqual([]);
    expect(g("ky_thuat").muc).toBe("van-hanh");
  });
  it("loại lạ lúc chạy ⇒ van-hanh (đóng cứng)", () => {
    expect(ghepPhan([{ vaiTro: "user", phan: [{ loai: "khong-co" as never, noiDung: "x" }] }]).muc).toBe("van-hanh");
  });
  it("bảng phủ ĐỦ mọi loại (thêm loại mới ⇒ phải quyết mức ở đây)", () => {
    expect(Object.keys(MUC_THEO_LOAI).sort()).toEqual(
      [
        "cau-go-lap-trinh",
        "cau-go-van-hanh",
        "dau-ra-model",
        "du-lieu-luong",
        "ghi-chu-du-an",
        "huong-dan-tinh",
        "ket-qua-tool-van-hanh",
        "lich-su-client",
        "ma-repo",
        "ngu-canh-client",
        "nguon-kiem-dinh",
        "tin-v1-client",
        "truy-hoi-kb",
      ].sort(),
    );
  });
});

describe("ghép", () => {
  it("mức = MAX trên TOÀN danh sách: vòng sau chỉ có phần ky-thuat nhưng lịch sử còn van-hanh ⇒ van-hanh", () => {
    const r = ghepPhan([
      { vaiTro: "system", phan: [{ loai: "huong-dan-tinh", noiDung: "s" }] },
      { vaiTro: "tool", phan: [{ loai: "ket-qua-tool-van-hanh", noiDung: "OEE L3 = 0,82" }], tenTool: "doc_oee" },
      { vaiTro: "assistant", phan: [{ loai: "dau-ra-model", noiDung: "..." }] },
      { vaiTro: "tool", phan: [{ loai: "ma-repo", noiDung: "export const x = 1" }], tenTool: "read_file" },
    ]);
    expect(r.muc).toBe("van-hanh");
  });
  it("ngu-canh-client bị BỎ (không gửi) và đếm; tin chỉ có phần bị bỏ ⇒ bỏ cả tin", () => {
    const r = ghepPhan([
      { vaiTro: "system", phan: [{ loai: "huong-dan-tinh", noiDung: "s" }] },
      { vaiTro: "user", phan: [{ loai: "ngu-canh-client", noiDung: "MÁY-ĐANG-CHỌN: AOI-7" }] },
      { vaiTro: "user", phan: [{ loai: "ngu-canh-client", noiDung: "TRANG: /oee" }, { loai: "cau-go-lap-trinh", noiDung: "viết hàm" }] },
    ]);
    expect(r.soPhanBo).toBe(2);
    expect(r.tinNhan).toHaveLength(2);
    expect(JSON.stringify(r.tinNhan)).not.toMatch(/AOI-7|TRANG/);
    expect(r.tinNhan[1]).toEqual({ vaiTro: "user", noiDung: "viết hàm" });
  });
  it("nối các phần trong MỘT tin (mặc định hai dòng trống; `noi` tuỳ chọn); chỉ vaiTro/noiDung/tenTool đi ra", () => {
    const r = ghepPhan([
      { vaiTro: "user", phan: [{ loai: "cau-go-lap-trinh", noiDung: "a" }, { loai: "ma-repo", noiDung: "b" }] },
      { vaiTro: "tool", phan: [{ loai: "ma-repo", noiDung: "c", them: "LỌT" } as never], tenTool: "read_file", noi: "|", la: "LỌT" } as never,
    ]);
    expect(r.tinNhan[0]).toEqual({ vaiTro: "user", noiDung: "a\n\nb" });
    expect(r.tinNhan[1]).toEqual({ vaiTro: "tool", noiDung: "c", tenTool: "read_file" });
    expect(JSON.stringify(r)).not.toContain("LỌT");
  });
  it("DẤU theo danh tính mảng: mảng chép / tự dựng / null ⇒ không có dấu; kết quả đóng băng (không sửa được sau khi ghép)", () => {
    const r = mot("cau-go-van-hanh");
    expect(mucCuaGhep(r.tinNhan)).toBe("van-hanh");
    expect(mucCuaGhep([...r.tinNhan])).toBeUndefined();
    expect(mucCuaGhep(r.tinNhan.slice())).toBeUndefined();
    expect(mucCuaGhep([{ vaiTro: "user", noiDung: "x" }])).toBeUndefined();
    expect(mucCuaGhep(null)).toBeUndefined();
    expect(Object.isFrozen(r.tinNhan)).toBe(true);
    expect(Object.isFrozen(r.tinNhan[0])).toBe(true);
    expect(() => (r.tinNhan as unknown as unknown[]).push({ vaiTro: "user", noiDung: "chèn" })).toThrow();
  });
});

describe("census — mọi điểm gọi cổng AI ngoài dựng `tinNhan` qua `ghepPhan`", () => {
  /**
   * Thước: mọi tệp sản phẩm (không test) dưới `server/` gọi `goiAiNgoai(` / `goiCongNgoaiHienHanh(` / `kiemDinhNgoai(` — ngoài chính cổng
   * và định nghĩa — PHẢI nằm trong danh sách dưới đây VÀ (nếu tự dựng `tinNhan`) chứa `ghepPhan(`. Thêm điểm gọi mới ⇒ đỏ ⇒ rà + ghi vào
   * danh sách. Rào thật lúc chạy: cổng từ chối mảng không dấu (`NGOAI_KHONG_QUA_BO_GHEP`) — lưới cổng ở `congNgoai.test.ts`.
   */
  const GOC = join(__dirname, "../../../..");
  /** Điểm gọi / điểm dựng yêu cầu ⇒ dấu hiệu BẮT BUỘC phải có (bộ dựng trực tiếp, hoặc hàm dùng chung đã đi qua bộ dựng). */
  const DIEM_GOI: Record<string, RegExp> = {
    "server/routes/openaiGateway.ts": /\bghepPhan\(/,
    "server/services/flow/nut/ai.ts": /\bghepPhan\(/,
    "server/services/flow/nut/agent.ts": /\bghepPhan\(/,
    "server/services/ai/ngoai/kiemDinhNgoai.ts": /\bghepPhan\(/,
    "server/routers/aiKiemDinhRouter.ts": /\blapTinNhanKiemDinh\(/,
    "server/services/flow/nut/kiemDinhNgoai.ts": /\bkiemDinhNgoai\(/,
  };
  const duyet = (d: string, ra: string[]) => {
    for (const ten of readdirSync(d)) {
      const p = join(d, ten);
      if (statSync(p).isDirectory()) {
        if (ten !== "node_modules") duyet(p, ra);
      } else if (/\.ts$/.test(ten) && !/\.test\.ts$/.test(ten)) ra.push(p);
    }
    return ra;
  };
  it("danh sách điểm gọi khớp ĐÚNG mã nguồn; điểm tự dựng đều dùng ghepPhan", () => {
    const thay: string[] = [];
    for (const p of duyet(join(GOC, "server"), [])) {
      const rel = relative(GOC, p).replace(/\\/g, "/");
      if (rel === "server/services/ai/ngoai/congNgoai.ts") continue;
      const s = readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
      const goiCong = /\b(goiAiNgoai|goiCongNgoaiHienHanh|kiemDinhNgoai)\s*\(/.test(s.replace(/function\s+(goiCongNgoaiHienHanh|kiemDinhNgoai|goiAiNgoai)\s*\(/g, ""));
      const dungYeuCau = /\bmucDich\s*:/.test(s) && /\btinNhan\b/.test(s);
      if (goiCong || dungYeuCau) thay.push(rel);
    }
    expect(thay.sort()).toEqual(Object.keys(DIEM_GOI).sort());
    for (const [rel, dau] of Object.entries(DIEM_GOI)) expect(readFileSync(join(GOC, rel), "utf8"), rel).toMatch(dau);
  });
});
