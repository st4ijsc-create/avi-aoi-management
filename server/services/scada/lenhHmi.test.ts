/**
 * SCADA R1a Task 8 — `kiemCauHinhLenhHmi()` (điều phối 2026-10-24): SCADA_COMMANDS bật mà bộ đệm tắt ⇒ `logger.warn` MỘT lần mỗi
 * tiến trình; cờ tắt / bộ đệm bật ⇒ không warn. Mỗi ca nạp lại module (`vi.resetModules`) = một "tiến trình" mới.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const warn = vi.hoisted(() => vi.fn());
vi.mock("../../logger", () => ({ logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }, default: { warn } }));

async function napMoi() {
  vi.resetModules();
  return (await import("./lenhHmi")).kiemCauHinhLenhHmi;
}

beforeEach(() => warn.mockClear());
afterEach(() => vi.unstubAllEnvs());

describe("kiemCauHinhLenhHmi — kiểm khởi động", () => {
  it("SCADA_COMMANDS bật + bộ đệm tắt ⇒ gọi HAI lần chỉ MỘT lần warn, đúng câu", async () => {
    vi.stubEnv("SCADA_COMMANDS_ENABLED", "true");
    vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "false");
    const kiem = await napMoi();
    kiem();
    kiem();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(
      "SCADA_COMMANDS bật nhưng SCADA_LIVE_CACHE_ENABLED tắt — mọi máy coi như LOCAL, mọi lệnh HMI sẽ bị từ chối",
    );
  });

  it("cờ SCADA_COMMANDS tắt ⇒ không warn (kể cả bộ đệm tắt)", async () => {
    vi.stubEnv("SCADA_COMMANDS_ENABLED", "false");
    vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "false");
    const kiem = await napMoi();
    kiem();
    expect(warn).not.toHaveBeenCalled();
  });

  it("SCADA_COMMANDS bật + bộ đệm bật ⇒ không warn", async () => {
    vi.stubEnv("SCADA_COMMANDS_ENABLED", "true");
    vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "true");
    const kiem = await napMoi();
    kiem();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("kiemCongEdge — KIỂM TRƯỚC không khoá (R1b-1 T10 fix round 1, I-3)", () => {
  async function chayVoiDb(rows: Array<Record<string, unknown>>) {
    vi.resetModules();
    const { kiemCongEdge } = await import("./lenhHmi");
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const dialect = new PgDialect();
    const cau: string[] = [];
    const transaction = vi.fn();
    const db = {
      execute: vi.fn(async (q: never) => {
        cau.push(dialect.sqlToQuery(q).sql);
        return rows;
      }),
      transaction,
    };
    return { kq: await kiemCongEdge(db as never, 7), cau, transaction, db };
  }

  it("★ chỉ MỘT truy vấn đọc trần: KHÔNG FOR SHARE, KHÔNG mở giao dịch (như trước T10)", async () => {
    const { cau, transaction, db } = await chayVoiDb([]);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveBeenCalled();
    expect(cau[0]).not.toMatch(/for\s+(share|update)/i);
    expect(cau[0]).toMatch(/edgeNodeId/);
  });

  it("trung tâm sở hữu ⇒ ok; do edge sở hữu ⇒ EDGE_CHUA_HO_TRO kèm mã edge (cùng câu như trước)", async () => {
    expect((await chayVoiDb([{ edgeNodeId: null, edgeCode: null }])).kq).toEqual({ ok: true });
    expect((await chayVoiDb([])).kq).toEqual({ ok: true });
    const r = (await chayVoiDb([{ edgeNodeId: 5, edgeCode: "EDGE-A" }])).kq;
    expect(r).toEqual({
      ok: false,
      tuChoi: {
        ma: "EDGE_CHUA_HO_TRO",
        edgeCode: "EDGE-A",
        edgeNodeId: 5,
        chiTiet: "Adapter do edge EDGE-A sở hữu — HMI trung tâm chưa ra lệnh qua edge (R1c).",
      },
    });
  });
});
