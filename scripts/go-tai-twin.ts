#!/usr/bin/env tsx
/**
 * ============================================================================
 * GỠ TẢI TWIN — xoá SẠCH mọi hàng do `sinh-tai-twin.ts` tạo ra
 * ============================================================================
 *
 *   npx tsx scripts/go-tai-twin.ts --kho          # CHỈ ĐO, không xoá
 *   npx tsx scripts/go-tai-twin.ts                # xoá thật
 *   npx tsx scripts/go-tai-twin.ts --tien-to=X    # đổi tiền tố (mặc định cả hai)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO SCRIPT NÀY ĐƯỢC VIẾT TRƯỚC SCRIPT SINH
 * ════════════════════════════════════════════════════════════════════════════
 * Lô E sinh ~4 nhà máy × 3 tầng × 6 line × 20–40 máy ≈ 1.500–2.000 hàng vào một
 * CSDL có dữ liệu thật (2 nhà máy, 43 máy, 82 hàng `twin_dat_cho`). Nếu phép gỡ
 * không sạch, dữ liệu tải trộn vĩnh viễn vào dữ liệu thật và KHÔNG cách nào tách
 * ra được nữa — vì `twin_dat_cho` không có cột nào nói "hàng này là tải thử".
 *
 * Nên trình tự bắt buộc: viết GỠ → sinh MỘT nhà máy nhỏ → gỡ → đếm lại → mọi con
 * số về đúng ban đầu → MỚI được sinh khối lớn. Xem `--kho` để chạy khô.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ NHẬN DẠNG BẰNG MÃ, KHÔNG BẰNG ENUM `nguon`
 * ════════════════════════════════════════════════════════════════════════════
 * `twinnguonenum` chỉ có `sinh` | `tay` — đo được:
 *     SELECT unnest(enum_range(NULL::twinnguonenum));  →  sinh, tay
 * KHÔNG có giá trị nào nghĩa "tải thử", và thêm giá trị enum là đổi lược đồ
 * (ngoài phạm vi được duyệt). Dùng `nguon='sinh'` để nhận dạng thì sẽ XOÁ NHẦM
 * 82 hàng `sinh` có thật của SIM-FAC — đúng lớp tai nạn mà lệnh cấm nhắm tới.
 *
 * Nên khoá nhận dạng là **mã nhà máy**: `factories.code LIKE 'FUYU-F%'` hoặc
 * `LIKE 'TAI-%'`. Mọi hàng con truy ngược lên nhà máy qua chuỗi phân cấp; hàng
 * nào KHÔNG truy được lên một nhà máy mang tiền tố thì KHÔNG bị chạm.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ THỨ TỰ XOÁ = NGƯỢC THỨ TỰ TẠO (không có ON DELETE CASCADE)
 * ════════════════════════════════════════════════════════════════════════════
 *   twin_dat_cho → twin_vat_the → twin_ban_ghi → twin_tang → twin_toa_nha
 *   → machines → stations → production_lines → workshops → factories
 *
 * `twin_dat_cho.thucTheId` là ĐA HÌNH, KHÔNG có khoá ngoại (xem docblock
 * `drizzle/schema/twin3d.ts`). DB sẽ KHÔNG chặn ta nếu xoá máy mà quên hàng
 * đặt-chỗ của nó — hàng đó thành MỒ CÔI và không truy vết được nữa. Đó là lý do
 * bước đếm mồ côi ở cuối là bắt buộc, không phải trang trí.
 */
import postgres from "postgres";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const CHI_DO = args.includes("--kho") || args.includes("--dry-run");
const argTienTo = args.find((a) => a.startsWith("--tien-to="));

/**
 * Tiền tố mã nhà máy được phép gỡ. MẶC ĐỊNH chỉ hai họ do lô E sinh ra.
 * `SIM-FAC` và `T12-SHOT-FA-…` KHÔNG khớp bất kỳ tiền tố nào ⇒ bất khả xâm phạm.
 */
export const TIEN_TO_MAC_DINH: readonly string[] = Object.freeze(["FUYU-F", "TAI-"]);

