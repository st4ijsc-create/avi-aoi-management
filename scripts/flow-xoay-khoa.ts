/**
 * Đợt 9.4 — CLI XOAY KHOÁ BÍ MẬT của Luồng AI. Chi tiết quy trình: `server/services/flow/biMat.RUNBOOK.md`.
 *
 *   npx tsx scripts/flow-xoay-khoa.ts --sinh-khoa          in MỘT khoá mới (base64, 32 byte) — chỉ in khoá, không đụng CSDL
 *   npx tsx scripts/flow-xoay-khoa.ts                      CHẠY KHÔ (mặc định): đếm + giải thử, không ghi
 *   npx tsx scripts/flow-xoay-khoa.ts --ap-dung            mã lại thật (một giao dịch, lùi cả lô nếu có hàng hỏng)
 *   thêm  --tien-to=erp-                                   chỉ các bí mật có id bắt đầu bằng tiền tố
 *
 * Đầu ra CHỈ có: tên CSDL (không kèm mật khẩu), số đếm, id bí mật khi lỗi. Không bao giờ in giá trị / bản mã / khoá.
 */
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

export function docThamSo(argv: readonly string[]): { sinhKhoa: boolean; apDung: boolean; tienTo?: string } {
  const tienTo = argv.find((a) => a.startsWith("--tien-to="))?.slice("--tien-to=".length);
  return { sinhKhoa: argv.includes("--sinh-khoa"), apDung: argv.includes("--ap-dung"), ...(tienTo ? { tienTo } : {}) };
}

export async function chay(argv: readonly string[], ra: (s: string) => void = (s) => process.stdout.write(`${s}\n`)): Promise<number> {
  const a = docThamSo(argv);
  if (a.sinhKhoa) {
    ra(randomBytes(32).toString("base64"));
    return 0;
  }
  const { xoayKhoaBiMat, LoiBiMat } = await import("../server/services/flow/biMat");
  const { getDb } = await import("../server/db/connection");
  const db = await getDb();
  if (!db) {
    ra("LỖI: không có kết nối CSDL.");
    return 2;
  }
  const dich = (await db.execute((await import("drizzle-orm")).sql`SELECT current_database() AS db, inet_server_port() AS port`)) as unknown as { db: string; port: number }[];
  ra(`CSDL: ${dich[0]?.db} (cổng ${dich[0]?.port}) · chế độ: ${a.apDung ? "ÁP DỤNG" : "CHẠY KHÔ (thêm --ap-dung để ghi)"}${a.tienTo ? ` · tiền tố: ${a.tienTo}` : ""}`);
  try {
    const kq = await xoayKhoaBiMat(process.env, { kho: !a.apDung, tienTo: a.tienTo });
    ra(`Tổng ${kq.tong} bí mật · cần chuyển ${kq.canChuyen} · đã chuyển ${kq.daChuyen} · phiên bản khoá đích ${kq.phienBanDen}`);
    if (a.apDung && kq.daChuyen > 0) ra("XONG. Giờ có thể bỏ AI_FLOW_KHOA_BI_MAT_CU khỏi .env (sau khi khởi động lại máy chủ bằng khoá mới).");
    if (!a.apDung && kq.canChuyen > 0) ra("Chạy khô OK — mọi hàng giải được. Chạy lại với --ap-dung để ghi.");
    return 0;
  } catch (e) {
    ra(`LỖI${e instanceof LoiBiMat ? ` (${e.code})` : ""}: ${(e as Error).message}`);
    ra("Không có thay đổi nào được ghi (giao dịch đã lùi).");
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void import("dotenv/config")
    .then(() => chay(process.argv.slice(2)))
    .then((m) => process.exit(m));
}
