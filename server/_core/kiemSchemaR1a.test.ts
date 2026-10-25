/**
 * kiem-dinh P1-6 (2026-10-24) — kiểm schema R1a lúc khởi động (TRƯỚC startOt) + /health + nguyên nhân TOTP_KHONG_KIEM_DUOC.
 * `information_schema` GIẢ: `chay` trả các hàng theo câu SQL (nhận ra bằng tên bảng information_schema trong câu).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import express from "express";
import type { AddressInfo } from "node:net";
import {
  BANG_0431,
  CHU_KY_NHAC_MS,
  COT_DEVICE_TAGS_0431,
  __datTrangThaiSchemaR1a,
  khoiDongOtCoKiemSchema,
  kiemSchemaR1a,
  lyDoSchemaR1a,
  phanLoaiLoiKiem,
  trangThaiSchemaR1a,
} from "./kiemSchemaR1a";
import { createHealthHandler } from "./healthProbes";
import { nguyenNhanBoDemHong } from "./totpKhoaSai";

const dialect = new PgDialect();

/** information_schema giả: `bo` = đối tượng bị bỏ ("device_tags.write_step", "scada_khoa_chon", "totp_khoa_sai", "totp_khoa_sai.loai", "scada_command_attempts.ly_do"). */
function gia(bo: string[] = []) {
  const cauHoi: string[] = [];
  const chay = async (q: SQL) => {
    const { sql: text } = dialect.sqlToQuery(q);
    cauHoi.push(text);
    if (/information_schema\.columns/.test(text)) {
      const ra = COT_DEVICE_TAGS_0431.map((c) => ({ table_name: "device_tags", column_name: c }));
      ra.push({ table_name: "totp_khoa_sai", column_name: "loai" } as never);
      ra.push({ table_name: "scada_command_attempts", column_name: "ly_do" } as never);
      // kiem-dinh R1b-1 I-C (fix round 2) — FIXTURE: cột của mig 0434 (DB "đủ" nay gồm 0434)
      ra.push({ table_name: "interlock_rules", column_name: "approvedDefHash" } as never);
      return ra.filter((r) => !bo.includes(`${r.table_name}.${r.column_name}`) && !bo.includes(r.table_name));
    }
    if (/information_schema\.tables/.test(text)) {
      return [...BANG_0431, "totp_khoa_sai"].filter((b) => !bo.includes(b)).map((b) => ({ table_name: b }));
    }
    throw new Error(`câu lạ: ${text}`);
  };
  return { chay, cauHoi };
}

afterEach(() => {
  __datTrangThaiSchemaR1a({ kieu: "chua_kiem" });
  vi.useRealTimers();
});

describe("kiemSchemaR1a — truy vấn CHỈ ĐỌC information_schema", () => {
  it("đủ ⇒ không thiếu gì; chỉ SELECT trên information_schema", async () => {
    const g = gia();
    expect(await kiemSchemaR1a(g.chay)).toEqual({ thieu0431: [], thieu0432: [], thieu0433: [], thieu0434: [] }); // I-C: + 0434
    expect(g.cauHoi).toHaveLength(2);
    for (const c of g.cauHoi) {
      expect(c.trim()).toMatch(/^SELECT /);
      expect(c).toMatch(/information_schema\./);
      expect(c).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i);
    }
  });
  it("thiếu cột / bảng 0431 ⇒ liệt kê đích danh", async () => {
    const r = await kiemSchemaR1a(gia(["device_tags.actuation_level", "scada_khoa_chon"]).chay);
    expect(r.thieu0431).toEqual(["device_tags.actuation_level", "scada_khoa_chon"]);
    expect(r.thieu0432).toEqual([]);
    expect(r.thieu0433).toEqual([]);
  });
  it("★ R1b-1 T7 — 0433: bảng có mà thiếu cột ly_do ⇒ scada_command_attempts.ly_do; bảng vắng (thiếu 0431) ⇒ KHÔNG đếm hai lần", async () => {
    const r = await kiemSchemaR1a(gia(["scada_command_attempts.ly_do"]).chay);
    expect(r).toEqual({ thieu0431: [], thieu0432: [], thieu0433: ["scada_command_attempts.ly_do"], thieu0434: [] }); // I-C: + 0434
    const vang = await kiemSchemaR1a(gia(["scada_command_attempts"]).chay);
    expect(vang.thieu0431).toEqual(["scada_command_attempts"]);
    expect(vang.thieu0433).toEqual([]);
  });
  it("0432: thiếu bảng ⇒ totp_khoa_sai; có bảng mà thiếu cột loai (bản 0432 cũ) ⇒ totp_khoa_sai.loai", async () => {
    expect((await kiemSchemaR1a(gia(["totp_khoa_sai"]).chay)).thieu0432).toEqual(["totp_khoa_sai"]);
    expect((await kiemSchemaR1a(gia(["totp_khoa_sai.loai"]).chay)).thieu0432).toEqual(["totp_khoa_sai.loai"]);
  });
});

