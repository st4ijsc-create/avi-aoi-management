/**
 * ★★ Đợt 3b — hàm thuần: nhật ký Terminal theo phiên (trình duyệt) · dán ảnh lỗi · nhãn trạng thái git.
 */
import { describe, expect, it } from "vitest";
import {
  docNhatKyLenh, dongGoiNhatKy, khoaNhatKyLenh, luuNhatKyLenh, moGoiNhatKy, xoaNhatKyLenh, TRAN_KY_TU_DAU_RA, TRAN_LUOT_LUU,
} from "./nhatKyLenhPhien";
import { chenVaoO, khoiChuOcr, kiemAnhLoi, layAnhTuDuLieu, TRAN_BYTE_ANH_CLIENT } from "./anhLoiChat";
import { cauLoiGit, nhanTrangThai, tenNhanhHopLeClient, thongDiepDung } from "@/components/ai/bangGitLogic";
import type { LuotLenh } from "@/components/ai/BangTerminal";

const L = (lenh: string, dauRa = "ok"): LuotLenh => ({
  lenh, dauRa, exitCode: 0, timedOut: false, durationMs: 10, ketQua: { xanh: true, soDo: 0, soXanh: 3 }, luc: "10:00", nguon: "duyet",
  diaDiemLoi: [{ tep: "GIA.ts", dong: 1 } as never],
});

function khoNho() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe("nhatKyLenhPhien", () => {
  it("★★★ khoá theo người × dự án × phiên; thiếu một ⇒ null (không lưu chung)", () => {
    expect(khoaNhatKyLenh(5, "demo", "s1")).toBe("repoWs.nhatKyLenh.v1.5.demo.s1");
    expect(khoaNhatKyLenh(null, "demo", "s1")).toBeNull();
    expect(khoaNhatKyLenh(5, "", "s1")).toBeNull();
    expect(khoaNhatKyLenh(5, "demo", "")).toBeNull();
  });

  it("★★★ khứ hồi: lưu ⇒ đọc ra cùng lượt; địa điểm lỗi KHÔNG lưu mà tính LẠI bằng bộ đọc của trang", () => {
    const k = khoNho();
    luuNhatKyLenh(k, "x", [L("npm test", "FAIL a.ts:3")]);
    expect(k.m.get("x")).not.toContain("GIA.ts");
    const ra = docNhatKyLenh(k, "x", (d) => [{ tep: d, dong: 9 } as never]);
    expect(ra).toHaveLength(1);
    expect(ra[0]).toMatchObject({ lenh: "npm test", dauRa: "FAIL a.ts:3", nguon: "duyet", ketQua: { xanh: true, soXanh: 3 } });
    expect(ra[0]!.diaDiemLoi).toEqual([{ tep: "FAIL a.ts:3", dong: 9 }]);
    xoaNhatKyLenh(k, "x");
    expect(k.m.has("x")).toBe(false);
  });

  it("★★ trần: 20 lượt mới nhất; đầu ra cắt ĐẦU giữ đuôi", () => {
    const nhieu = Array.from({ length: TRAN_LUOT_LUU + 5 }, (_, i) => L(`l${i}`, i === TRAN_LUOT_LUU + 4 ? "x".repeat(TRAN_KY_TU_DAU_RA) + "DUOI" : "o"));
    const ra = moGoiNhatKy(dongGoiNhatKy(nhieu), () => []);
    expect(ra).toHaveLength(TRAN_LUOT_LUU);
    expect(ra[0]!.lenh).toBe("l5");
    expect(ra.at(-1)!.dauRa.endsWith("DUOI")).toBe(true);
    expect(ra.at(-1)!.dauRa.length).toBe(TRAN_KY_TU_DAU_RA);
  });

  it("★★★ dữ liệu méo / bị sửa tay ⇒ mục bị BỎ, JSON hỏng ⇒ rỗng; kho ném ⇒ rỗng, không ném", () => {
    const tho = JSON.stringify([{ lenh: 1 }, { lenh: "a", dauRa: "b", luc: "c", nguon: "model" }, { lenh: "ok", dauRa: "d", luc: "e", nguon: "vong_tu_dong", ketQua: "xanh" }]);
    const ra = moGoiNhatKy(tho, () => []);
    expect(ra.map((x) => x.lenh)).toEqual(["ok"]);
    expect(ra[0]!.ketQua).toBeNull();
    expect(moGoiNhatKy("{hỏng", () => [])).toEqual([]);
    const nem = { getItem: () => { throw new Error("chặn"); }, setItem: () => { throw new Error("đầy"); }, removeItem: () => {} };
    expect(docNhatKyLenh(nem, "x", () => [])).toEqual([]);
    expect(() => luuNhatKyLenh(nem, "x", [L("a")])).not.toThrow();
  });
});