/**
 * Mã nhà máy CẤM chạm, kể cả khi ai đó truyền `--tien-to` rộng.
 * Đây là cầu chì thứ hai — vành đai chứ không phải lời hứa.
 */
export const MA_CAM_CHAM: readonly string[] = Object.freeze(["SIM-FAC"]);

/** Cầu chì: một tiền tố quá rộng (rỗng, `%`, `-`) sẽ quét cả CSDL ⇒ chặn. */
export function tienToHopLe(t: string): boolean {
  return t.length >= 4 && !t.includes("%") && !t.includes("_");
}

function napEnv(p: string): void {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}
napEnv(path.join(__dirname, "..", ".env"));

/** `avi_app` là vai WORM — KHÔNG xoá được bảng twin. Ép owner `aoi`, cùng khuôn seed. */
function urlOwner(): string {
  if (process.env.MIGRATION_DB_URL) return process.env.MIGRATION_DB_URL;
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    console.error("LOI: DATABASE_URL chua dat.");
    process.exit(1);
  }
  const u = new URL(raw);
  u.username = process.env.MIGRATION_DB_USER ?? "aoi";
  u.password = process.env.MIGRATION_DB_PASSWORD ?? "aoi";
  return u.toString();
}

const tienTos = argTienTo
  ? argTienTo.slice("--tien-to=".length).split(",").map((s) => s.trim()).filter(Boolean)
  : [...TIEN_TO_MAC_DINH];

for (const t of tienTos) {
  if (!tienToHopLe(t)) {
    console.error(`LOI: tien to "${t}" qua rong (>=4 ky tu, khong chua % hoac _). Dung.`);
    process.exit(1);
  }
}

const sql = postgres(urlOwner(), { max: 1, connect_timeout: 30 });

function tieuDe(s: string): void {
  console.log("");
  console.log("=".repeat(74));
  console.log("  " + s);
  console.log("=".repeat(74));
}

