import { afterEach, describe, expect, it, vi } from "vitest";
import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { __datTrangThaiSchemaChung, kiemSchemaChungBat, kiemSchemaChungKhiKhoiDong, schemaChoReadyz, trangThaiSchemaChung } from "./kiemSchemaChung";
import { createReadyzHandler } from "../_core/healthProbes";

const bang = pgTable("bang_thu_a", { id: serial("id").primaryKey(), ten: text("ten"), moi: text("cot_moi") });
const MODS = [{ bang }];
const dbDu = async () => [{ t: "bang_thu_a", c: "id" }, { t: "bang_thu_a", c: "ten" }, { t: "bang_thu_a", c: "cot_moi" }];
const dbThieu = async () => [{ t: "bang_thu_a", c: "id" }, { t: "bang_thu_a", c: "ten" }];

afterEach(() => __datTrangThaiSchemaChung({ kieu: "chua_kiem" }));

describe("kiểm schema chung lúc khởi động", () => {
  it("đủ cột ⇒ 'du', không log, /readyz không có khoá schema", async () => {
    const log = vi.fn();
    const t = await kiemSchemaChungKhiKhoiDong({ chay: dbDu, modules: MODS, env: {}, log });
    expect(t).toEqual({ kieu: "du", soBang: 1 });
    expect(log).not.toHaveBeenCalled();
    expect(schemaChoReadyz()).toBeNull();
  });

  it("★ thiếu cột ⇒ log ERROR nêu bang.cot + cờ 'thieu-cot'", async () => {
    const log = vi.fn();
    const t = await kiemSchemaChungKhiKhoiDong({ chay: dbThieu, modules: MODS, env: {}, log });
    expect(t).toEqual({ kieu: "thieu_cot", thieu: ["bang_thu_a.cot_moi"] });
    expect(log.mock.calls[0][0]).toContain("bang_thu_a.cot_moi");
    expect(schemaChoReadyz()).toBe("thieu-cot");
  });

  it("bảng vắng cả ⇒ 'bang.*'", async () => {
    const t = await kiemSchemaChungKhiKhoiDong({ chay: async () => [], modules: MODS, env: {}, log: () => {} });
    expect(t).toEqual({ kieu: "thieu_cot", thieu: ["bang_thu_a.*"] });
  });

  it("tắt bằng env hoặc edge ⇒ 'tat', KHÔNG chạy truy vấn", async () => {
    const chay = vi.fn(dbThieu);
    expect(await kiemSchemaChungKhiKhoiDong({ chay, modules: MODS, env: { SCHEMA_KIEM_CHUNG_ENABLED: "false" } })).toEqual({ kieu: "tat" });
    expect(await kiemSchemaChungKhiKhoiDong({ chay, modules: MODS, env: { AVI_PROCESS_ROLE: "edge" } })).toEqual({ kieu: "tat" });
    expect(chay).not.toHaveBeenCalled();
    expect(kiemSchemaChungBat({})).toBe(true);
  });

  it("không có DB ⇒ 'khong_kiem_duoc'; truy vấn ném ⇒ cũng vậy, không ném ra ngoài", async () => {
    expect(await kiemSchemaChungKhiKhoiDong({ chay: null, modules: MODS, env: {} })).toEqual({ kieu: "khong_kiem_duoc" });
    const loi = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await kiemSchemaChungKhiKhoiDong({ chay: async () => { throw new Error("boom"); }, modules: MODS, env: {} })).toEqual({ kieu: "khong_kiem_duoc" });
    loi.mockRestore();
    expect(trangThaiSchemaChung().kieu).toBe("khong_kiem_duoc");
    expect(schemaChoReadyz()).toBeNull();
  });
});

describe("/readyz mang cờ schema nhưng KHÔNG đổi mã HTTP và không lộ tên", () => {
  async function goi(schemaChung: () => "thieu-cot" | null) {
    const h = createReadyzHandler({ pinger: { ping: async () => ({ ok: true, ms: 1 }) } as never, checkBroker: async () => null, schemaChung });
    let code = 0; let body: Record<string, unknown> = {};
    await h({} as never, { setHeader() {}, status(c: number) { code = c; return this; }, json(b: Record<string, unknown>) { body = b; } } as never);
    return { code, body };
  }
  it("thiếu cột ⇒ 200 + schema:'thieu-cot'", async () => {
    const { code, body } = await goi(() => "thieu-cot");
    expect(code).toBe(200);
    expect(body.schema).toBe("thieu-cot");
    expect(JSON.stringify(body)).not.toContain("bang_thu");
  });
  it("đủ ⇒ không có khoá schema", async () => {
    const { body } = await goi(() => null);
    expect("schema" in body).toBe(false);
  });
});
