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
export const TIEN_TO_MAC_DINH: readonly string[] = Object.freeze(["FUYU-F", "FUYU-G", "TAI-"]);

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

  // Đếm dữ liệu VẬN HÀNH sẽ xoá — in ra kể cả ở `--kho`, để chạy khô nói được
  // đầy đủ hậu quả chứ không chỉ phần hình học.
  async function dem(bang: string, cot: string, ids: number[]): Promise<number> {
    if (!ids.length) return 0;
    const [r] = await sql.unsafe<{ n: string }[]>(
      `SELECT count(*)::text n FROM ${bang} WHERE "${cot}" = ANY($1)`,
      [ids as never],
    );
    return Number(r.n);
  }
  const vanHanh = {
    wip_tracking: await dem("wip_tracking", "currentStationId", stIds),
    product_inspections: await dem("product_inspections", "machineId", mIds),
    machine_health_history: await dem("machine_health_history", "machineId", mIds),
    machine_heartbeats: await dem("machine_heartbeats", "machineId", mIds),
    andon_events: await dem("andon_events", "lineId", plIds),
    line_balance_metrics: await dem("line_balance_metrics", "lineId", plIds),
    // ★ ĐỢT 15 LÔ R — `station_dwell_time` (lô S đo được 48 hàng mồ côi sau một
    //   lượt gỡ). Đếm theo `machineId`, KHÔNG theo `stationId`: xem docblock ở
    //   phép xoá bên dưới.
    station_dwell_time: await dem("station_dwell_time", "machineId", mIds),
  };
  console.log(
    "  Van hanh: " +
      Object.entries(vanHanh).map(([k, v]) => `${k}=${v}`).join("  "),
  );

  if (CHI_DO) {
    console.log("\n  [--kho] KHONG xoa gi. Dung.");
    await sql.end();
    return;
  }

  // ── B4. Xoá trong MỘT giao dịch, ngược thứ tự tạo ────────────────────────
  const xoa: Record<string, number> = {};
  await sql.begin(async (tx) => {
    // ══════════════════════════════════════════════════════════════════════
    // ★★★ TRẦN GIẢI NÉN CỦA TIMESCALE — vì sao lượt gỡ đầu tiên CHẾT
    // ══════════════════════════════════════════════════════════════════════
    // Đo được khi gỡ FUYU-G (240 máy): `DELETE FROM ot_telemetry` chạy **10
    // phút** rồi đổ
    //
    //   SQLSTATE 53400 "tuple decompression limit exceeded by operation"
    //   detail: current limit: 100000, tuples decompressed: 17190221
    //
    // `ot_telemetry` là **hypertable ĐANG NÉN** với **28.281.581 hàng**
    // (`compression_enabled = true`, đo bằng `timescaledb_information
    // .hypertables`). Một `DELETE ... WHERE "machineId" = ANY(...)` không có
    // vế thời gian buộc Timescale GIẢI NÉN mọi chunk để tìm hàng khớp — 17,19
    // triệu bản ghi cho 128k hàng cần xoá.
    //
    // ★ Điều ĐÚNG đã xảy ra: cả giao dịch QUAY LUI, nên FUYU-G còn nguyên 240
    //   máy chứ không nằm lại ở trạng thái xoá dở. Đó chính là lý do mọi phép
    //   xoá ở đây nằm trong MỘT `begin`.
    //
    // ⚠ Đặt bằng `SET LOCAL` — chỉ trong giao dịch này, tự hết hiệu lực khi
    //   commit/rollback. KHÔNG `ALTER DATABASE`/`ALTER SYSTEM`: đó là đổi cấu
    //   hình máy chủ dùng chung cho một việc dùng một lần, và nó sẽ sống lâu
    //   hơn cái lý do sinh ra nó.
    // ⚠ `0` = không giới hạn. An toàn ở đây vì phạm vi đã bị chặn bằng `mIds`
    //   (danh sách id CỤ THỂ của nhà máy tải), không phải một vị từ mở.
    await tx`SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0`;
    // ══════════════════════════════════════════════════════════════════════
    // ★★★ DỮ LIỆU VẬN HÀNH XOÁ TRƯỚC — nó trỏ vào machines/stations/lines
    // ══════════════════════════════════════════════════════════════════════
    // Năm bảng này do lô P thêm vào bộ sinh. Chúng trỏ NGƯỢC lên máy/trạm/line
    // của nhà máy tải, nên phải đi TRƯỚC — xoá máy trước thì hoặc FK chặn, hoặc
    // (tệ hơn, ở bảng không FK) chúng thành MỒ CÔI CÂM và không còn đường nào
    // truy ra là của ai nữa. Đây đúng lớp tai nạn mà `twin_dat_cho` đã dạy.
    //
    // ⚠ KHOÁ NHẬN DẠNG LÀ QUAN HỆ, KHÔNG PHẢI TIỀN TỐ SERIAL. `serialNumber`
    //   mang tiền tố mã nhà máy, nhưng lọc theo tên là lọc theo một quy ước;
    //   lọc theo `currentStationId ∈ trạm của nhà máy này` là lọc theo một
    //   đường truy vết CÓ THẬT. Nếu ai đó sinh WIP bằng tay trên trạm này, nó
    //   cũng bị gỡ — và đó là hành vi ĐÚNG: trạm sắp biến mất.
    if (stIds.length) {
      xoa.wip_tracking = (await tx`DELETE FROM wip_tracking WHERE "currentStationId" = ANY(${stIds})`).count;
    }
    if (mIds.length) {
      xoa.product_inspections = (await tx`DELETE FROM product_inspections WHERE "machineId" = ANY(${mIds})`).count;
      xoa.machine_health_history = (await tx`DELETE FROM machine_health_history WHERE "machineId" = ANY(${mIds})`).count;
      xoa.machine_heartbeats = (await tx`DELETE FROM machine_heartbeats WHERE "machineId" = ANY(${mIds})`).count;
      // ══════════════════════════════════════════════════════════════════════
      // ★★★ BỐN BẢNG DO **SERVER ĐANG CHẠY** SINH RA, KHÔNG PHẢI BỘ SINH
      // ══════════════════════════════════════════════════════════════════════
      // Phát hiện khi nghiệm thu 240 máy: bật server lên rồi đo lại, thấy máy
      // của nhà máy tải đã có **100.800 hàng `ot_telemetry`**, 911 hàng
      // `machine_health_history` (bộ sinh chỉ ghi 240) và 668 `rul_estimates`.
      // Nhật ký server nói thẳng: `[simOtTelemetry] emitted 1128 sample(s) for
      // 282 machine(s)` — 282 = 43 máy thật + 240 máy tải (+1). Nghĩa là:
      //
      //   ⇒ Hễ server còn chạy, nó TỰ ĐỘNG bơm dữ liệu vào máy tải của ta, và
      //     một script gỡ chỉ biết những bảng NÓ GHI sẽ để lại hàng chục vạn
      //     hàng mồ côi — không phải vì nó sai, mà vì phạm vi của nó được suy
      //     từ "tôi đã ghi gì", chứ không từ "cái gì trỏ vào máy của tôi".
      //
      // ★ Bài học tổng quát: phạm vi phép gỡ phải suy từ **ĐỒ THỊ THAM CHIẾU**,
      //   không từ danh sách INSERT của bộ sinh. Danh sách INSERT là lời khai
      //   của tác giả; đồ thị tham chiếu là sự thật của lược đồ.
      //
      // ⚠ Vẫn nên DỪNG server trước khi gỡ: nó có thể ghi thêm giữa lúc ta đọc
      //   id và lúc ta xoá. Cầu chì mồ côi "lượt này" ở cuối sẽ bắt được nếu có.
      // ★ VẾ THỜI GIAN `ts >= now() - 30 days` KHÔNG phải để lọc — `machineId`
      //   đã đủ. Nó để **CẮT CHUNK**: cột phân mảnh của hypertable là `ts`, nên
      //   không có vế này Timescale phải mở MỌI chunk (28,3 triệu hàng, 10 phút
      //   và 17,19 triệu tuple giải nén). Với vế này nó chỉ chạm các chunk gần
      //   đây — nơi 100% hàng của nhà máy tải nằm, vì nhà máy tải vừa được sinh
      //   ra và `simOtTelemetry` chỉ ghi dữ liệu SỐNG.
      //
      // ⚠ Nếu ai đó giữ nhà máy tải quá 30 ngày, con số này phải nới ra —
      //   nên cầu chì mồ côi "lượt này" ở cuối đếm KHÔNG kèm vế thời gian và
      //   sẽ kêu nếu còn sót. Cắt nhanh mà vẫn có người kiểm.
      xoa.ot_telemetry = (
        await tx`DELETE FROM ot_telemetry
                  WHERE "machineId" = ANY(${mIds}) AND ts >= now() - interval '30 days'`
      ).count;
      xoa.rul_estimates = (await tx`DELETE FROM rul_estimates WHERE machine_id = ANY(${mIds})`).count;
      xoa.machine_status_logs = (await tx`DELETE FROM machine_status_logs WHERE "machineId" = ANY(${mIds})`).count;
      // ★ `predictive_alerts` tìm ra bằng MÔ HÌNH THỨ HAI, không bằng đồ thị FK:
      //   nó KHÔNG có khoá ngoại vào `machines` (như `ot_telemetry`,
      //   `rul_estimates`, `machine_health_history`), nên phép quét theo FK bỏ
      //   sót nó hoàn toàn. Chỉ phép quét theo TÊN CỘT trên `information_schema`
      //   mới thấy — đúng bài BG-127: hai mô hình rời nhau, và cái thứ hai bắt
      //   được thứ cái thứ nhất mù. Danh sách này KHÔNG được sửa bằng cách đoán;
      //   chạy lại phép quét theo tên cột sau mỗi lần lược đồ đổi.
      xoa.predictive_alerts = (await tx`DELETE FROM predictive_alerts WHERE "machineId" = ANY(${mIds})`).count;
      // ══════════════════════════════════════════════════════════════════════
      // ★★★ ĐỢT 15 LÔ R — `station_dwell_time`, VÀ VÌ SAO KHOÁ LÀ `machineId`
      // ══════════════════════════════════════════════════════════════════════
      // Lô S dựng một nhà máy thử rồi tháo, để lại **48 hàng mồ côi** ở bảng
      // này; nó dọn tay, nhưng gốc rễ nằm ở đây. Bảng mang CẢ BA khoá
      // `lineId`/`stationId`/`machineId`, nên có ba đường gỡ nghĩ được — và
      // chúng KHÔNG tương đương:
      //
      //   Đo trên `aoi_management` 2026-09-08 (8.652 hàng):
      //     mồ côi theo `machineId`  → **3.247**
      //     mồ côi theo `stationId`  → **0**
      //
      // ⇒ Gỡ theo `stationId` (đường mà đề xuất ban đầu nêu) sẽ để lại đúng
      //   3.247 hàng ấy: chúng khai một `stationId` CÒN SỐNG nhưng một
      //   `machineId` ĐÃ CHẾT. Khoá đúng là `machineId`, cùng trục với
      //   `machine_health_history` / `ot_telemetry` / `rul_estimates`.
      //
      // ⚠ Đây KHÔNG phải "chọn cột an toàn hơn" — nó là hệ quả của việc bảng
      //   mang nhiều khoá độc lập, và phép đo trên cả hai cột là cách duy nhất
      //   biết được cái nào bắt hết. Đừng đổi cột mà không đo lại cả hai.
      xoa.station_dwell_time = (
        await tx`DELETE FROM station_dwell_time WHERE "machineId" = ANY(${mIds})`
      ).count;
    }
    if (plIds.length) {
      xoa.andon_events = (await tx`DELETE FROM andon_events WHERE "lineId" = ANY(${plIds})`).count;
      xoa.line_balance_metrics = (await tx`DELETE FROM line_balance_metrics WHERE "lineId" = ANY(${plIds})`).count;
    }

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
    // ★ Hàng gán phạm vi tenant do bộ sinh tạo — khoá là `factoryCode`, tức là
    //   ĐÚNG mã nhà máy đang gỡ. Không có FK nên DB không tự dọn; bỏ sót thì
    //   người dùng đo giữ quyền xem một nhà máy KHÔNG CÒN TỒN TẠI.
    xoa.user_factory_assignments = (
      await tx`DELETE FROM user_factory_assignments WHERE "factoryCode" = ANY(${nhaMays.map((f) => f.code)})`
    ).count;
    xoa.factories = (await tx`DELETE FROM factories WHERE id = ANY(${fIds})`).count;
  });

  console.log("\n  DA XOA:");
  for (const [k, v] of Object.entries(xoa)) console.log(`    ${k.padEnd(18)} ${v}`);

  // ── B5. Cầu chì mồ côi: hàng đặt-chỗ trỏ vào máy/trạm KHÔNG còn tồn tại ──
  // `thucTheId` đa hình, không FK ⇒ DB không tự bắt. Nếu số này > 0 sau khi gỡ,
  // phép gỡ KHÔNG sạch và phải nói thẳng.
  // ══════════════════════════════════════════════════════════════════════════
  // ★★★ CẦU CHÌ MỒ CÔI VẬN HÀNH — VÀ VÌ SAO NÓ ĐO THEO **ID VỪA XOÁ**
  // ══════════════════════════════════════════════════════════════════════════
  // Bản đầu của cầu chì này đếm mồ côi TOÀN CSDL, và nó lập tức bắt được 8.197
  // hàng `machine_health_history` mồ côi. Điều tra (BG-127, hai mô hình rời:
  // LIỆT KÊ toàn phân bố theo tiền tố `machineCode`, rồi đối chiếu TỔNG
  // 182.403 = 174.206 sống + 8.197 mồ côi) cho ra:
  //
  //   FUYU-*  6.588 hàng / 1.098 máy   ghi 2026-09-07 05:12 → 07:05
  //   TAI-*   1.592 hàng / 1.592 máy   ghi 2026-09-07 05:13 → 05:14
  //   khác       17 hàng               2026-08-18 và 2026-09-03
  //
  // ⇒ Đó là RÁC CÓ SẴN của những lượt sinh TRƯỚC bản vá này: `go-tai-twin.ts`
  //   nguyên bản KHÔNG xoá `machine_health_history` (bảng đó chỉ vào phạm vi
  //   khi lô P thêm nó vào bộ sinh), nên mỗi lượt gỡ trước đây để lại toàn bộ
  //   phần sức khoẻ. Hàng của lượt gỡ ĐANG chạy = **0** (đo riêng).
  //
  // ⚠ Nên phép đo đúng là "lượt gỡ NÀY có để lại mồ côi không", tức là đếm trên
  //   ĐÚNG tập id vừa xoá — không phải đếm rác của người khác rồi báo mình hỏng.
  //   Một cầu chì kêu vì lỗi của lượt trước sẽ bị người đọc học cách phớt lờ, và
  //   khi nó kêu THẬT thì không ai nghe nữa.
  //
  // ★ Rác có sẵn vẫn được BÁO (mục "rac co san" bên dưới) — chỉ không tính vào
  //   kết luận sạch/bẩn của lượt này. Dọn nó là quyết định của chủ sở hữu, không
  //   phải việc script này tự ý làm: nó nằm NGOÀI phạm vi "hàng do tôi sinh".
  const mA = mIds.length ? mIds : [0];
  const sA = stIds.length ? stIds : [0];
  const pA = plIds.length ? plIds : [0];
  const [{ n: moCoiCuaToi }] = await sql<{ n: string }[]>`
    SELECT (
      (SELECT count(*) FROM machine_health_history WHERE "machineId" = ANY(${mA}))
    + (SELECT count(*) FROM product_inspections    WHERE "machineId" = ANY(${mA}))
    + (SELECT count(*) FROM machine_heartbeats     WHERE "machineId" = ANY(${mA}))
    + (SELECT count(*) FROM ot_telemetry           WHERE "machineId" = ANY(${mA}))
    + (SELECT count(*) FROM rul_estimates          WHERE machine_id   = ANY(${mA}))
    + (SELECT count(*) FROM machine_status_logs    WHERE "machineId" = ANY(${mA}))
    + (SELECT count(*) FROM predictive_alerts      WHERE "machineId" = ANY(${mA}))
    + (SELECT count(*) FROM station_dwell_time      WHERE "machineId" = ANY(${mA}))
    + (SELECT count(*) FROM wip_tracking WHERE "currentStationId" = ANY(${sA}))
    + (SELECT count(*) FROM andon_events           WHERE "lineId"  = ANY(${pA}))
    + (SELECT count(*) FROM line_balance_metrics    WHERE "lineId" = ANY(${pA}))
    )::text n
  `;
  console.log(`\n  Cau chi mo coi LUOT NAY (hang con sot tren id vua xoa): ${moCoiCuaToi}`);
  if (Number(moCoiCuaToi) > 0) {
    // ══════════════════════════════════════════════════════════════════════
    // ★★★ HÀNG SÓT VÌ **ĐUA VỚI SERVER**, KHÔNG PHẢI VÌ VỊ TỪ XOÁ SAI
    // ══════════════════════════════════════════════════════════════════════
    // Đo được ở lượt gỡ FUYU-G: sót đúng **1.920 hàng `ot_telemetry`**, mốc
    // `ts` = 17:10:30.717 → 17:10:31.016 — tức là được ghi TRONG LÚC giao dịch
    // xoá đang chạy. `simOtTelemetry` của server bơm ~1.128 mẫu mỗi nhịp cho
    // mọi máy đang `isActive`, và giao dịch của ta chụp ảnh (snapshot) tại lúc
    // BẮT ĐẦU nên không nhìn thấy hàng sinh sau đó.
    //
    // ⇒ Đây KHÔNG sửa được bằng một vị từ khéo hơn. Chừng nào còn một tiến
    //   trình khác ghi vào cùng những máy này, sẽ luôn có khe hở giữa "đọc id"
    //   và "commit". Cách đúng là **DỪNG SERVER trước khi gỡ**; cách vá là
    //   quét lại một lượt sau khi máy đã biến mất — lúc này an toàn tuyệt đối
    //   vì máy KHÔNG CÒN, nên không ai ghi thêm cho nó được nữa.
    //
    // ★ Quét lại đánh vào ĐÚNG tập id đã xoá, không phải "mọi hàng mồ côi":
    //   rác của lượt khác không phải việc của lượt này (xem docblock trên).
    console.log("  → Doi thu 2 (hang do SERVER ghi xen giua giao dich). Quet lai...");
    const xoaThem: Record<string, number> = {};
    await sql.begin(async (tx) => {
      await tx`SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0`;
      xoaThem.ot_telemetry = (
        await tx`DELETE FROM ot_telemetry WHERE "machineId" = ANY(${mA}) AND ts >= now() - interval '30 days'`
      ).count;
      xoaThem.machine_health_history = (await tx`DELETE FROM machine_health_history WHERE "machineId" = ANY(${mA})`).count;
      xoaThem.rul_estimates = (await tx`DELETE FROM rul_estimates WHERE machine_id = ANY(${mA})`).count;
      xoaThem.predictive_alerts = (await tx`DELETE FROM predictive_alerts WHERE "machineId" = ANY(${mA})`).count;
      xoaThem.machine_status_logs = (await tx`DELETE FROM machine_status_logs WHERE "machineId" = ANY(${mA})`).count;
      xoaThem.machine_heartbeats = (await tx`DELETE FROM machine_heartbeats WHERE "machineId" = ANY(${mA})`).count;
      xoaThem.product_inspections = (await tx`DELETE FROM product_inspections WHERE "machineId" = ANY(${mA})`).count;
      xoaThem.wip_tracking = (await tx`DELETE FROM wip_tracking WHERE "currentStationId" = ANY(${sA})`).count;
      xoaThem.station_dwell_time = (await tx`DELETE FROM station_dwell_time WHERE "machineId" = ANY(${mA})`).count;
    });
    console.log(
      "  Doi thu 2 da xoa: " +
        Object.entries(xoaThem).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join("  "),
    );

    const [{ n: conSot }] = await sql<{ n: string }[]>`
      SELECT (
        (SELECT count(*) FROM ot_telemetry           WHERE "machineId" = ANY(${mA}))
      + (SELECT count(*) FROM machine_health_history WHERE "machineId" = ANY(${mA}))
      + (SELECT count(*) FROM rul_estimates          WHERE machine_id   = ANY(${mA}))
      + (SELECT count(*) FROM predictive_alerts      WHERE "machineId" = ANY(${mA}))
      + (SELECT count(*) FROM machine_status_logs    WHERE "machineId" = ANY(${mA}))
      + (SELECT count(*) FROM machine_heartbeats     WHERE "machineId" = ANY(${mA}))
      + (SELECT count(*) FROM product_inspections    WHERE "machineId" = ANY(${mA}))
      + (SELECT count(*) FROM station_dwell_time     WHERE "machineId" = ANY(${mA}))
      + (SELECT count(*) FROM wip_tracking WHERE "currentStationId" = ANY(${sA}))
      )::text n
    `;
    console.log(`  Sau doi thu 2, con sot: ${conSot}`);
    if (Number(conSot) > 0) {
      console.error(
        "LOI: van con sot sau doi thu 2 — nhieu kha nang SERVER VAN DANG CHAY." +
          " Dung server roi chay lai script nay.",
      );
      process.exitCode = 1;
    }
  }

  const [{ n: moCoiWip }] = await sql<{ n: string }[]>`
    SELECT count(*)::text n FROM wip_tracking w
     WHERE w."currentStationId" IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM stations s WHERE s.id = w."currentStationId")
  `;
  const [{ n: moCoiIns }] = await sql<{ n: string }[]>`
    SELECT count(*)::text n FROM product_inspections p
     WHERE NOT EXISTS (SELECT 1 FROM machines m WHERE m.id = p."machineId")
  `;
  const [{ n: moCoiAndon }] = await sql<{ n: string }[]>`
    SELECT count(*)::text n FROM andon_events a
     WHERE a."machineId" IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM machines m WHERE m.id = a."machineId")
  `;
  const [{ n: moCoiHealth }] = await sql<{ n: string }[]>`
    SELECT count(*)::text n FROM machine_health_history h
     WHERE NOT EXISTS (SELECT 1 FROM machines m WHERE m.id = h."machineId")
  `;
  const [{ n: moCoiCb }] = await sql<{ n: string }[]>`
    SELECT count(*)::text n FROM line_balance_metrics b
     WHERE NOT EXISTS (SELECT 1 FROM production_lines p WHERE p.id = b."lineId")
  `;
  // Rác mồ côi TOÀN CSDL — BÁO CÁO, không phải cổng. Xem docblock ở trên: phần
  // lớn là di sản của những lượt gỡ TRƯỚC bản vá này, và quy nó vào lượt hiện
  // tại là đổ lỗi sai chỗ. Ghi ra để chủ sở hữu quyết định có dọn hay không.
  const tongMoCoi =
    Number(moCoiWip) + Number(moCoiIns) + Number(moCoiAndon) +
    Number(moCoiHealth) + Number(moCoiCb);
  console.log(
    `  Rac mo coi CO SAN toan CSDL (KHONG phai cua luot nay): wip=${moCoiWip}` +
      ` inspections=${moCoiIns} andon=${moCoiAndon} health=${moCoiHealth}` +
      ` line_balance=${moCoiCb}  tong=${tongMoCoi}`,
  );

  // ══════════════════════════════════════════════════════════════════════════
  // ★★★ ĐỢT 15 LÔ R — **CẦU CHÌ TỰ SUY: QUÉT THEO TÊN CỘT, KHÔNG THEO DANH SÁCH**
  // ══════════════════════════════════════════════════════════════════════════
  // G53 nói phạm vi phép gỡ phải suy từ **đồ thị tham chiếu**, không từ danh
  // sách INSERT. Nhưng ở CSDL này đồ thị FK **RỖNG**: đo 2026-09-08,
  //
  //   SELECT … FROM information_schema.table_constraints
  //    WHERE constraint_type='FOREIGN KEY'
  //      AND ccu.table_name IN ('machines','stations','production_lines', …)
  //   → **0 hàng**
  //
  // Không một bảng nào khai khoá ngoại vào `machines`. Nên một phép quét theo FK
  // trả về 0 và trông như "không còn gì để gỡ" — **âm tính giả hoàn hảo**. Mô
  // hình DUY NHẤT còn hiệu lực là quét theo **TÊN CỘT**.
  //
  // ⇒ Và đó chính là lý do danh sách xoá ở trên cứ thiếu thêm một bảng sau mỗi
  //   lô: lô P thêm `machine_health_history`, lô R thêm `station_dwell_time`…
  //   Chừng nào danh sách còn được BẢO TRÌ BẰNG TAY, nó sẽ còn lệch. Khối dưới
  //   đây không sửa danh sách — nó làm cho việc lệch **TỰ BÁO**.
  //
  // ⚠ Nó chỉ **ĐO và BÁO**, KHÔNG xoá: mở rộng phạm vi xoá theo một phép quét
  //   tự động là đúng cách để một hôm nào đó xoá nhầm bảng của người khác. Hàng
  //   nào nó tìm thấy là việc của người đọc quyết định.
  const bangCoKhoaMay = await sql<{ tbl: string; col: string }[]>`
    SELECT c.table_name AS tbl, c.column_name AS col
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_name = c.table_name AND t.table_schema = c.table_schema
     WHERE c.table_schema = 'public'
       AND t.table_type = 'BASE TABLE'
       AND c.column_name IN ('machineId', 'machine_id')
       AND c.data_type IN ('integer', 'bigint', 'smallint')
     ORDER BY c.table_name
  `;
  const soTMoCoi: Array<{ tbl: string; n: number }> = [];
  for (const { tbl, col } of bangCoKhoaMay) {
    try {
      const [r] = await sql.unsafe<{ n: string }[]>(
        `SELECT count(*)::text n FROM public."${tbl}" x
          WHERE x."${col}" IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM machines m WHERE m.id = x."${col}")`,
      );
      if (Number(r.n) > 0) soTMoCoi.push({ tbl, n: Number(r.n) });
    } catch {
      // Bảng phân mảnh/khung nhìn đặc biệt — bỏ qua, không để một bảng lạ giết
      // cả phép đo.
    }
  }
  if (soTMoCoi.length > 0) {
    const tong = soTMoCoi.reduce((a, b) => a + b.n, 0);
    console.log(
      `
  [QUET TEN COT] Mo coi theo machineId toan CSDL: tong=${tong}  ` +
        soTMoCoi.map((r) => `${r.tbl}=${r.n}`).join("  "),
    );
    const laVet = new Set([
      // Những bảng phép gỡ này CÓ xử lý — mồ côi ở đây là rác của lượt TRƯỚC.
      "machine_health_history", "ot_telemetry", "rul_estimates",
      "machine_status_logs", "predictive_alerts", "machine_heartbeats",
      "product_inspections", "station_dwell_time",
    ]);
    const laLa = soTMoCoi.filter((r) => !laVet.has(r.tbl));
    if (laLa.length > 0) {
      console.error(
        "  ⚠ BANG NGOAI DANH SACH GO: " + laLa.map((r) => `${r.tbl}=${r.n}`).join("  ") +
          "  → phep go dang THIEU bang nay. Bao lai truoc khi mo rong pham vi xoa.",
      );
    }
  }

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