async function main(): Promise<void> {
  tieuDe("GO TAI TWIN" + (CHI_DO ? "   [--kho: CHI DO, KHONG XOA]" : ""));
  const [{ nguoiDung, csdl }] = await sql<{ nguoiDung: string; csdl: string }[]>`
    SELECT current_user AS "nguoiDung", current_database() AS "csdl"
  `;
  console.log(`  Vai: ${nguoiDung}   CSDL: ${csdl}`);
  console.log(`  Tien to: ${tienTos.join(", ")}`);

  // ── B1. Tìm nhà máy khớp tiền tố ─────────────────────────────────────────
  const likes = tienTos.map((t) => `${t}%`);
  const nhaMays = await sql<{ id: number; code: string }[]>`
    SELECT id, code FROM factories
     WHERE code LIKE ANY(${likes})
       AND code <> ALL(${[...MA_CAM_CHAM]})
     ORDER BY code, id
  `;
  if (nhaMays.length === 0) {
    console.log("\n  Khong co nha may nao khop tien to. Khong co gi de go.");
    await sql.end();
    return;
  }
  const fIds = nhaMays.map((f) => f.id);
  console.log(`\n  Nha may khop (${nhaMays.length}): ${nhaMays.map((f) => `${f.code}#${f.id}`).join(", ")}`);

  // ── B2. Truy xuống toàn cây, TRƯỚC khi xoá gì ────────────────────────────
  // Đọc ID từng cấp thay vì lồng subquery trong DELETE: sau khi xoá cấp cha thì
  // subquery không tìm lại được cấp con nữa (mồ côi câm). Đây là lý do phải
  // "chụp ảnh" toàn bộ ID trước.
  const wsIds = (
    await sql<{ id: number }[]>`SELECT id FROM workshops WHERE "factoryId" = ANY(${fIds}) ORDER BY id`
  ).map((r) => r.id);
  const plIds = wsIds.length
    ? (await sql<{ id: number }[]>`SELECT id FROM production_lines WHERE "workshopId" = ANY(${wsIds}) ORDER BY id`).map((r) => r.id)
    : [];
  const stIds = plIds.length
    ? (await sql<{ id: number }[]>`SELECT id FROM stations WHERE "lineId" = ANY(${plIds}) ORDER BY id`).map((r) => r.id)
    : [];
  const mIds = stIds.length
    ? (await sql<{ id: number }[]>`SELECT id FROM machines WHERE "stationId" = ANY(${stIds}) ORDER BY id`).map((r) => r.id)
    : [];
  const tnIds = (
    await sql<{ id: number }[]>`SELECT id FROM twin_toa_nha WHERE "factoryId" = ANY(${fIds}) ORDER BY id`
  ).map((r) => r.id);
  const tgIds = tnIds.length
    ? (await sql<{ id: number }[]>`SELECT id FROM twin_tang WHERE "toaNhaId" = ANY(${tnIds}) ORDER BY id`).map((r) => r.id)
    : [];

  console.log(
    `  Cay: workshops=${wsIds.length} lines=${plIds.length} stations=${stIds.length} ` +
      `machines=${mIds.length} toa_nha=${tnIds.length} tang=${tgIds.length}`,
  );

  // ── B3. Đếm hàng twin_dat_cho sẽ xoá — HAI ĐƯỜNG RỜI NHAU (BG-127) ───────
  // Đường 1: theo `tangId` (hàng nằm trên tầng của nhà máy này).
  // Đường 2: theo `(loaiThucThe, thucTheId)` (hàng nói VỀ thực thể của nhà máy này).
  // Hai đường phải cho cùng tập; lệch nghĩa là có hàng đặt-chỗ trỏ chéo nhà máy
  // — một lỗi dữ liệu thật, phải biết TRƯỚC khi xoá chứ không phải sau.
  const dcTheoTang = tgIds.length
    ? (await sql<{ id: number }[]>`SELECT id FROM twin_dat_cho WHERE "tangId" = ANY(${tgIds}) ORDER BY id`).map((r) => r.id)
    : [];
  const dcTheoThucThe: number[] = [];
  if (mIds.length) {
    for (const r of await sql<{ id: number }[]>`
      SELECT id FROM twin_dat_cho WHERE "loaiThucThe" = 'machine' AND "thucTheId" = ANY(${mIds}) ORDER BY id
    `) dcTheoThucThe.push(r.id);
  }
  if (stIds.length) {
    for (const r of await sql<{ id: number }[]>`
      SELECT id FROM twin_dat_cho WHERE "loaiThucThe" = 'station' AND "thucTheId" = ANY(${stIds}) ORDER BY id
    `) dcTheoThucThe.push(r.id);
  }
  if (plIds.length) {
    for (const r of await sql<{ id: number }[]>`
      SELECT id FROM twin_dat_cho WHERE "loaiThucThe" = 'line' AND "thucTheId" = ANY(${plIds}) ORDER BY id
    `) dcTheoThucThe.push(r.id);
  }
  if (wsIds.length) {
    for (const r of await sql<{ id: number }[]>`
      SELECT id FROM twin_dat_cho WHERE "loaiThucThe" = 'workshop' AND "thucTheId" = ANY(${wsIds}) ORDER BY id
    `) dcTheoThucThe.push(r.id);
  }
  const setTang = new Set(dcTheoTang);
  const setTt = new Set(dcTheoThucThe);
  const chiTang = dcTheoTang.filter((i) => !setTt.has(i));
  const chiTt = dcTheoThucThe.filter((i) => !setTang.has(i));
  console.log(
    `  twin_dat_cho: theo tang=${dcTheoTang.length}  theo thuc the=${dcTheoThucThe.length}` +
      `  chi-tang=${chiTang.length}  chi-thuc-the=${chiTt.length}`,
  );
  if (chiTt.length > 0) {
    // Hàng nói về thực thể của ta nhưng nằm trên tầng NGƯỜI KHÁC. Xoá nó là
    // chạm dữ liệu ngoài phạm vi ⇒ dừng và bắt người đọc quyết định.
    console.error(
      `LOI: ${chiTt.length} hang twin_dat_cho tro vao thuc the cua nha may nay nhung nam tren TANG KHAC.` +
        ` ID: ${chiTt.slice(0, 20).join(",")}. Dung — can nguoi quyet dinh.`,
    );
    await sql.end();
    process.exit(1);
  }

  const dcIds = dcTheoTang;
  const vtCount = tgIds.length
    ? Number((await sql<{ n: string }[]>`SELECT count(*)::text n FROM twin_vat_the WHERE "tangId" = ANY(${tgIds})`)[0].n)
    : 0;
  const bgCount = tgIds.length
    ? Number((await sql<{ n: string }[]>`SELECT count(*)::text n FROM twin_ban_ghi WHERE "tangId" = ANY(${tgIds})`)[0].n)
    : 0;

  console.log(`  twin_vat_the=${vtCount}  twin_ban_ghi=${bgCount}  twin_dat_cho=${dcIds.length}`);

  if (CHI_DO) {
    console.log("\n  [--kho] KHONG xoa gi. Dung.");
    await sql.end();
    return;
  }

  // ── B4. Xoá trong MỘT giao dịch, ngược thứ tự tạo ────────────────────────
  const xoa: Record<string, number> = {};
  await sql.begin(async (tx) => {
    if (dcIds.length) xoa.twin_dat_cho = (await tx`DELETE FROM twin_dat_cho WHERE id = ANY(${dcIds})`).count;
    if (tgIds.length) {
      xoa.twin_vat_the = (await tx`DELETE FROM twin_vat_the WHERE "tangId" = ANY(${tgIds})`).count;
      xoa.twin_ban_ghi = (await tx`DELETE FROM twin_ban_ghi WHERE "tangId" = ANY(${tgIds})`).count;
      xoa.twin_tang = (await tx`DELETE FROM twin_tang WHERE id = ANY(${tgIds})`).count;
    }
    if (tnIds.length) xoa.twin_toa_nha = (await tx`DELETE FROM twin_toa_nha WHERE id = ANY(${tnIds})`).count;
    if (mIds.length) xoa.machines = (await tx`DELETE FROM machines WHERE id = ANY(${mIds})`).count;
    if (stIds.length) xoa.stations = (await tx`DELETE FROM stations WHERE id = ANY(${stIds})`).count;
    if (plIds.length) xoa.production_lines = (await tx`DELETE FROM production_lines WHERE id = ANY(${plIds})`).count;
    if (wsIds.length) xoa.workshops = (await tx`DELETE FROM workshops WHERE id = ANY(${wsIds})`).count;
    xoa.factories = (await tx`DELETE FROM factories WHERE id = ANY(${fIds})`).count;
  });

  console.log("\n  DA XOA:");
  for (const [k, v] of Object.entries(xoa)) console.log(`    ${k.padEnd(18)} ${v}`);

  // ── B5. Cầu chì mồ côi: hàng đặt-chỗ trỏ vào máy/trạm KHÔNG còn tồn tại ──
  // `thucTheId` đa hình, không FK ⇒ DB không tự bắt. Nếu số này > 0 sau khi gỡ,
  // phép gỡ KHÔNG sạch và phải nói thẳng.
  const [{ n: moCoiMay }] = await sql<{ n: string }[]>`
    SELECT count(*)::text n FROM twin_dat_cho d
     WHERE d."loaiThucThe" = 'machine'
       AND NOT EXISTS (SELECT 1 FROM machines m WHERE m.id = d."thucTheId")
  `;
  const [{ n: moCoiTang }] = await sql<{ n: string }[]>`
    SELECT count(*)::text n FROM twin_dat_cho d
     WHERE NOT EXISTS (SELECT 1 FROM twin_tang t WHERE t.id = d."tangId")
  `;
  console.log(`\n  Cau chi mo coi: dat_cho tro vao may da xoa = ${moCoiMay}; tro vao tang da xoa = ${moCoiTang}`);
  if (Number(moCoiMay) > 0 || Number(moCoiTang) > 0) {
    console.error("LOI: go KHONG sach — con hang mo coi. Xem so tren.");
    process.exitCode = 1;
  }

  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await sql.end();
  } catch {
    /* đã đóng */
  }
  process.exit(1);
});
