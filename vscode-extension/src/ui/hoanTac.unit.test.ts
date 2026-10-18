/**
 * ★★★ ĐỢT 4B — lưới CHECKPOINT + "Hoàn tác lượt chạy": khôi phục qua `apBanVa` (thay/tạo/xoá đúng chiều), XUNG ĐỘT
 * (băm hiện tại ≠ băm AI để lại) ⇒ từ chối CẢ lượt, không đường nào bị đụng.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { SoCheckpoint, lapKeHoachHoanTac } from "../loi/checkpoint";
import { hoanTacLuotChay } from "./hoanTac";
import type { DauVaoApBanVa, KetQuaApBanVa } from "./apBanVa";

const bam = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

function dungDia(ban: Record<string, string>) {
  const dia = new Map(Object.entries(ban));
  const ap: DauVaoApBanVa[] = [];
  const pt = {
    apBanVa: async (dv: DauVaoApBanVa): Promise<KetQuaApBanVa> => {
      ap.push(dv);
      const t = dv.thaoTac!;
      if (t.loai === "xoa") dia.delete(dv.duongTuyetDoi);
      else if (t.loai === "tao" || t.loai === "thay") dia.set(dv.duongTuyetDoi, t.noiDungMoi);
      return { ok: true, thongDiep: "ok" };
    },
    dauVaoChung: async () => ({ thuMucWorkspace: ["/ws"], nhanWorkspace: "/ws", serverUrl: "http://x", cookie: "c", mucQuyen: "hoi_truoc_khi_ghi" as const }),
    docBam: async (p: string) => (dia.has(p) ? bam(dia.get(p)!) : null),
  };
  return { dia, ap, pt };
}

describe("hoàn tác lượt chạy", () => {
  it("★★★ sửa + tạo + xoá + đổi tên ⇒ mọi đường về GỐC qua apBanVa (xoá trước, tạo sau)", async () => {
    // Trạng thái SAU lượt chạy: a sửa A1→A3, n mới, b đã xoá, c đổi tên thành d.
    const { dia, ap, pt } = dungDia({ "/ws/a.ts": "A3", "/ws/n.ts": "N", "/ws/d.ts": "C" });
    const so = new SoCheckpoint("r");
    so.ghiNhan("/ws/a.ts", "a.ts", "A1", bam("A2"));
    so.ghiNhan("/ws/a.ts", "a.ts", "BO_QUA", bam("A3"));
    so.ghiNhan("/ws/n.ts", "n.ts", null, bam("N"));
    so.ghiNhan("/ws/b.ts", "b.ts", "B", null);
    so.ghiNhan("/ws/c.ts", "c.ts", "C", null);
    so.ghiNhan("/ws/d.ts", "d.ts", null, bam("C"));
    const kq = await hoanTacLuotChay(so, pt);
    expect(kq.ok).toBe(true);
    expect(Object.fromEntries(dia)).toEqual({ "/ws/a.ts": "A1", "/ws/b.ts": "B", "/ws/c.ts": "C" });
    const loai = ap.map((x) => x.thaoTac!.loai);
    expect(loai.slice(0, 2).sort()).toEqual(["xoa", "xoa"]);
    expect(loai.slice(-2)).toEqual(["tao", "tao"]);
    // bamGoc của bước thay/xoá = băm HIỆN TẠI (apBanVa kiểm xung đột lần nữa ở chính điểm ghi)
    expect(ap.find((x) => x.duongTuongDoi === "a.ts")!.bamGoc).toBe(bam("A3"));
  });

  it("★★★ XUNG ĐỘT: một tệp bị sửa tiếp sau AI ⇒ từ chối CẢ lượt, không gọi apBanVa lần nào", async () => {
    const { ap, pt } = dungDia({ "/ws/a.ts": "A2 + nguoi dung sua them", "/ws/n.ts": "N" });
    const so = new SoCheckpoint("r");
    so.ghiNhan("/ws/a.ts", "a.ts", "A1", bam("A2"));
    so.ghiNhan("/ws/n.ts", "n.ts", null, bam("N"));
    const kq = await hoanTacLuotChay(so, pt);
    expect(kq.ok).toBe(false);
    expect(kq.thongDiep).toMatch(/xung đột/);
    expect(kq.chiTiet.join("\n")).toContain("a.ts");
    expect(ap).toHaveLength(0);
  });

  it("★★ tệp AI đã xoá nhưng giờ lại có ⇒ xung đột", () => {
    const so = new SoCheckpoint("r");
    so.ghiNhan("/ws/b.ts", "b.ts", "B", null);
    const kh = lapKeHoachHoanTac(so.danhSach(), new Map([["/ws/b.ts", bam("khac")]]), bam);
    expect(kh.xungDot).toHaveLength(1);
  });

  it("★★ không đo được trạng thái ⇒ xung đột (không đoán)", () => {
    const so = new SoCheckpoint("r");
    so.ghiNhan("/ws/a.ts", "a.ts", "A", bam("B"));
    expect(lapKeHoachHoanTac(so.danhSach(), new Map(), bam).xungDot).toHaveLength(1);
  });

  it("★★ checkpoint rỗng ⇒ nói rõ không có gì", async () => {
    const { pt } = dungDia({});
    const kq = await hoanTacLuotChay(new SoCheckpoint("r"), pt);
    expect(kq.ok).toBe(false);
    expect(kq.thongDiep).toMatch(/chưa ghi tệp nào/);
  });
});
