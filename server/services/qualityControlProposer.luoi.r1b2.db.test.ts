/**
 * SCADA R1b-2a T1 (Review Focus 4) — bộ đề xuất SPI của AI thị giác làm tròn theo LƯỚI GHI của tag đích THẬT (đọc `device_tags` trên đúng
 * adapter mà `spi_printer_offset` sẽ ghi — `visionControl.adapterIdForMachine`), và chính đề xuất ấy qua cổng kênh sớm của `dispatch()`.
 *
 * CSDL `_test` THẬT: máy tổng hợp (id cố định, không hàng `machines` — khuôn commandDispatcher.kenh.r1a.db.test.ts) + adapter + `printer_offset_x`
 * (int, scale 1) + `printer_offset_y` (int, scale 10). `VISION_CONTROL_ENABLED=true` CHỈ trong tiến trình test; `deps.propose` ghi lại (không tạo
 * hàng ai_pending_actions, không gọi dispatch / driver). `layLuoiTagSpi` KHÔNG được tiêm ⇒ chạy bản mặc định của sản phẩm.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { deviceAdapters, deviceTags } from "../../drizzle/schema";
import { getDb } from "../db/connection";
import { congKenhSom, type TagCongKenh } from "./ot/commandDispatcher";
import { proposeControlFromVerdict, type ProposeControlDeps } from "./qualityControlProposer";

const DB_URL = process.env.DATABASE_URL;
const DAU = `QCPR1B2-${process.pid}-${Date.now()}`;
const MAY = 990_543_001;

let adapterId = 0;
let savedFlag: string | undefined;

async function d() {
  const x = await getDb();
  if (!x) throw new Error("no db");
  return x;
}

const spiTool = { name: "spi_printer_offset", kind: "write" as const, requiredPermission: { module: "machine_control", action: "canEdit" as const } };

function taoDeps(goi: Array<Record<string, unknown>>): ProposeControlDeps {
  return {
    propose: (async (_tool: unknown, args: Record<string, unknown>) => {
      goi.push(args);
      return { ok: true, pendingAction: { actionId: `${DAU}-a${goi.length}` } };
    }) as never,
    findTargets: async () => [{ id: 1, role: "maintenance", name: "Tech" }],
    getToolByName: (n) => (n === "spi_printer_offset" ? (spiTool as never) : undefined),
    resolveFactory: async () => null,
  };
}

/** Xu hướng cho hiệu chỉnh −7,26 µm (X) / −12,6 µm (Y) với gain 1 (hiệu chỉnh = −trung bình). */
const INPUT = {
  verdict: { decision: "AUTO_NG", confidence: 0.92, topLabel: "bridging" },
  inspectionId: 1,
  machineId: MAY,
  spiTrend: [{ offsetXUm: 7.26, offsetYUm: 12.6 }],
  spiOpts: { gain: 1 },
};

