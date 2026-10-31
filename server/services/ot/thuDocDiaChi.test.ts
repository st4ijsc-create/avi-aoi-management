/**
 * SCADA R1b-2b-2b A C4 — phần thuần của Lab "thử đọc một địa chỉ": làm sạch văn bản driver (KD-2bA 4.6), chuẩn hoá giá trị, trần (4.4), bộ ghi kết quả
 * nền có trần (4.5). Thủ tục + CSDL: `server/routers/scadaDiagRouter.thuDoc.r1b2b2b.db.test.ts`.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  CUA_SO_TRAN_THU_DOC_MS,
  HAN_GIU_CHO_THU_DOC_TOI_DA_MS,
  TRAN_GHI_KET_QUA_THU_DOC,
  TRAN_THU_DOC_MOI_PHUT,
  _datLaiThuDocChoTest,
  chuanHoaGiaTriThuDoc,
  datChoThuDoc,
  ghiKetQuaThuDocNen,
  lamSachLyDoDriver,
  trangThaiThuDoc,
} from "./thuDocDiaChi";

beforeEach(() => _datLaiThuDocChoTest());

describe("lamSachLyDoDriver (KD-2bA 4.6)", () => {
  it.each([
    ["connect ECONNREFUSED 10.0.0.5:502", "connect ECONNREFUSED <host>"],
    ["Error: connect ETIMEDOUT 192.168.1.20\n    at TCPConnectWrap.afterConnect (node:net:1555:16)", "Error: connect ETIMEDOUT <host>"],
    ["read ECONNRESET plc-line3.factory.local:4840", "read ECONNRESET <host>"],
    ["cannot reach opc.tcp://plc01.local:4840/UA/Server", "cannot reach <url>"],
    ["connect ECONNREFUSED [fe80::1%eth0]:502", "connect ECONNREFUSED <host>"],
    ["connect EHOSTUNREACH fe80::1%eth0 port 502 at 10:30:00", "connect EHOSTUNREACH <host> port 502 at 10:30:00"],
    ["ENOENT: open 'C:\\Users\\svc\\pki\\own\\cert.pem'", "ENOENT: open '<path>'"],
    ["EACCES /var/lib/aoi/pki/private.pem", "EACCES <path>"],
    ["share \\\\fileserver\\ot\\cfg.json missing", "share <path> missing"],
    ["Modbus exception 2: Illegal data address (register 40001)", "Modbus exception 2: Illegal data address (register 40001)"],
  ])("%s", (vao, ra) => {
    expect(lamSachLyDoDriver(vao)).toBe(ra);
  });
  it("cắt ≤ 256; rỗng / null ⇒ null", () => {
    expect(lamSachLyDoDriver("x".repeat(1000))!.length).toBe(256);
    expect(lamSachLyDoDriver("   \n  at foo")).toBeNull();
    expect(lamSachLyDoDriver(null)).toBeNull();
    expect(lamSachLyDoDriver(undefined)).toBeNull();
  });
});

describe("chuanHoaGiaTriThuDoc", () => {
  it("nguyên thuỷ giữ; chuỗi cắt 256; NaN / Infinity ⇒ null; bigint ⇒ chuỗi; đối tượng ⇒ JSON cắt 256", () => {
    expect(chuanHoaGiaTriThuDoc(7)).toBe(7);
    expect(chuanHoaGiaTriThuDoc(false)).toBe(false);
    expect(chuanHoaGiaTriThuDoc("a".repeat(300))).toHaveLength(256);
    expect(chuanHoaGiaTriThuDoc(Number.NaN)).toBeNull();
    expect(chuanHoaGiaTriThuDoc(Infinity)).toBeNull();
    expect(chuanHoaGiaTriThuDoc(12n)).toBe("12");
    expect(chuanHoaGiaTriThuDoc([1, 2])).toBe("[1,2]");
    expect(chuanHoaGiaTriThuDoc({ a: "b".repeat(500) })).toHaveLength(256);
    expect(chuanHoaGiaTriThuDoc(undefined)).toBeNull();
  });
});

describe("datChoThuDoc (trần 10 / phút / người + 1 đang bay / adapter — KD-2bA 4.4)", () => {
  it("lượt 11 trong cửa sổ ⇒ rateLimited; mốc trượt ra khỏi 60 s ⇒ lại được", () => {
    const t = 1_000_000;
    for (let i = 0; i < TRAN_THU_DOC_MOI_PHUT; i++) {
      const c = datChoThuDoc(1, 100 + i, t + i);
      expect(c.ok).toBe(true);
      if (c.ok) c.xongDoc();
    }
    expect(datChoThuDoc(1, 200, t + 100)).toEqual({ ok: false, lyDo: "rateLimited" });
    expect(datChoThuDoc(2, 200, t + 100).ok).toBe(true); // người khác
    expect(datChoThuDoc(1, 201, t + CUA_SO_TRAN_THU_DOC_MS + 1).ok).toBe(true);
  });
  it("huy() gỡ mốc (không đếm) + trả chỗ; xongDoc() trả chỗ, GIỮ mốc; idempotent", () => {
    const t = 5_000_000;
    const a = datChoThuDoc(1, 7, t);
    expect(datChoThuDoc(2, 7, t)).toEqual({ ok: false, lyDo: "scadaLabDangBan" });
    if (!a.ok) throw new Error("a");
    a.huy();
    a.huy();
    a.xongDoc();
    for (let i = 0; i < TRAN_THU_DOC_MOI_PHUT; i++) {
      const c = datChoThuDoc(1, 7, t + i);
      expect(c.ok, `lượt ${i}`).toBe(true);
      if (c.ok) c.xongDoc();
    }
    expect(datChoThuDoc(1, 8, t + 50).ok).toBe(false);
  });
  it("van xả: chỗ giữ quá HAN_GIU_CHO_THU_DOC_TOI_DA_MS (driver không bao giờ xong) ⇒ tái dùng được; chỗ CŨ trả muộn không gỡ chỗ MỚI", () => {
    const t = 9_000_000;
    const cu = datChoThuDoc(1, 9, t);
    expect(datChoThuDoc(2, 9, t + HAN_GIU_CHO_THU_DOC_TOI_DA_MS - 1).ok).toBe(false);
    const moi = datChoThuDoc(2, 9, t + HAN_GIU_CHO_THU_DOC_TOI_DA_MS + 1);
    expect(moi.ok).toBe(true);
    if (cu.ok) cu.xongDoc();
    expect(trangThaiThuDoc().adapterDangDoc).toContain(9);
  });
});

describe("ghiKetQuaThuDocNen (KD-2bA 4.5 — đếm in-flight, có trần, không ném)", () => {
  it("đủ trần ⇒ bỏ (đếm); lỗi / ném đồng bộ ⇒ đếm lỗi, không ném; xong ⇒ trả chỗ", async () => {
    const nha: Array<() => void> = [];
    for (let i = 0; i < TRAN_GHI_KET_QUA_THU_DOC; i++) ghiKetQuaThuDocNen(() => new Promise<void>((r) => nha.push(r)), { adapterId: 1, maLuot: String(i) });
    expect(trangThaiThuDoc().ketQuaDangBay).toBe(TRAN_GHI_KET_QUA_THU_DOC);
    ghiKetQuaThuDocNen(async () => undefined, { adapterId: 1, maLuot: String(99) });
    expect(trangThaiThuDoc().soKetQuaBoQua).toBe(1);
    nha.forEach((f) => f());
    await new Promise((r) => setTimeout(r, 0));
    expect(trangThaiThuDoc().ketQuaDangBay).toBe(0);
    expect(() =>
      ghiKetQuaThuDocNen(() => {
        throw new Error("ném đồng bộ 10.0.0.5:502");
      }, { adapterId: 1, maLuot: String(1) }),
    ).not.toThrow();
    ghiKetQuaThuDocNen(async () => Promise.reject(new Error("db hỏng")), { adapterId: 1, maLuot: String(2) });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(trangThaiThuDoc()).toMatchObject({ ketQuaDangBay: 0, soKetQuaLoi: 2 });
  });
});
