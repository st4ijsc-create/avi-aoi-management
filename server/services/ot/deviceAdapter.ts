/**
 * Sprint F1.1 — Build runtime adapters từ cấu hình DB.
 *
 * Đọc `deviceAdapters` (isEnabled) + `deviceTags` (isEnabled) qua lazy getDb(),
 * dựng đối tượng runtime kèm driver tạo từ registry. KHÔNG mở kết nối ở đây —
 * otManager chịu trách nhiệm connect/subscribe.
 */
import { createDriver } from "./driverRegistry";
import type { OtDriver, OtProtocol, OtConnectionConfig, OtTagAddress } from "./otDriver";

/** Một adapter đã giải nghĩa, sẵn sàng để connect/subscribe. */
export interface RuntimeAdapter {
  adapterId: number;
  code: string;
  machineId: number | null;
  protocol: OtProtocol;
  connection: OtConnectionConfig;
  pollIntervalMs: number;
  tags: OtTagAddress[];
  driver: OtDriver;
}

/**
 * Tải mọi adapter đang bật cùng tag đang bật của chúng. Trả [] nếu không có DB.
 */
export async function loadEnabledAdapters(): Promise<RuntimeAdapter[]> {
  const { getDb } = await import("../../db/connection");
  const db = await getDb();
  if (!db) return [];

  const { deviceAdapters, deviceTags } = await import("../../../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  const adapters = await db.select().from(deviceAdapters).where(eq(deviceAdapters.isEnabled, true));
  if (adapters.length === 0) return [];

  const runtime: RuntimeAdapter[] = [];
  for (const a of adapters) {
    const tagRows = await db
      .select()
      .from(deviceTags)
      .where(eq(deviceTags.adapterId, a.id));

    const tags: OtTagAddress[] = tagRows
      .filter((t) => t.isEnabled)
      .map((t) => ({
        tagKey: t.tagKey,
        address: t.address,
        dataType: t.dataType,
        scale: t.scale != null ? Number(t.scale) : undefined,
        offset: t.offset != null ? Number(t.offset) : undefined,
        unit: t.unit ?? undefined,
        writable: t.writable,
      }));

    const protocol = a.protocol as OtProtocol;
    runtime.push({
      adapterId: a.id,
      code: a.code,
      machineId: a.machineId ?? null,
      protocol,
      connection: {
        endpoint: a.endpoint,
        options: (a.connectionOptions as Record<string, unknown> | null) ?? undefined,
        timeoutMs: undefined,
      },
      pollIntervalMs: a.pollIntervalMs ?? 5000,
      tags,
      driver: createDriver(protocol),
    });
  }

  return runtime;
}