describe("khoiDongOtCoKiemSchema — kiểm TRƯỚC startOt", () => {
  it("đủ schema ⇒ startOt rồi sauStartOt, không log lỗi", async () => {
    const thuTu: string[] = [];
    const logLoi = vi.fn();
    const kq = await khoiDongOtCoKiemSchema({
      chay: gia().chay,
      startOt: async () => void thuTu.push("startOt"),
      sauStartOt: async () => void thuTu.push("sau"),
      logLoi,
    });
    expect(kq).toBe("da_start");
    expect(thuTu).toEqual(["startOt", "sau"]);
    expect(logLoi).not.toHaveBeenCalled();
    expect(lyDoSchemaR1a()).toBeNull();
  });

  it("★ THIẾU 0431 ⇒ startOt KHÔNG được gọi (không chạy với danh sách adapter rỗng), khối lỗi nổi bật gọi tên 0431, /health có lý do", async () => {
    const startOt = vi.fn(async () => undefined);
    const sauStartOt = vi.fn(async () => undefined);
    const logLoi = vi.fn();
    const kq = await khoiDongOtCoKiemSchema({ chay: gia(["device_tags.channel_kind", "scada_command_attempts"]).chay, startOt, sauStartOt, logLoi });
    expect(kq).toBe("bo_qua_thieu_0431");
    expect(startOt).not.toHaveBeenCalled();
    expect(sauStartOt).not.toHaveBeenCalled();
    const log = logLoi.mock.calls.map((c) => String(c[0])).join("\n");
    expect(log).toContain("THIẾU MIGRATION 0431");
    expect(log).toContain("device_tags.channel_kind");
    expect(log).toContain("scada_command_attempts");
    expect(log).toContain("startOt bị BỎ QUA");
    expect(log).toContain("apply-migration-0431");
    expect(lyDoSchemaR1a()).toMatchObject({ ok: false, thieuMigration: ["0431"] });
  });

  it("★ THIẾU 0432 ⇒ startOt VẪN chạy; lỗi log ngay + nhắc lại mỗi 5 phút; có lại bảng ⇒ thôi nhắc", async () => {
    let bo = ["totp_khoa_sai"];
    const chay = async (q: SQL) => gia(bo).chay(q);
    let nhac: (() => void) | null = null;
    let msNhac = 0;
    const boNhac = vi.fn();
    const startOt = vi.fn(async () => undefined);
    const logLoi = vi.fn();
    const kq = await khoiDongOtCoKiemSchema({
      chay,
      startOt,
      logLoi,
      datNhac: (fn, ms) => {
        nhac = fn;
        msNhac = ms;
        return { unref: () => undefined };
      },
      boNhac,
    });
    expect(kq).toBe("da_start");
    expect(startOt).toHaveBeenCalledTimes(1);
    expect(msNhac).toBe(CHU_KY_NHAC_MS);
    expect(CHU_KY_NHAC_MS).toBe(300_000);
    expect(logLoi).toHaveBeenCalledTimes(1);
    expect(String(logLoi.mock.calls[0][0])).toContain("THIẾU MIGRATION 0432");
    expect(lyDoSchemaR1a()).toMatchObject({ ok: false, thieuMigration: ["0432"] });

    nhac!();
    await vi.waitFor(() => expect(logLoi).toHaveBeenCalledTimes(2));
    expect(String(logLoi.mock.calls[1][0])).toContain("THIẾU MIGRATION 0432");

    bo = [];
    nhac!();
    await vi.waitFor(() => expect(boNhac).toHaveBeenCalledTimes(1));
    expect(lyDoSchemaR1a()).toBeNull();
  });

  it("★ R1b-1 T7 — THIẾU 0433 ⇒ startOt VẪN chạy (OT không đọc ly_do); khối lỗi gọi tên 0433 + nhắc mỗi 5 phút; có cột ⇒ thôi nhắc; /health có lý do", async () => {
    let bo = ["scada_command_attempts.ly_do"];
    const chay = async (q: SQL) => gia(bo).chay(q);
    let nhac: (() => void) | null = null;
    let msNhac = 0;
    const boNhac = vi.fn();
    const startOt = vi.fn(async () => undefined);
    const logLoi = vi.fn();
    const kq = await khoiDongOtCoKiemSchema({
      chay,
      startOt,
      logLoi,
      datNhac: (fn, ms) => {
        nhac = fn;
        msNhac = ms;
        return { unref: () => undefined };
      },
      boNhac,
    });
    expect(kq).toBe("da_start");
    expect(startOt).toHaveBeenCalledTimes(1);
    expect(msNhac).toBe(CHU_KY_NHAC_MS);
    expect(logLoi).toHaveBeenCalledTimes(1);
    const log = String(logLoi.mock.calls[0][0]);
    expect(log).toContain("THIẾU MIGRATION 0433");
    expect(log).toContain("scada_command_attempts.ly_do");
    expect(log).toContain("apply-migration-0433");
    expect(lyDoSchemaR1a()).toMatchObject({ ok: false, trangThai: "thieu", thieuMigration: ["0433"] });
    expect(trangThaiSchemaR1a()).toMatchObject({ kieu: "da_kiem", thieu0433: ["scada_command_attempts.ly_do"] });

    nhac!();
    await vi.waitFor(() => expect(logLoi).toHaveBeenCalledTimes(2));
    expect(String(logLoi.mock.calls[1][0])).toContain("THIẾU MIGRATION 0433");

    bo = [];
    nhac!();
    await vi.waitFor(() => expect(boNhac).toHaveBeenCalledTimes(1));
    expect(lyDoSchemaR1a()).toBeNull();
    expect(trangThaiSchemaR1a()).toMatchObject({ kieu: "da_kiem", thieu0433: [] });
  });

  it("★ kiem-dinh I-C — THIẾU 0434 ⇒ startOt VẪN chạy; khối lỗi gọi tên 0434 + nói cổng interlock chặn MỌI lệnh HITL + backfill TOFU; nhắc mỗi 5 phút; có cột ⇒ thôi nhắc; /health có lý do", async () => {
    let bo = ["interlock_rules.approvedDefHash"];
    const g = gia();
    const chay = async (q: SQL) => {
      const r = await g.chay(q);
      return r.filter((x: Record<string, unknown>) => !bo.includes(`${String(x.table_name)}.${String(x.column_name)}`));
    };
    let nhac: (() => void) | null = null;
    const boNhac = vi.fn();
    const startOt = vi.fn(async () => undefined);
    const logLoi = vi.fn();
    expect((await kiemSchemaR1a(chay)).thieu0434).toEqual(["interlock_rules.approvedDefHash"]);
    const kq = await khoiDongOtCoKiemSchema({
      chay,
      startOt,
      logLoi,
      datNhac: (fn) => {
        nhac = fn;
        return { unref: () => undefined };
      },
      boNhac,
    });
    expect(kq).toBe("da_start");
    expect(startOt).toHaveBeenCalledTimes(1);
    const log = String(logLoi.mock.calls[0][0]);
    expect(log).toContain("THIẾU MIGRATION 0434");
    expect(log).toContain("MỌI lệnh ghi HITL thật trên MỌI adapter");
    expect(log).toContain("apply-migration-0434");
    expect(log).toContain("backfill-approved-def-hash");
    expect(lyDoSchemaR1a()).toMatchObject({ ok: false, trangThai: "thieu", thieuMigration: ["0434"] });
    nhac!();
    await vi.waitFor(() => expect(logLoi).toHaveBeenCalledTimes(2));
    bo = [];
    nhac!();
    await vi.waitFor(() => expect(boNhac).toHaveBeenCalledTimes(1));
    expect(lyDoSchemaR1a()).toBeNull();
  });

  it("không kiểm được (truy vấn ném) ⇒ cảnh báo, startOt vẫn chạy như trước, /health không degraded vì schema", async () => {
    const startOt = vi.fn(async () => undefined);
    const logLoi = vi.fn();
    const kq = await khoiDongOtCoKiemSchema({
      chay: async () => {
        throw new Error("ECONNREFUSED");
      },
      startOt,
      logLoi,
    });
    expect(kq).toBe("da_start");
    expect(startOt).toHaveBeenCalledTimes(1);
    expect(trangThaiSchemaR1a()).toMatchObject({ kieu: "khong_kiem_duoc" });
    expect(lyDoSchemaR1a()).toBeNull();
  });
});

