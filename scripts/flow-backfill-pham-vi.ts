/**
 * Đợt 9 — BACKFILL phạm vi nhà máy cho luồng / bí mật CŨ (sau mig 0411). Quy tắc (dieu-phoi duyệt): nhà máy của NGƯỜI TẠO nếu người ấy
 * thuộc ĐÚNG MỘT nhà máy; còn lại NULL (toàn hệ thống ⇒ chỉ admin còn thấy). Luồng: người tạo = `ownerId` (vắng ⇒ `createdBy` của phiên
 * bản đầu); bí mật: `createdBy`. Mặc định CHẠY KHÔ và IN BÁO CÁO; `--ap-dung` mới ghi. Chỉ cập nhật hàng đang NULL (chạy lại vô hại).
 *   npx tsx scripts/flow-backfill-pham-vi.ts            (khô)
 *   npx tsx scripts/flow-backfill-pham-vi.ts --ap-dung
 */
import { fileURLToPath } from "node:url";

export interface BaoCaoBackfill {
  luong: { tong: number; gan: number; nullAdminHoacKhongNhaMay: number; nullNhieuNhaMay: number; nullKhongNguoiTao: number };
  biMat: { tong: number; gan: number; nullAdminHoacKhongNhaMay: number; nullNhieuNhaMay: number; nullKhongNguoiTao: number };
  apDung: boolean;
}

type Hang = { id: string; nguoi: number | null };

export async function backfillPhamVi(apDung: boolean, tienTo = ""): Promise<BaoCaoBackfill> {
  const { sql } = await import("drizzle-orm");
  const { getDb } = await import("../server/db/connection");
  const db = await getDb();
  if (!db) throw new Error("không có kết nối CSDL");
  const nhaMayCua = async (userId: number): Promise<number[]> =>
    ((await db.execute(sql`SELECT DISTINCT f.id FROM user_factory_assignments a JOIN factories f ON f.code = a."factoryCode" WHERE a."userId" = ${userId}`)) as unknown as { id: number }[]).map((r) => Number(r.id));
  const chay = async (bang: "ai_flows" | "ai_flow_credentials", hang: Hang[]) => {
    const kq = { tong: hang.length, gan: 0, nullAdminHoacKhongNhaMay: 0, nullNhieuNhaMay: 0, nullKhongNguoiTao: 0 };
    for (const h of hang) {
      if (h.nguoi === null) { kq.nullKhongNguoiTao++; continue; }
      const nm = await nhaMayCua(h.nguoi);
      if (nm.length === 1) {
        kq.gan++;
        if (apDung) await db.execute(sql`UPDATE ${sql.raw(`public.${bang}`)} SET "factoryId" = ${nm[0]} WHERE id = ${h.id} AND "factoryId" IS NULL`);
      } else if (nm.length === 0) kq.nullAdminHoacKhongNhaMay++;
      else kq.nullNhieuNhaMay++;
    }
    return kq;
  };
  const luong = (await db.execute(sql`SELECT f.id, coalesce(f."ownerId", (SELECT v."createdBy" FROM ai_flow_versions v WHERE v."flowId" = f.id ORDER BY v.version LIMIT 1)) AS nguoi
    FROM ai_flows f WHERE f."factoryId" IS NULL AND starts_with(f.id, ${tienTo}) ORDER BY f.id`)) as unknown as { id: string; nguoi: number | null }[];
  const biMat = (await db.execute(sql`SELECT c.id, c."createdBy" AS nguoi FROM ai_flow_credentials c WHERE c."factoryId" IS NULL AND starts_with(c.id, ${tienTo}) ORDER BY c.id`)) as unknown as { id: string; nguoi: number | null }[];
  return {
    luong: await chay("ai_flows", luong.map((r) => ({ id: r.id, nguoi: r.nguoi === null ? null : Number(r.nguoi) }))),
    biMat: await chay("ai_flow_credentials", biMat.map((r) => ({ id: r.id, nguoi: r.nguoi === null ? null : Number(r.nguoi) }))),
    apDung,
  };
}

export async function chayCli(argv: readonly string[], ra: (s: string) => void = (s) => process.stdout.write(`${s}\n`)): Promise<number> {
  const apDung = argv.includes("--ap-dung");
  const tienTo = argv.find((a) => a.startsWith("--tien-to="))?.slice("--tien-to=".length) ?? "";
  try {
    const kq = await backfillPhamVi(apDung, tienTo);
    ra(`chế độ: ${apDung ? "ÁP DỤNG" : "CHẠY KHÔ (thêm --ap-dung để ghi)"}`);
    for (const [ten, k] of [["Luồng", kq.luong], ["Bí mật", kq.biMat]] as const) {
      ra(`${ten}: ${k.tong} hàng chưa có nhà máy · gán nhà máy ${k.gan} · NULL (chỉ admin thấy): ${k.nullAdminHoacKhongNhaMay + k.nullNhieuNhaMay + k.nullKhongNguoiTao} [người tạo không thuộc nhà máy nào/admin ${k.nullAdminHoacKhongNhaMay} · thuộc nhiều nhà máy ${k.nullNhieuNhaMay} · không rõ người tạo ${k.nullKhongNguoiTao}]`);
    }
    return 0;
  } catch (e) {
    ra(`LỖI: ${(e as Error).message}`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void import("dotenv/config")
    .then(() => chayCli(process.argv.slice(2)))
    .then((m) => process.exit(m));
}