describe.skipIf(!DB_URL || !/_test\b/.test(DB_URL ?? ""))("R1b-2a T1 — đề xuất SPI theo lưới tag THẬT trong _test (Review Focus 4)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/); // cầu chì: không bao giờ chạy trên DB dev
    savedFlag = process.env.VISION_CONTROL_ENABLED;
    const x = await d();
    // Dọn adapter mồ côi của lượt trước bị ngắt (máy tổng hợp cố định).
    const cu = await x.select({ id: deviceAdapters.id }).from(deviceAdapters).where(eq(deviceAdapters.machineId, MAY));
    for (const a of cu) {
      await x.delete(deviceTags).where(eq(deviceTags.adapterId, a.id));
      await x.delete(deviceAdapters).where(eq(deviceAdapters.id, a.id));
    }
    const [a] = await x
      .insert(deviceAdapters)
      .values({ code: `${DAU}-A`, name: `${DAU} adapter`, protocol: "stub", endpoint: "stub://qcp-r1b2", isEnabled: false, machineId: MAY })
      .returning();
    adapterId = a!.id;
  }, 60_000);

  beforeEach(async () => {
    process.env.VISION_CONTROL_ENABLED = "true";
    const x = await d();
    await x.delete(deviceTags).where(eq(deviceTags.adapterId, adapterId));
    await x.insert(deviceTags).values([
      { adapterId, tagKey: "printer_offset_x", address: "D300", dataType: "int", writable: true, scale: "1" },
      { adapterId, tagKey: "printer_offset_y", address: "D301", dataType: "int", writable: true, scale: "10" },
    ]);
  });

  afterAll(async () => {
    if (savedFlag === undefined) delete process.env.VISION_CONTROL_ENABLED;
    else process.env.VISION_CONTROL_ENABLED = savedFlag;
    const x = await d();
    if (adapterId) {
      await x.delete(deviceTags).where(eq(deviceTags.adapterId, adapterId));
      await x.delete(deviceAdapters).where(eq(deviceAdapters.id, adapterId));
    }
  }, 60_000);

  it("★ −7,26 / −12,6 ⇒ args offsetXUm −7 (int scale 1), offsetYUm −10 (int scale 10); đúng đề xuất ấy qua congKenhSom với hàng tag THẬT ⇒ ok", async () => {
    const goi: Array<Record<string, unknown>> = [];
    const res = await proposeControlFromVerdict(INPUT, taoDeps(goi));
    expect(res.proposed).toBe(1);
    expect(goi).toHaveLength(1);
    expect(goi[0]!.offsetXUm).toBe(-7);
    expect(goi[0]!.offsetYUm).toBe(-10);
    expect(res.proposals.find((p) => p.kind === "spi_printer_offset")!.rationale).not.toContain("chưa đọc được lưới tag");

    const hang = (await (await d())
      .select()
      .from(deviceTags)
      .where(and(eq(deviceTags.adapterId, adapterId), inArray(deviceTags.tagKey, ["printer_offset_x", "printer_offset_y"])))) as TagCongKenh[];
    const theo = new Map(hang.map((h) => [h.tagKey, h]));
    const writes = [
      { tagKey: "printer_offset_x", value: goi[0]!.offsetXUm },
      { tagKey: "printer_offset_y", value: goi[0]!.offsetYUm },
    ];
    const kq = congKenhSom("spi_printer_offset", writes, writes.map((w) => theo.get(w.tagKey)!));
    expect(kq.ok).toBe(true);
    // đối chứng: giá trị roundDp cũ (−7,3 / −12,6) bị chính cổng ấy từ chối OFF_STEP — đó là lỗ Review Focus 4
    const cu = congKenhSom("spi_printer_offset", [{ tagKey: "printer_offset_x", value: -7.3 }, { tagKey: "printer_offset_y", value: -12.6 }], [theo.get("printer_offset_x")!, theo.get("printer_offset_y")!]);
    expect(cu).toMatchObject({ ok: false, ma: "OFF_STEP", tagKey: "printer_offset_x", goiY: -7 });
  });

  it("★ R1b-2a T2 (M7 + m5) — tag ĐÃ khai: X int scale 1 dải −5..5 ⇒ −5 (không phải −7: dải); Y int scale 0,5 bước 2,5 dải −30..30 ⇒ −12,5 (không nguyên, đúng lưới thô + bước); congKenhSom với hàng THẬT ⇒ ok", async () => {
    const x = await d();
    await x.update(deviceTags).set({ channelKind: "output", writeMin: -5, writeMax: 5 }).where(and(eq(deviceTags.adapterId, adapterId), eq(deviceTags.tagKey, "printer_offset_x")));
    await x
      .update(deviceTags)
      .set({ channelKind: "output", writeMin: -30, writeMax: 30, writeStep: 2.5, scale: "0.5" })
      .where(and(eq(deviceTags.adapterId, adapterId), eq(deviceTags.tagKey, "printer_offset_y")));
    const goi: Array<Record<string, unknown>> = [];
    const res = await proposeControlFromVerdict(INPUT, taoDeps(goi));
    expect(res.proposed).toBe(1);
    expect(goi[0]).toMatchObject({ offsetXUm: -5, offsetYUm: -12.5 });

    const hang = (await x
      .select()
      .from(deviceTags)
      .where(and(eq(deviceTags.adapterId, adapterId), inArray(deviceTags.tagKey, ["printer_offset_x", "printer_offset_y"])))) as TagCongKenh[];
    const theo = new Map(hang.map((h) => [h.tagKey, h]));
    const writes = [
      { tagKey: "printer_offset_x", value: goi[0]!.offsetXUm },
      { tagKey: "printer_offset_y", value: goi[0]!.offsetYUm },
    ];
    expect(congKenhSom("spi_printer_offset", writes, writes.map((w) => theo.get(w.tagKey)!)).ok).toBe(true);
    // đối chứng: đề xuất kiểu T1 (chỉ lưới thô) −7 trên X bị chính cổng ấy từ chối OUT_OF_RANGE
    expect(congKenhSom("spi_printer_offset", [{ tagKey: "printer_offset_x", value: -7 }], [theo.get("printer_offset_x")!])).toMatchObject({ ok: false, ma: "OUT_OF_RANGE" });
  });

  it("R1b-2a T2 (M7) — tag ĐÃ khai mà dải ∩ ±50 µm không chứa giá trị nào ghi được ⇒ KHÔNG đề xuất spi (chỉ reject_divert)", async () => {
    const x = await d();
    await x.update(deviceTags).set({ channelKind: "output", writeMin: 60, writeMax: 100 }).where(and(eq(deviceTags.adapterId, adapterId), eq(deviceTags.tagKey, "printer_offset_x")));
    const goi: Array<Record<string, unknown>> = [];
    const res = await proposeControlFromVerdict(INPUT, taoDeps(goi));
    expect(goi).toHaveLength(0);
    expect(res.proposals.map((p) => p.kind)).not.toContain("spi_printer_offset");
  });

  it("không có tag ⇒ args theo roundDp (−7,3 / −12,6) và rationale chứa 'chưa đọc được lưới tag'; dispatch() vẫn là trọng tài cuối", async () => {
    await (await d()).delete(deviceTags).where(eq(deviceTags.adapterId, adapterId));
    const goi: Array<Record<string, unknown>> = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = await proposeControlFromVerdict(INPUT, taoDeps(goi));
      expect(res.proposed).toBe(1);
      expect(goi[0]).toMatchObject({ offsetXUm: -7.3, offsetYUm: -12.6 });
      expect(res.proposals.find((p) => p.kind === "spi_printer_offset")!.rationale).toContain("chưa đọc được lưới tag");
    } finally {
      warn.mockRestore();
    }
  });

  it("máy không có adapter ⇒ tra lỗi ⇒ roundDp + 'chưa đọc được lưới tag' (không ném)", async () => {
    const goi: Array<Record<string, unknown>> = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = await proposeControlFromVerdict({ ...INPUT, machineId: MAY + 1 }, taoDeps(goi));
      expect(goi[0]).toMatchObject({ offsetXUm: -7.3, offsetYUm: -12.6 });
      expect(res.proposals.find((p) => p.kind === "spi_printer_offset")!.rationale).toContain("chưa đọc được lưới tag");
    } finally {
      warn.mockRestore();
    }
  });
});
