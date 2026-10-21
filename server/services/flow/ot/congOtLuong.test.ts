/**
 * ★★★ Đợt 8.5 — `kiemVaDeXuat` (thuần, nguồn đọc giả): bộ đột biến mức 4–5 ⇒ 100 % bị chặn, 0 đề xuất; stop/pause ⇒ đề xuất
 * MÔ PHỎNG; FOE workflow đã duyệt ⇒ mức = max các bước lệnh; kết quả sau duyệt KHÔNG BAO GIỜ "đã gửi".
 */
import { describe, expect, it } from "vitest";
import {
  CHE_DO_MO_PHONG,
  GHI_CHU_DA_DUYET_MO_PHONG,
  NGUON_LUONG_AI,
  ketQuaSauDuyetMoPhong,
  kiemVaDeXuat,
  laDeXuatOtLuong,
  laTagBiChan,
  toolChoLenh,
  type PhuThuocCongOt,
} from "./congOtLuong";
import { CA_CAO, CA_THAP, MAY_THU, TAG_CO_THAT } from "./__boDotBienOt";

const goiDoc: string[] = [];
const nguon = (luong: Record<number, { trangThai: string; definition: unknown }> = {}): PhuThuocCongOt => ({
  async tagTonTai(may, tag) {
    goiDoc.push(`tag:${may}:${tag}`);
    return may === MAY_THU && (TAG_CO_THAT as readonly string[]).includes(tag);
  },
  async docLuongFoe(id) {
    const l = luong[id];
    return l ? { ref: `wf-${id}`, ten: `WF ${id}`, ...l } : null;
  },
});
const ngu = (i: number) => ({ runId: "r", nodeId: "n", idempotencyKey: `r:n:${i}` });

