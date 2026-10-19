import { sql } from "drizzle-orm";
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

// SAI (lỗi điển hình): DO UPDATE ghi ĐÈ so_lan = excluded.so_lan thay vì cộng dồn.
export const demLoi = pgTable("dem_loi", {
  ma: text("ma").primaryKey(),
  soLan: integer("so_lan").notNull().default(0),
  capNhat: timestamp("cap_nhat", { withTimezone: true }).notNull().defaultNow(),
});

export async function congDon(db: PostgresJsDatabase, ma: string, them: number): Promise<{ ma: string; soLan: number; moi: boolean }> {
  if (!Number.isInteger(them) || them <= 0) throw new RangeError("them phai la so nguyen > 0");
  const [r] = await db
    .insert(demLoi)
    .values({ ma, soLan: them })
    .onConflictDoUpdate({ target: demLoi.ma, set: { soLan: them, capNhat: sql`now()` } })
    .returning({ ma: demLoi.ma, soLan: demLoi.soLan, moi: sql<boolean>`(xmax = 0)` });
  return { ma: r.ma, soLan: r.soLan, moi: r.moi };
}