describe("anhLoiChat", () => {
  const anh = (type: string, size = 10) => ({ type, size }) as File;
  it("★★ lấy ẢNH đầu tiên (items trước, files sau); chữ thường ⇒ null", () => {
    const f = anh("image/png");
    expect(layAnhTuDuLieu({ items: [{ kind: "string", type: "text/plain", getAsFile: () => null }, { kind: "file", type: "image/png", getAsFile: () => f }] })).toBe(f);
    expect(layAnhTuDuLieu({ items: [], files: [anh("text/plain"), f] })).toBe(f);
    expect(layAnhTuDuLieu({ items: [{ kind: "string", type: "text/plain", getAsFile: () => null }] })).toBeNull();
    expect(layAnhTuDuLieu(null)).toBeNull();
  });
  it("★★ chỉ ảnh raster; trần 4 MB; SVG ⇒ không nhận", () => {
    expect(kiemAnhLoi(anh("image/png"))).toBe("ok");
    expect(kiemAnhLoi(anh("image/svg+xml"))).toBe("khong_phai_anh");
    expect(kiemAnhLoi(anh("application/pdf"))).toBe("khong_phai_anh");
    expect(kiemAnhLoi(anh("image/jpeg", TRAN_BYTE_ANH_CLIENT + 1))).toBe("qua_lon");
  });
  it("★★ khối chèn có nhãn + rào DÀI hơn mọi chuỗi backtick trong chữ OCR (không thoát rào)", () => {
    const k = khoiChuOcr("a ```` b\n", "Nhãn:");
    expect(k.startsWith("Nhãn:\n`````text\n")).toBe(true);
    expect(k.trimEnd().endsWith("`````")).toBe(true);
    expect(chenVaoO("", "K\n", null)).toBe("K\n");
    expect(chenVaoO("câu hỏi", "K\n", null)).toBe("câu hỏi\n\nK\n");
    expect(chenVaoO("ab", "K\n", 1)).toBe("a\n\nK\nb");
  });
});

describe("bangGitLogic", () => {
  it("nhanTrangThai / thongDiepDung / tenNhanhHopLeClient / cauLoiGit", () => {
    expect(nhanTrangThai("??")).toEqual({ kyTu: "U", loai: "moi" });
    expect(nhanTrangThai(" M").kyTu).toBe("M");
    expect(nhanTrangThai(" D").kyTu).toBe("D");
    expect(nhanTrangThai("R ").kyTu).toBe("R");
    expect(nhanTrangThai("UU").kyTu).toBe("!");
    expect(thongDiepDung("  ")).toBe(false);
    expect(thongDiepDung("Sửa")).toBe(true);
    expect(tenNhanhHopLeClient("a/b")).toBe(true);
    expect(tenNhanhHopLeClient("-x")).toBe(false);
    const t = (k: string, o?: unknown) => (o ? `${k}:${JSON.stringify(o)}` : k);
    expect(cauLoiGit("GIT_CAY_BAN", t)).toBe("repoWs.git.loi.GIT_CAY_BAN [GIT_CAY_BAN]");
    expect(cauLoiGit("LA", t)).toBe('repoWs.git.loi.khac:{"ma":"LA"}');
  });
});