describe("Đợt 8.5 — cổng OT của Luồng (thuần)", () => {
  it("chế độ mô phỏng là HẰNG SỐ true", () => {
    expect(CHE_DO_MO_PHONG).toBe(true);
  });

  it(`★★★ bộ đột biến mức 4–5: ${CA_CAO.length} yêu cầu ⇒ 100 % bị chặn, 0 đề xuất`, async () => {
    expect(CA_CAO.length).toBeGreaterThanOrEqual(20);
    const p = nguon();
    const lot: string[] = [];
    let deXuat = 0;
    for (const [i, c] of CA_CAO.entries()) {
      const kq = await kiemVaDeXuat({ loai: "lenh", may: c.may, lenh: c.lenh, tag: c.tag, giaTri: c.giaTri }, ngu(i), p);
      if (kq.ketQua !== "tu-choi-muc-cao") {
        deXuat++;
        lot.push(c.ten);
      } else expect(kq.muc).toBeGreaterThanOrEqual(4);
    }
    expect(lot, "yêu cầu mức cao LỌT thành đề xuất").toEqual([]);
    expect(deXuat).toBe(0);
  });

  it(`★★ mức thấp: ${CA_THAP.length} yêu cầu stop/pause ⇒ đề xuất MÔ PHỎNG mức 1`, async () => {
    expect(CA_THAP.length).toBeGreaterThanOrEqual(5);
    for (const [i, c] of CA_THAP.entries()) {
      const kq = await kiemVaDeXuat({ loai: "lenh", may: c.may, lenh: c.lenh }, ngu(100 + i), nguon());
      expect(kq.ketQua, c.ten).toBe("da-de-xuat");
      if (kq.ketQua !== "da-de-xuat") continue;
      expect(kq.muc).toBe(1);
      expect(kq.deXuatId).toBe(`ot:r:n:${100 + i}`);
      const cho = kq.yeuCauCho.__cho;
      expect(cho.kind).toBe("duyet");
      expect(cho.payload).toMatchObject({ nguon: NGUON_LUONG_AI, moPhong: true, muc: 1, deXuatId: kq.deXuatId });
      expect(cho.items).toEqual([{ json: expect.objectContaining({ deXuatId: kq.deXuatId, muc: 1, ketQua: "da-de-xuat", moPhong: true }) }]);
      expect(laDeXuatOtLuong(cho.payload)).toBe(true);
    }
  });

  it("ghi tham số không-an-toàn trên tag CÓ THẬT ⇒ mức 3 (đề xuất); tag được tra trong máy (đọc)", async () => {
    goiDoc.length = 0;
    const kq = await kiemVaDeXuat({ loai: "lenh", may: MAY_THU, lenh: "set_machine_param", tag: "Speed_Setpoint", giaTri: 120 }, ngu(200), nguon());
    expect(kq).toMatchObject({ ketQua: "da-de-xuat", muc: 3 });
    expect(goiDoc).toEqual([`tag:${MAY_THU}:Speed_Setpoint`]);
  });

  it("tag lạ KHÔNG bị tra CSDL khi tên đã bị chặn (an toàn trước, đọc sau)", async () => {
    goiDoc.length = 0;
    await kiemVaDeXuat({ loai: "lenh", may: MAY_THU, lenh: "set_machine_param", tag: "Safety_Door_Bypass", giaTri: 1 }, ngu(201), nguon());
    expect(goiDoc).toEqual([]);
  });

  it("toolChoLenh khớp CHÍNH XÁC, không chuẩn hoá; laTagBiChan bắt biến thể", () => {
    expect(toolChoLenh("stop")).toBe("machine_stop");
    expect(toolChoLenh("STOP")).toBe("STOP");
    expect(toolChoLenh(" stop")).toBe(" stop");
    expect(toolChoLenh(1)).toBe("");
    for (const t of ["E-STOP", "E.STOP", "e stop", "ｓafety", "Interlock1", "door.lock"]) expect(laTagBiChan(t), t).toBe(true);
    for (const t of ["Speed_Setpoint", "Line1.Temp_SP"]) expect(laTagBiChan(t), t).toBe(false);
  });

  describe("ot.de-xuat-luong — FOE workflow đã duyệt", () => {
    const buoc = (id: string, command: string, extra: Record<string, unknown> = {}) => ({ id, type: "command", machineId: MAY_THU, command, ...extra });
    const luong = {
      1: { trangThai: "active", definition: { steps: [{ id: "s", type: "sequence", steps: [buoc("a", "stop"), { id: "w", type: "delay", ms: 10 }, buoc("b", "pause")] }] } },
      2: { trangThai: "active", definition: { steps: [buoc("a", "stop"), buoc("b", "start")] } },
      3: { trangThai: "draft", definition: { steps: [buoc("a", "stop")] } },
      4: { trangThai: "active", definition: { steps: [{ id: "x", type: "bay_len" }] } },
      5: { trangThai: "active", definition: { steps: [buoc("a", "stop", { compensation: buoc("c", "reset") })] } },
      6: { trangThai: "active", definition: { steps: [buoc("a", "set_machine_param", { args: { paramKey: "Interlock_Bypass", paramValue: "1" } })] } },
      7: { trangThai: "active", definition: { steps: [{ id: "b", type: "branch", then: [buoc("t", "stop")], else: [buoc("e", "STOP")] }] } },
    };
    it("chỉ stop/pause ⇒ đề xuất mức 1", async () => {
      expect(await kiemVaDeXuat({ loai: "luong-foe", workflowId: 1, version: 1 }, ngu(300), nguon(luong))).toMatchObject({ ketQua: "da-de-xuat", muc: 1 });
    });
    it.each([
      [2, "có bước start"],
      [3, "chưa duyệt (draft)"],
      [4, "loại bước lạ"],
      [5, "bù trừ là reset"],
      [6, "tham số interlock"],
      [7, "nhánh else lệnh viết hoa lạ"],
      [99, "không tồn tại"],
    ])("workflow #%s (%s) ⇒ bị chặn, không đề xuất", async (id) => {
      const kq = await kiemVaDeXuat({ loai: "luong-foe", workflowId: id, version: 1 }, ngu(400 + id), nguon(luong));
      expect(kq.ketQua).toBe("tu-choi-muc-cao");
      expect(kq.muc).toBeGreaterThanOrEqual(4);
    });
    it("id/version không phải số nguyên dương ⇒ chặn", async () => {
      for (const xau of [" 1", "1e0", "0x1", -1, 1.5, null, [1], "", 0]) {
        expect((await kiemVaDeXuat({ loai: "luong-foe", workflowId: xau, version: 1 }, ngu(500), nguon(luong))).ketQua, JSON.stringify(xau)).toBe("tu-choi-muc-cao");
      }
      // Đợt 9 — chuỗi số hợp lệ được chuẩn hoá (MỘT luật chuanHoaIdMay cho mọi đường vào) ⇒ như số
      expect((await kiemVaDeXuat({ loai: "luong-foe", workflowId: "1", version: "1" }, ngu(500), nguon(luong))).ketQua).toBe("da-de-xuat");
    });
  });

  it("★ sau duyệt: KHÔNG BAO GIỜ 'đã gửi' — đồng ý chỉ ghi 'đã duyệt (mô phỏng) — không gửi'", () => {
    expect(ketQuaSauDuyetMoPhong(true).thucThi).toMatchObject({ moPhong: true, daGui: false, ghiChu: GHI_CHU_DA_DUYET_MO_PHONG });
    expect(ketQuaSauDuyetMoPhong(false).thucThi).toMatchObject({ moPhong: true, daGui: false });
    expect(laDeXuatOtLuong({ tieuDe: "x" })).toBe(false);
  });
});