describe("★ R1b-1 T10 — không kiểm được lúc khởi động: /health nói thẳng + KIỂM LẠI định kỳ tới khi kiểm được", () => {
  function chayHong(bo: string[] = []) {
    const st = { ok: false, soLan: 0 };
    const chay = async (q: SQL) => {
      st.soLan++;
      if (!st.ok) throw Object.assign(new Error("connect ECONNREFUSED 10.20.30.40:5434 (user \"aoi_secret_user\", db \"aoi_management\")"), { code: "ECONNREFUSED" });
      return gia(bo).chay(q);
    };
    return { st, chay };
  }
  function hen() {
    const h = { fn: null as null | (() => void), ms: 0, unref: vi.fn(), huy: vi.fn(), soLanDat: 0 };
    const handle = { unref: h.unref };
    return {
      h,
      datNhac: (fn: () => void, ms: number) => {
        h.fn = fn;
        h.ms = ms;
        h.soLanDat++;
        return handle;
      },
      boNhac: (x: unknown) => h.huy(x),
      handle,
    };
  }
  async function goiHealth(): Promise<Record<string, unknown>> {
    const app = express();
    app.get("/health", createHealthHandler({ pinger: { ping: async () => ({ ok: true, ms: 1 }) } as never }));
    const srv = app.listen(0);
    try {
      const r = await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/health`);
      return (await r.json()) as Record<string, unknown>;
    } finally {
      srv.close();
    }
  }

  it("★ I-1 — /health (KHÔNG xác thực): schemaR1a {trangThai \"chua_kiem_duoc\", lyDo = LỚP NGẮN}; TUYỆT ĐỐI không host / port / user / tên DB / văn bản lỗi; log máy chủ vẫn giữ nguyên văn; status ok; khởi động fail-open", async () => {
    const { chay } = chayHong();
    const startOt = vi.fn(async () => undefined);
    const w = hen();
    const logLoi = vi.fn();
    expect(await khoiDongOtCoKiemSchema({ chay, startOt, logLoi, datNhac: w.datNhac, boNhac: w.boNhac })).toBe("da_start");
    expect(startOt).toHaveBeenCalledTimes(1);
    const body = await goiHealth();
    // Rà soát cuối M-7 — MỘT hình dạng: đối tượng, ok:false, không biết ⇒ thieuMigration null (KHÔNG phải rỗng / vắng); không còn khoá phụ.
    expect(body.schemaR1a).toEqual({ ok: false, trangThai: "chua_kiem_duoc", thieuMigration: null, lyDo: "ket_noi_tu_choi" });
    expect(body).not.toHaveProperty("schemaR1aLyDo");
    expect(body.status).toBe("ok");
    const thoBody = JSON.stringify(body);
    for (const cam of ["10.20.30.40", "5434", "aoi_secret_user", "aoi_management", "ECONNREFUSED", "connect "]) {
      expect(thoBody, `/health không được lộ "${cam}"`).not.toContain(cam);
    }
    // nguyên văn CHỈ ở log máy chủ
    expect(logLoi.mock.calls.map((c) => String(c[0])).join("\n")).toContain("10.20.30.40:5434");
  });

  it("I-1 — phanLoaiLoiKiem: SQLSTATE / errno ⇒ lớp ngắn; không mã thì phân lớp theo thông điệp; lạ ⇒ khac", () => {
    const e = (code: string | undefined, message = "x") => Object.assign(new Error(message), code ? { code } : {});
    expect(phanLoaiLoiKiem(e("ECONNREFUSED"))).toBe("ket_noi_tu_choi");
    expect(phanLoaiLoiKiem(e("CONNECTION_CLOSED"))).toBe("ket_noi_tu_choi");
    expect(phanLoaiLoiKiem(e("57P03"))).toBe("ket_noi_tu_choi");
    expect(phanLoaiLoiKiem(e("ETIMEDOUT"))).toBe("het_thoi_gian");
    expect(phanLoaiLoiKiem(e("CONNECT_TIMEOUT"))).toBe("het_thoi_gian");
    expect(phanLoaiLoiKiem(e("28P01"))).toBe("quyen");
    expect(phanLoaiLoiKiem(e("42501"))).toBe("quyen");
    expect(phanLoaiLoiKiem(Object.assign(new Error("wrap"), { cause: { code: "ECONNREFUSED" } }))).toBe("ket_noi_tu_choi");
    expect(phanLoaiLoiKiem(e("XX000"))).toBe("khac");
    expect(phanLoaiLoiKiem(e(undefined, "Query read timeout"))).toBe("het_thoi_gian");
    expect(phanLoaiLoiKiem(e(undefined, "password authentication failed for user \"aoi\""))).toBe("quyen");
    expect(phanLoaiLoiKiem(e(undefined, "connect ECONNREFUSED 1.2.3.4:5"))).toBe("ket_noi_tu_choi");
    expect(phanLoaiLoiKiem("boom")).toBe("khac");
    expect(phanLoaiLoiKiem(null)).toBe("khac");
  });

  it("kiểm lại mỗi 5 phút bằng hẹn giờ unref; còn hỏng ⇒ giữ nguyên, KHÔNG dừng hẹn giờ; kiểm được ⇒ dừng hẹn giờ + /health hết \"chua_kiem_duoc\"", async () => {
    const { chay, st } = chayHong();
    const w = hen();
    const logLoi = vi.fn();
    await khoiDongOtCoKiemSchema({ chay, startOt: vi.fn(async () => undefined), logLoi, datNhac: w.datNhac, boNhac: w.boNhac });
    expect(w.h.ms).toBe(CHU_KY_NHAC_MS);
    expect(w.h.unref).toHaveBeenCalledTimes(1);
    const truoc = st.soLan;
    w.h.fn!();
    await vi.waitFor(() => expect(logLoi.mock.calls.some((c) => String(c[0]).includes("vẫn KHÔNG được"))).toBe(true));
    expect(st.soLan).toBeGreaterThan(truoc);
    expect(w.h.huy).not.toHaveBeenCalled();
    expect(trangThaiSchemaR1a().kieu).toBe("khong_kiem_duoc");
    expect((await goiHealth()).schemaR1a).toMatchObject({ ok: false, trangThai: "chua_kiem_duoc" });

    st.ok = true;
    w.h.fn!();
    await vi.waitFor(() => expect(w.h.huy).toHaveBeenCalledTimes(1));
    expect(w.h.huy).toHaveBeenCalledWith(w.handle);
    expect(trangThaiSchemaR1a()).toMatchObject({ kieu: "da_kiem", thieu0431: [], thieu0432: [], thieu0433: [] });
    const body = await goiHealth();
    expect(body.schemaR1a).toBeUndefined();
    expect(body).not.toHaveProperty("schemaR1aLyDo");
    expect(body.status).toBe("ok");
    // đã dừng: không còn hẹn giờ nào được đặt thêm (đủ schema ⇒ không nhắc 0432/0433)
    expect(w.h.soLanDat).toBe(1);
  });

  it("kiểm được MUỘN mà thiếu 0431 ⇒ /health degraded + khối lỗi nói rõ phát hiện muộn; thiếu 0432 ⇒ bắt đầu nhắc định kỳ như lúc khởi động", async () => {
    const { chay, st } = chayHong(["device_tags.write_min", "totp_khoa_sai"]);
    const w = hen();
    const logLoi = vi.fn();
    const startOt = vi.fn(async () => undefined);
    await khoiDongOtCoKiemSchema({ chay, startOt, logLoi, datNhac: w.datNhac, boNhac: w.boNhac });
    st.ok = true;
    w.h.fn!();
    await vi.waitFor(() => expect(w.h.huy).toHaveBeenCalledTimes(1));
    expect(startOt).toHaveBeenCalledTimes(1); // OT không bị khởi động lại / chặn muộn
    const tat = logLoi.mock.calls.map((c) => String(c[0])).join("\n");
    expect(tat).toContain("THIẾU MIGRATION 0431");
    expect(tat).toContain("phát hiện MUỘN");
    expect(tat).toContain("THIẾU MIGRATION 0432");
    expect(w.h.soLanDat).toBe(2); // + bộ nhắc 0432
    const body = await goiHealth();
    expect(body.status).toBe("degraded");
    expect(body.schemaR1a).toMatchObject({ ok: false, trangThai: "thieu", thieuMigration: ["0431", "0432"] });
  });

  it("mặc định (không truyền datNhac): setInterval THẬT mỗi CHU_KY_NHAC_MS, unref, tự dừng khi kiểm được — dùng layChay (kết nối mới)", async () => {
    vi.useFakeTimers();
    const { chay, st } = chayHong();
    let laiChay: typeof chay | null = null; // DB chưa có lúc boot
    const layChay = vi.fn(async () => laiChay);
    await khoiDongOtCoKiemSchema({ chay: null, startOt: vi.fn(async () => undefined), logLoi: vi.fn(), layChay });
    expect(trangThaiSchemaR1a()).toMatchObject({ kieu: "khong_kiem_duoc", loi: "không có kết nối DB", loai: "khong_co_ket_noi_db" });
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(CHU_KY_NHAC_MS);
    expect(layChay).toHaveBeenCalledTimes(1);
    expect(trangThaiSchemaR1a().kieu).toBe("khong_kiem_duoc"); // vẫn chưa có kết nối
    laiChay = chay;
    st.ok = true;
    await vi.advanceTimersByTimeAsync(CHU_KY_NHAC_MS);
    expect(trangThaiSchemaR1a().kieu).toBe("da_kiem");
    expect(vi.getTimerCount()).toBe(0); // dừng hẳn
    await vi.advanceTimersByTimeAsync(CHU_KY_NHAC_MS * 3);
    expect(layChay).toHaveBeenCalledTimes(2);
  });
});

describe("/health (route THẬT — `/api/health` là SPA catch-all) mang lý do schema", () => {
  async function goiHealth(): Promise<{ status: number; body: Record<string, unknown> }> {
    const app = express();
    app.get("/health", createHealthHandler({ pinger: { ping: async () => ({ ok: true, ms: 1 }) } as never }));
    const srv = app.listen(0);
    try {
      const port = (srv.address() as AddressInfo).port;
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      return { status: r.status, body: (await r.json()) as Record<string, unknown> };
    } finally {
      srv.close();
    }
  }
  it("chưa kiểm / đủ ⇒ status ok, không có schemaR1a", async () => {
    expect((await goiHealth()).body).toMatchObject({ status: "ok" });
    __datTrangThaiSchemaR1a({ kieu: "da_kiem", luc: "x", thieu0431: [], thieu0432: [], thieu0433: [] });
    const r = await goiHealth();
    expect(r.body.status).toBe("ok");
    expect(r.body.schemaR1a).toBeUndefined();
  });
  it("thiếu 0431 ⇒ 200 (liveness — khởi động lại không chữa được migration) nhưng status degraded + schemaR1a nói rõ", async () => {
    __datTrangThaiSchemaR1a({ kieu: "da_kiem", luc: "x", thieu0431: ["device_tags.write_min"], thieu0432: ["totp_khoa_sai"], thieu0433: [] });
    const r = await goiHealth();
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("degraded");
    expect(r.body.schemaR1a).toMatchObject({ ok: false, trangThai: "thieu", thieuMigration: ["0431", "0432"] });
    expect(String((r.body.schemaR1a as { lyDo: string }).lyDo)).toContain("thiếu migration 0431");
  });
  it("★ rà soát cuối M-7 — một hình dạng: thiếu và không biết đều là ĐỐI TƯỢNG có ok:false + trangThai; không biết KHÔNG nhầm thành khoẻ", async () => {
    const hinh = (v: unknown) => (v && typeof v === "object" ? Object.keys(v as object).sort() : typeof v);
    __datTrangThaiSchemaR1a({ kieu: "da_kiem", luc: "x", thieu0431: [], thieu0432: [], thieu0433: ["scada_command_attempts.ly_do"] });
    const thieu = (await goiHealth()).body;
    __datTrangThaiSchemaR1a({ kieu: "khong_kiem_duoc", loi: "connect ECONNREFUSED 10.0.0.1:5434", loai: "ket_noi_tu_choi" });
    const khongBiet = (await goiHealth()).body;
    expect(hinh(thieu.schemaR1a)).toEqual(["lyDo", "ok", "thieuMigration", "trangThai"]);
    expect(hinh(khongBiet.schemaR1a)).toEqual(hinh(thieu.schemaR1a));
    expect((khongBiet.schemaR1a as { ok: boolean }).ok).toBe(false);
    expect((khongBiet.schemaR1a as { trangThai: string }).trangThai).toBe("chua_kiem_duoc");
    expect((khongBiet.schemaR1a as { thieuMigration: unknown }).thieuMigration).toBeNull();
    expect(khongBiet.status).toBe("ok"); // T10: không biết ≠ thiếu
    expect(Object.keys(khongBiet).filter((k) => k.startsWith("schemaR1a"))).toEqual(["schemaR1a"]);
  });
  it("★ R1b-1 T7 — thiếu 0433 ⇒ 200 nhưng status degraded + schemaR1a.thieuMigration có 0433 (cùng cách báo như 0431)", async () => {
    __datTrangThaiSchemaR1a({ kieu: "da_kiem", luc: "x", thieu0431: [], thieu0432: [], thieu0433: ["scada_command_attempts.ly_do"] });
    const r = await goiHealth();
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("degraded");
    expect(r.body.schemaR1a).toMatchObject({ ok: false, trangThai: "thieu", thieuMigration: ["0433"] });
    expect(String((r.body.schemaR1a as { lyDo: string }).lyDo)).toContain("thiếu migration 0433");
    expect(String((r.body.schemaR1a as { lyDo: string }).lyDo)).toContain("scada_command_attempts.ly_do");
  });
});

describe("TOTP_KHONG_KIEM_DUOC mang nguyên nhân 'thiếu migration 0432' trong log", () => {
  it("lỗi 42P01 / 42703 (lồng trong cause) ⇒ câu nguyên nhân gọi tên 0432", () => {
    expect(nguyenNhanBoDemHong(Object.assign(new Error("relation \"totp_khoa_sai\" does not exist"), { code: "42P01" }))).toContain("thiếu migration 0432");
    expect(nguyenNhanBoDemHong(new Error("wrap", { cause: { code: "42703", message: "column loai does not exist" } }))).toContain("thiếu migration 0432");
  });
  it("tiến trình đã thấy thiếu 0432 lúc khởi động ⇒ mọi lỗi bộ đếm đều gắn nguyên nhân", () => {
    __datTrangThaiSchemaR1a({ kieu: "da_kiem", luc: "x", thieu0431: [], thieu0432: ["totp_khoa_sai"], thieu0433: [] });
    expect(nguyenNhanBoDemHong(new Error("timeout"))).toContain("thiếu migration 0432");
  });
  it("lỗi khác (DB treo) ⇒ chỉ thông điệp gốc, không đổ oan cho migration", () => {
    const c = nguyenNhanBoDemHong(new Error("connection terminated"));
    expect(c).toContain("connection terminated");
    expect(c).not.toContain("0432");
  });
});
