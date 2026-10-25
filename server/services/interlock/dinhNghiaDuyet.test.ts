/**
 * kiem-dinh R1b-1 I1 (a) — phần THUẦN của bám định nghĩa (`dinhNghiaDuyet.ts`): chuẩn hoá scale / offset = đường đọc (`troLaiKenh`), bám tất định
 * và nhạy với từng thành phần, `duyetConHieuLuc` fail-closed, `luatDuyetConHieuLuc` không bao giờ ném. Đường DB thật:
 * `server/routers/interlockRouter.kiemDinh.r1b.db.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { bamDinhNghia, duyetConHieuLuc, luatDuyetConHieuLuc, offsetBam, scaleBam, type DinhNghiaLuat } from "./dinhNghiaDuyet";
import { offsetDoc, scaleDoc } from "../scada/troLaiKenh";

const goc: DinhNghiaLuat = {
  v: 1,
  dich: { adapterId: 7, adapterTonTai: true, edgeNodeId: null, tag: { tagKey: "van", address: "40001", dataType: "int", scale: 1, offset: 0 } },
  nguon: { machineId: 3, sourceKey: "nhiet", tags: [{ adapterId: 7, edgeNodeId: null, address: "30001", dataType: "float", scale: 1, offset: 0 }] },
};

describe("kiem-dinh I1 (a) — dinhNghiaDuyet thuần", () => {
  it("scaleBam / offsetBam CÙNG công thức troLaiKenh.scaleDoc / offsetDoc", () => {
    for (const v of [null, undefined, "", "1", "1.000000", 0, "0", 2, "2.5", -1, "abc"]) {
      expect(Object.is(scaleBam(v), scaleDoc(v)), `scale ${String(v)}`).toBe(true);
      expect(Object.is(offsetBam(v), offsetDoc(v)), `offset ${String(v)}`).toBe(true);
    }
  });

  it("bám tất định (thứ tự khoá không đổi bám) và có dạng d1:<64 hex> (≤ varchar(80))", () => {
    const daoKhoa: DinhNghiaLuat = { nguon: goc.nguon, dich: goc.dich, v: 1 };
    expect(bamDinhNghia(daoKhoa)).toBe(bamDinhNghia(goc));
    expect(bamDinhNghia(goc)).toMatch(/^d1:[0-9a-f]{64}$/);
    expect(bamDinhNghia(goc).length).toBeLessThanOrEqual(80);
  });

  it("★ mỗi thành phần đổi ⇒ bám đổi: address / dataType / scale / offset / adapterId / edgeNodeId (đích & nguồn), tag vắng, thêm tag nguồn", () => {
    const b0 = bamDinhNghia(goc);
    const bien: Array<[string, DinhNghiaLuat]> = [
      ["address đích", { ...goc, dich: { ...goc.dich!, tag: { ...goc.dich!.tag!, address: "40002" } } }],
      ["dataType đích", { ...goc, dich: { ...goc.dich!, tag: { ...goc.dich!.tag!, dataType: "float" } } }],
      ["scale đích", { ...goc, dich: { ...goc.dich!, tag: { ...goc.dich!.tag!, scale: 10 } } }],
      ["offset đích", { ...goc, dich: { ...goc.dich!, tag: { ...goc.dich!.tag!, offset: 1 } } }],
      ["adapterId đích", { ...goc, dich: { ...goc.dich!, adapterId: 8 } }],
      ["edgeNodeId đích", { ...goc, dich: { ...goc.dich!, edgeNodeId: 5 } }],
      ["tag đích vắng", { ...goc, dich: { ...goc.dich!, tag: null } }],
      ["edgeNodeId nguồn", { ...goc, nguon: { ...goc.nguon!, tags: [{ ...goc.nguon!.tags[0], edgeNodeId: 5 }] } }],
      ["address nguồn", { ...goc, nguon: { ...goc.nguon!, tags: [{ ...goc.nguon!.tags[0], address: "30009" }] } }],
      ["thêm tag nguồn", { ...goc, nguon: { ...goc.nguon!, tags: [...goc.nguon!.tags, { ...goc.nguon!.tags[0], adapterId: 9 }] } }],
    ];
    for (const [nhan, dn] of bien) expect(bamDinhNghia(dn), nhan).not.toBe(b0);
  });

  it("★ duyetConHieuLuc fail-closed: không người duyệt / bám NULL / rỗng / lệch ⇒ false; khớp ⇒ true", () => {
    const b = bamDinhNghia(goc);
    expect(duyetConHieuLuc({ approvedBy: 1, approvedDefHash: b }, b)).toBe(true);
    expect(duyetConHieuLuc({ approvedBy: null, approvedDefHash: b }, b)).toBe(false);
    expect(duyetConHieuLuc({ approvedBy: 1, approvedDefHash: null }, b)).toBe(false);
    expect(duyetConHieuLuc({ approvedBy: 1, approvedDefHash: "" }, "")).toBe(false);
    expect(duyetConHieuLuc({ approvedBy: 1, approvedDefHash: b }, `${b}x`)).toBe(false);
    expect(duyetConHieuLuc({ approvedBy: 1 }, b)).toBe(false);
  });

  it("luatDuyetConHieuLuc KHÔNG BAO GIỜ ném: DB ném / không có DB / không có execute ⇒ false", async () => {
    const luat = { id: 1, sourceType: "ng_rate", machineId: null, sourceKey: null, targetAdapterId: 7, commandTag: "van", approvedBy: 1, approvedDefHash: "d1:x" } as never;
    expect(await luatDuyetConHieuLuc({ execute: async () => Promise.reject(new Error("db chết")) }, luat)).toBe(false);
    expect(await luatDuyetConHieuLuc(null, luat)).toBe(false);
    expect(await luatDuyetConHieuLuc({} as never, luat)).toBe(false);
  });
});
