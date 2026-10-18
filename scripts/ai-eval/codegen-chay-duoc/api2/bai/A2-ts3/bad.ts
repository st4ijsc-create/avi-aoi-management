import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { doublePrecision, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

// SAI (lỗi điển hình): count(*) qua sql`` KHÔNG mapWith(Number) ⇒ PostgreSQL bigint về thành CHUỖI "3".
export const doKiem = pgTable("do_kiem", {
  id: serial("id").primaryKey(),
  may: text("may").notNull(),
  ketQua: text("ket_qua").notNull(),
  luc: timestamp("luc", { withTimezone: true }).notNull(),
  giaTri: doublePrecision("gia_tri"),
});

export async function demLoiTheoMay(db: PostgresJsDatabase, cacMay: string[], tu: Date): Promise<{ may: string; soLoi: number }[]> {
  if (cacMay.length === 0) return [];
  const soLoi = sql<number>`count(*)`;
  return db
    .select({ may: doKiem.may, soLoi })
    .from(doKiem)
    .where(and(inArray(doKiem.may, cacMay), eq(doKiem.ketQua, "NG"), gte(doKiem.luc, tu)))
    .groupBy(doKiem.may)
    .orderBy(desc(soLoi), asc(doKiem.may));
}
