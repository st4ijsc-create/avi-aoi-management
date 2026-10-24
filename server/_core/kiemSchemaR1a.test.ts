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
  trangThaiSchemaR1a,
} from "./kiemSchemaR1a";
import { createHealthHandler } from "./healthProbes";
import { nguyenNhanBoDemHong } from "./totpKhoaSai";

const dialect = new PgDialect();

/** information_schema giả: `bo` = đối tượng bị bỏ ("device_tags.write_step", "scada_khoa_chon", "totp_khoa_sai", "totp_khoa_sai.loai"). */
function gia(bo: string[] = []) {
  const cauHoi: string[] = [];
  const chay = async (q: SQL) => {
    const { sql: text } = dialect.sqlToQuery(q);
    cauHoi.push(text);
    if (/information_schema\.columns/.test(text)) {
      const ra = COT_DEVICE_TAGS_0431.map((c) => ({ table_name: "device_tags", column_name: c }));
      ra.push({ table_name: "totp_khoa_sai", column_name: "loai" } as never);
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
    expect(await kiemSchemaR1a(g.chay)).toEqual({ thieu0431: [], thieu0432: [] });
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
    __datTrangThaiSchemaR1a({ kieu: "da_kiem", luc: "x", thieu0431: [], thieu0432: [] });
    const r = await goiHealth();
    expect(r.body.status).toBe("ok");
    expect(r.body.schemaR1a).toBeUndefined();
  });
  it("thiếu 0431 ⇒ 200 (liveness — khởi động lại không chữa được migration) nhưng status degraded + schemaR1a nói rõ", async () => {
    __datTrangThaiSchemaR1a({ kieu: "da_kiem", luc: "x", thieu0431: ["device_tags.write_min"], thieu0432: ["totp_khoa_sai"] });
    const r = await goiHealth();
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("degraded");
    expect(r.body.schemaR1a).toMatchObject({ ok: false, thieuMigration: ["0431", "0432"] });
    expect(String((r.body.schemaR1a as { lyDo: string }).lyDo)).toContain("thiếu migration 0431");
  });
});

describe("TOTP_KHONG_KIEM_DUOC mang nguyên nhân 'thiếu migration 0432' trong log", () => {
  it("lỗi 42P01 / 42703 (lồng trong cause) ⇒ câu nguyên nhân gọi tên 0432", () => {
    expect(nguyenNhanBoDemHong(Object.assign(new Error("relation \"totp_khoa_sai\" does not exist"), { code: "42P01" }))).toContain("thiếu migration 0432");
    expect(nguyenNhanBoDemHong(new Error("wrap", { cause: { code: "42703", message: "column loai does not exist" } }))).toContain("thiếu migration 0432");
  });
  it("tiến trình đã thấy thiếu 0432 lúc khởi động ⇒ mọi lỗi bộ đếm đều gắn nguyên nhân", () => {
    __datTrangThaiSchemaR1a({ kieu: "da_kiem", luc: "x", thieu0431: [], thieu0432: ["totp_khoa_sai"] });
    expect(nguyenNhanBoDemHong(new Error("timeout"))).toContain("thiếu migration 0432");
  });
  it("lỗi khác (DB treo) ⇒ chỉ thông điệp gốc, không đổ oan cho migration", () => {
    const c = nguyenNhanBoDemHong(new Error("connection terminated"));
    expect(c).toContain("connection terminated");
    expect(c).not.toContain("0432");
  });
});
