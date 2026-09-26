#!/usr/bin/env tsx
/**
 * ============================================================================
 * DỌN HÀNG MỒ CÔI THAM CHIẾU `machines` — lô T, đợt 16
 * ============================================================================
 *
 *   npx tsx scripts/don-mo-coi-may.ts            # CHỈ ĐO (mặc định an toàn)
 *   npx tsx scripts/don-mo-coi-may.ts --xoa      # xoá thật
 *   npx tsx scripts/don-mo-coi-may.ts --quet     # quét MỌI bảng có cột máy (cầu chì)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VỊ TỪ XOÁ LÀ QUAN HỆ, KHÔNG PHẢI TIỀN TỐ MÃ HAY NGÀY
 * ════════════════════════════════════════════════════════════════════════════
 * Hàng bị xoá phải thoả ĐÚNG một điều kiện:
 *
 *     x.<cột máy> IS NOT NULL
 *     AND NOT EXISTS (SELECT 1 FROM machines m WHERE m.id = x.<cột máy>)
 *
 * Xoá theo tiền tố mã hoặc theo ngày BỊ CẤM: rác của lô E tập trung ngày
 * 07/09 nhưng chunk ngày đó chứa 5.526.376 hàng SỐNG (đo được, xem §chunk).
 * Một `drop_chunks('2026-09-03')` sẽ giết 5,5 triệu hàng thật.
 *
 * Hàng có cột máy IS NULL KHÔNG phải mồ côi — nó là hàng chưa gán máy, hợp lệ.
 * `ot_telemetry` có 70.689 hàng như vậy; chúng KHÔNG bị chạm. Đây là điểm
 * brief lô T ghi nhầm: brief cộng NULL vào mồ côi nên ra 2.024.741, phép đo
 * quan hệ ra 1.954.052 mồ côi + 70.689 null (chênh đúng bằng số null).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G59 — TÊN CỘT KHÔNG THỐNG NHẤT, PHẢI ĐO information_schema
 * ════════════════════════════════════════════════════════════════════════════
 * Đo được trên `aoi_management`:
 *     ot_telemetry.machineId            rul_estimates.machine_id  ← snake_case!
 *     machine_status_logs.machineId     station_dwell_time.machineId
 *     measurement_point_defs.machineId  predictive_alerts.machineId
 * Chép mẫu `machineId` cho mọi bảng thì `rul_estimates` im lặng bỏ sót 8.197
 * hàng — lỗi CÂM, không báo gì. Nên bảng dưới KHAI cột, và `xacMinhCot()`
 * đối chiếu lại với `information_schema` trước khi chạy bất cứ lệnh nào.
 *
 * `station_dwell_time` có CẢ `machineId` LẪN `stationId`. Khoá đúng là
 * `machineId` — dùng `stationId` sẽ đo nhầm sang bảng `stations`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ `ot_telemetry` — HYPERTABLE NÉN: VÌ SAO DELETE TOÀN BẢNG ĐỔ `53400`
 * ════════════════════════════════════════════════════════════════════════════
 * Lô P đo được: `DELETE` không giới hạn trên 28,3M hàng chạy 10 phút rồi đổ
 * SQLSTATE `53400` (configuration_limit_exceeded → "out of shared memory").
 *
 * NGUYÊN NHÂN ĐO ĐƯỢC — KHÔNG phải "hypertable nén không xoá được":
 *     max_locks_per_transaction = 64   (bảng khoá ≈ 64 × 100 conn = 6.400 ô)
 *     9 chunk × 6 chỉ mục               = 54 quan hệ chỉ mục
 *     38 bảng nén `compress_hyper_*`
 * Một DELETE toàn bảng mở khoá trên TẤT CẢ cùng lúc, cộng khoá trên từng đoạn
 * bị giải nén tại chỗ ⇒ tràn bảng khoá dùng chung.
 *
 * BẰNG CHỨNG PHẢN ĐỀ (đo trực tiếp, đã rollback):
 *     DELETE FROM _timescaledb_internal._hyper_25_68_chunk  ← chunk ĐANG NÉN
 *       WHERE "machineId" IS NOT NULL AND NOT EXISTS (…)
 *     → 108 hàng, 532 ms, KHÔNG lỗi.
 * TimescaleDB 2.28.2 tự giải nén đoạn bị chạm. Nên vấn đề là PHẠM VI GIAO
 * DỊCH, không phải nén. Cách xử: **một lệnh = một chunk = một lô nhỏ**.
 *
 * ★ VÌ SAO KHÔNG `drop_chunks` — ĐO, KHÔNG GIẢ ĐỊNH
 * Đo từng chunk `ot_telemetry` (mồ côi / sống / null):
 *     _hyper_25_11  09/07  nén          0 / 1         / 70.500
 *     _hyper_25_14  16/07  nén          0 / 4.593.811 / 3
 *     _hyper_25_49  23/07  nén          0 / 2.142.824 / 0
 *     _hyper_25_52  30/07  nén          0 / 489.540   / 0
 *     _hyper_25_56  06/08  nén          0 / 2.731.420 / 0
 *     _hyper_25_62  13/08  nén      8.716 / 2.517.508 / 0
 *     _hyper_25_68  20/08  nén        108 / 4.635.604 / 186
 *     _hyper_25_72  27/08  thường       0 / 3.688.852 / 0
 *     _hyper_25_78  03/09  thường 1.945.228 / 5.526.376 / 0
 * KHÔNG chunk nào 100% mồ côi. Mọi chunk có rác đều chứa hàng sống — chunk
 * đậm rác nhất (`_78`) vẫn có 5,5 triệu hàng SỐNG. `drop_chunks` mất dữ liệu
 * thật ở MỌI lựa chọn ⇒ loại bỏ. Đây là kết luận ĐO ĐƯỢC, không phỏng đoán.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ BẤT BIẾN CHẶN: SỐ HÀNG SỐNG KHÔNG ĐƯỢC GIẢM
 * ════════════════════════════════════════════════════════════════════════════
 * Trước và sau mỗi bảng, script đếm ba số (mồ côi / sống / null) bằng HAI mô
 * hình rời nhau (BG-127): (1) LEFT JOIN, (2) liệt kê toàn phân bố khoá rồi
 * đối chiếu tổng độc lập. Nếu **sống GIẢM dù một hàng** ⇒ ném lỗi, dừng ngay.
 *
 * Sống được phép TĂNG: dữ liệu đang chảy vào thật (`ot_telemetry` tăng giữa
 * hai lần đo). Chỉ chiều GIẢM mới là mất mát.
 *
 * ⚠ `count(*) FILTER (WHERE … NOT EXISTS …)` đổ `XX000 subplan "SubPlan 1"
 * was not initialized` khi PG chọn kế hoạch song song. Nên mô hình 1 dùng
 * LEFT JOIN, không dùng NOT EXISTS trong FILTER.
 */
import postgres from "postgres";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const XOA = args.includes("--xoa");
const QUET = args.includes("--quet");

/** Bảng được phép dọn + cột máy. Cột được `xacMinhCot()` đối chiếu information_schema. */
export const BANG_DON: ReadonlyArray<{ bang: string; cot: string }> = [
  { bang: "ot_telemetry", cot: "machineId" },
  { bang: "rul_estimates", cot: "machine_id" },
  { bang: "machine_status_logs", cot: "machineId" },
  { bang: "station_dwell_time", cot: "machineId" },
  { bang: "measurement_point_defs", cot: "machineId" },
  { bang: "predictive_alerts", cot: "machineId" },
];

/** Chỉ 6 bảng này. Bảng thứ 7 do `--quet` tìm ra thì BÁO, không tự xoá. */
const CHO_PHEP = new Set(BANG_DON.map((b) => b.bang));

function napEnv(p: string): void {
  if (!fs.existsSync(p)) return;
  for (const dong of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const s = dong.replace(/^﻿/, "").trim();
    if (!s || s.startsWith("#")) continue;
    const i = s.indexOf("=");
    if (i < 0) continue;
    const k = s.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = s.slice(i + 1).trim();
  }
}
napEnv(path.resolve(__dirname, "..", ".env"));

/**
 * Vai `avi_app` trong DATABASE_URL là vai WORM chỉ-thêm — nó KHÔNG xoá được.
 * Dùng vai chủ sở hữu `aoi` như mọi script bảo trì khác (luật Đ-28).
 */
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

const sql = postgres(urlOwner(), { max: 1, connect_timeout: 60, idle_timeout: 0 });

export interface BaSo {
  moCoi: bigint;
  song: bigint;
  nul: bigint;
  tong: bigint;
}

function tieuDe(s: string): void {
  console.log("");
  console.log("=".repeat(78));
  console.log("  " + s);
  console.log("=".repeat(78));
}

/** G59: cột khai trong bảng trên phải TỒN TẠI thật. Sai tên = lỗi CÂM, phải nổ sớm. */
async function xacMinhCot(): Promise<void> {
  const ten = BANG_DON.map((b) => b.bang);
  const co = await sql<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY(${ten})`;
  const set = new Set(co.map((r) => `${r.table_name}.${r.column_name}`));
  const thieu = BANG_DON.filter((b) => !set.has(`${b.bang}.${b.cot}`));
  if (thieu.length) {
    console.error("LOI G59: cot khai KHONG ton tai: " + thieu.map((t) => `${t.bang}.${t.cot}`).join(", "));
    process.exit(1);
  }
  console.log(`  xac minh cot: ${BANG_DON.length}/${BANG_DON.length} khop information_schema`);
}

/** Mô hình 1 — LEFT JOIN (tránh SubPlan song song). */
async function moHinh1(bang: string, cot: string): Promise<BaSo> {
  const [r] = await sql.unsafe<{ mo: string; song: string; nul: string; tong: string }[]>(`
    SELECT count(*) FILTER (WHERE x."${cot}" IS NOT NULL AND m.id IS NULL)::bigint AS mo,
           count(*) FILTER (WHERE m.id IS NOT NULL)::bigint                        AS song,
           count(*) FILTER (WHERE x."${cot}" IS NULL)::bigint                      AS nul,
           count(*)::bigint                                                        AS tong
      FROM "${bang}" x LEFT JOIN machines m ON m.id = x."${cot}"`);
  return { moCoi: BigInt(r.mo), song: BigInt(r.song), nul: BigInt(r.nul), tong: BigInt(r.tong) };
}

/**
 * Mô hình 2 — liệt kê TOÀN phân bố theo giá trị khoá, phân loại phía client,
 * rồi đối chiếu với một `count(*)` độc lập. Cấu trúc khác hẳn mô hình 1:
 * không JOIN, không FILTER quan hệ. Hai mô hình cùng sai một kiểu là khó.
 */
async function moHinh2(
  bang: string,
  cot: string,
): Promise<BaSo & { tongDocLap: bigint; khoaMoCoi: number }> {
  const rows = await sql.unsafe<{ k: number | null; n: string }[]>(
    `SELECT x."${cot}" AS k, count(*)::bigint AS n FROM "${bang}" x GROUP BY 1`,
  );
  const ids = new Set((await sql<{ id: number }[]>`SELECT id FROM machines`).map((r) => r.id));
  let moCoi = 0n;
  let song = 0n;
  let nul = 0n;
  let tong = 0n;
  let khoaMoCoi = 0;
  for (const r of rows) {
    const n = BigInt(r.n);
    tong += n;
    if (r.k === null) nul += n;
    else if (ids.has(r.k)) song += n;
    else {
      moCoi += n;
      khoaMoCoi++;
    }
  }
  const [t] = await sql.unsafe<{ n: string }[]>(`SELECT count(*)::bigint AS n FROM "${bang}"`);
  return { moCoi, song, nul, tong, tongDocLap: BigInt(t.n), khoaMoCoi };
}

/**
 * ★★★ VÌ SAO ĐỐI CHIẾU HAI MÔ HÌNH PHẢI CHO PHÉP LỆCH Ở CHIỀU "SỐNG"
 *
 * Hai mô hình chạy nối tiếp, KHÔNG trong một ảnh chụp chung. `ot_telemetry`
 * đang nhận ~2.000 hàng/giây thật ⇒ `song` và `tong` của M2 luôn LỚN HƠN M1
 * vài nghìn. Đòi bằng nhau tuyệt đối là đòi CSDL đứng yên — nó không đứng, và
 * cổng sẽ đỏ oan mãi mãi (đúng lớp "chỉ báo kêu trên ca ĐÚNG" đã gặp).
 *
 * Nhưng phần ta thực sự dựa vào để xoá — `moCoi` và `nul` — thì KHÔNG được
 * lệch: mồ côi là tập ĐÓNG (hàng mồ côi mới nhất `ts=2026-09-07T16:09`, trong
 * khi hàng mới nhất `ts=2026-09-08T00:10`; `machines_id_seq=3708` còn khoá mồ
 * côi nằm ở 40..2979 nên id đã xoá KHÔNG bao giờ được cấp lại). Nên:
 *   - `moCoi`, `nul`  : đòi BẰNG NHAU tuyệt đối giữa hai mô hình.
 *   - `song`, `tong`  : chỉ đòi M2 ≥ M1 (chảy vào, không chảy ra) và
 *                       `moCoi+song+null = tong` TRONG NỘI BỘ M2 (một ảnh chụp).
 */
async function doBaSo(bang: string, cot: string, nhan: string): Promise<BaSo> {
  const a = await moHinh1(bang, cot);
  const b = await moHinh2(bang, cot);
  const khopChot = a.moCoi === b.moCoi && a.nul === b.nul;
  const khongChayNguoc = b.song >= a.song && b.tong >= a.tong;
  const congKhop = b.moCoi + b.song + b.nul === b.tong;
  const troi = b.tong - a.tong;
  console.log(`  [${nhan}] ${bang}."${cot}"`);
  console.log(`      M1 join    : mo_coi=${a.moCoi}  song=${a.song}  null=${a.nul}  tong=${a.tong}`);
  console.log(
    `      M2 phan bo : mo_coi=${b.moCoi}  song=${b.song}  null=${b.nul}  tong=${b.tong}` +
      `  (tong doc lap=${b.tongDocLap}, ${b.khoaMoCoi} khoa mo coi)`,
  );
  console.log(
    `      mo_coi/null hai mo hinh khop=${khopChot ? "OK" : "LECH"}   ` +
      `cong noi bo M2=${congKhop ? "OK" : "LECH"}   troi giua hai phep do=+${troi} hang`,
  );
  if (!khopChot) throw new Error(`DUNG: ${bang} — mo_coi/null LECH giua hai mo hinh. Khong xoa gi.`);
  if (!congKhop) throw new Error(`DUNG: ${bang} — mo_coi+song+null != tong. Khong xoa gi.`);
  if (!khongChayNguoc) throw new Error(`DUNG: ${bang} — tong GIAM giua hai phep do. Khong xoa gi.`);
  return a;
}

/** Chunk của một hypertable; bảng thường trả về `null` (một "chunk" = chính nó). */
async function chunkCua(bang: string): Promise<{ rel: string; nen: boolean }[] | null> {
  const [ht] = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM timescaledb_information.hypertables WHERE hypertable_name = ${bang}`;
  if (!ht || ht.n === "0") return null;
  const ch = await sql<{ chunk_schema: string; chunk_name: string; is_compressed: boolean }[]>`
    SELECT chunk_schema, chunk_name, is_compressed FROM timescaledb_information.chunks
     WHERE hypertable_name = ${bang} ORDER BY range_start`;
  return ch.map((c) => ({ rel: `"${c.chunk_schema}"."${c.chunk_name}"`, nen: c.is_compressed }));
}

/**
 * Xoá mồ côi khỏi MỘT quan hệ, theo lô nhỏ, mỗi lô một lệnh riêng.
 * Giới hạn phạm vi lệnh là điều duy nhất giữ số khoá dưới trần 6.400 ô.
 *
 * ★★★ VÌ SAO KHÔNG CẮT LÔ BẰNG `ctid`
 * Cách hiển nhiên `WITH nan AS (SELECT ctid … LIMIT n) DELETE … USING nan`
 * chạy tốt trên bảng thường nhưng đổ trên chunk NÉN:
 *     "transparent decompression only supports tableoid system column"
 * Lớp giải nén trong suốt của TimescaleDB chỉ dựng lại `tableoid`, KHÔNG dựng
 * `ctid` — hàng nén không có vị trí vật lý để trỏ tới. Nên lô phải cắt bằng
 * khoá LOGIC. Ở đây dùng chính khoá chính `(id, ts)` của `ot_telemetry`.
 *
 * Cắt lô theo DANH SÁCH KHOÁ MÁY (`machineId`) thay vì theo hàng cũng đủ, và
 * rẻ hơn hẳn: có chỉ mục `("machineId", ts DESC)`, và tập khoá mồ côi là tập
 * ĐÓNG (2.883 khoá, id 40..2979, `machines_id_seq`=3708 nên không bao giờ
 * được cấp lại). Mỗi lệnh xoá vài khoá máy ⇒ phạm vi khoá nhỏ, chạy nhanh.
 */
async function xoaTheoKhoaMay(rel: string, cot: string, khoa: number[], coLo: number): Promise<bigint> {
  let tong = 0n;
  for (let i = 0; i < khoa.length; i += coLo) {
    const lat = khoa.slice(i, i + coLo);
    const r = await sql.unsafe<{ n: string }[]>(
      `WITH d AS (DELETE FROM ${rel} x WHERE x."${cot}" = ANY($1::int[]) RETURNING 1)
       SELECT count(*)::bigint AS n FROM d`,
      [lat],
    );
    tong += BigInt(r[0].n);
    process.stdout.write(`\r      ...khoa ${Math.min(i + coLo, khoa.length)}/${khoa.length}, da xoa ${tong}`);
  }
  if (khoa.length) process.stdout.write("\n");
  return tong;
}

/** Danh sách khoá máy MỒ CÔI của một bảng — tập đóng, đo ngay trước khi xoá. */
async function khoaMoCoiCua(bang: string, cot: string): Promise<number[]> {
  const r = await sql.unsafe<{ k: number }[]>(`
    SELECT DISTINCT x."${cot}" AS k FROM "${bang}" x
     LEFT JOIN machines m ON m.id = x."${cot}"
     WHERE x."${cot}" IS NOT NULL AND m.id IS NULL ORDER BY 1`);
  return r.map((v) => v.k);
}

/** Cầu chì: MỌI bảng public có cột tên máy, kèm số mồ côi. Chỉ BÁO, không xoá. */
export async function quetToanBo(): Promise<{ bang: string; cot: string; moCoi: bigint }[]> {
  const cols = await sql<{ tbl: string; col: string }[]>`
    SELECT c.table_name AS tbl, c.column_name AS col
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_name = c.table_name AND t.table_schema = c.table_schema
     WHERE c.table_schema = 'public'
       AND t.table_type = 'BASE TABLE'
       AND c.column_name IN ('machineId', 'machine_id')
       AND c.data_type IN ('integer', 'bigint', 'smallint')
     ORDER BY c.table_name`;
  const out: { bang: string; cot: string; moCoi: bigint }[] = [];
  for (const c of cols) {
    const [r] = await sql.unsafe<{ n: string }[]>(`
      SELECT count(*)::bigint AS n FROM "${c.tbl}" x LEFT JOIN machines m ON m.id = x."${c.col}"
       WHERE x."${c.col}" IS NOT NULL AND m.id IS NULL`);
    out.push({ bang: c.tbl, cot: c.col, moCoi: BigInt(r.n) });
  }
  return out;
}

/**
 * Ba bảng gốc KHÔNG được script này chạm tới. Ta ĐO trước, ĐO lại sau, và đòi
 * KHÔNG ĐỔI — thay vì khẳng định con số tuyệt đối.
 *
 * ⚠ Brief lô T ghi `factories 2 · machines 43 · twin_dat_cho 82`. Con số đó đã
 * HẾT HẠN: lô P (`8fa28e17`) nạp nhà máy tải `FUYU-G` 240 máy vào cùng CSDL và
 * nó vẫn đang nằm đó — đo được lúc chạy: factories 3 · machines 283 ·
 * twin_dat_cho 586. Khoá `machines` mồ côi nằm trong khoảng id 40..2979, còn
 * `FUYU-G` chiếm 3469..3708 ⇒ HAI TẬP RỜI NHAU, phép dọn không đụng lô P.
 * Chốt con số tuyệt đối ở đây sẽ làm script đỏ oan mỗi lần lô P nạp/gỡ.
 */
async function doGoc(): Promise<{ f: number; m: number; t: number }> {
  const [f] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM factories`;
  const [m] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM machines`;
  const [t] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM twin_dat_cho`;
  return { f: f.n, m: m.n, t: t.n };
}

let trGoc: { f: number; m: number; t: number };

async function main(): Promise<void> {
  tieuDe("DON MO COI THAM CHIEU machines" + (XOA ? "   [--xoa: XOA THAT]" : "   [CHI DO]"));
  const [{ nguoiDung, csdl }] = await sql<{ nguoiDung: string; csdl: string }[]>`
    SELECT current_user AS "nguoiDung", current_database() AS "csdl"`;
  console.log(`  Vai: ${nguoiDung}   CSDL: ${csdl}`);
  await xacMinhCot();
  trGoc = await doGoc();
  console.log(`  GOC (do luc bat dau): factories=${trGoc.f}  machines=${trGoc.m}  twin_dat_cho=${trGoc.t}`);

  if (QUET) {
    tieuDe("QUET TOAN BO — moi bang public co cot may");
    for (const r of await quetToanBo()) {
      const ngoai = CHO_PHEP.has(r.bang) ? "" : "   <<< NGOAI 6 BANG DUOC DUYET";
      console.log(`  ${r.bang}."${r.cot}"`.padEnd(48) + `mo_coi=${r.moCoi}${ngoai}`);
    }
  }

  const bangKe: string[] = [];
  for (const { bang, cot } of BANG_DON) {
    tieuDe(bang);
    const truoc = await doBaSo(bang, cot, "TRUOC");

    if (!XOA) {
      console.log(`      [CHI DO] se xoa ${truoc.moCoi} hang mo coi. Chay lai voi --xoa.`);
      bangKe.push(`${bang.padEnd(24)} mo_coi ${String(truoc.moCoi).padStart(9)} -> (chua xoa)  song ${truoc.song}`);
      continue;
    }
    if (truoc.moCoi === 0n) {
      console.log("      khong co mo coi, bo qua.");
      bangKe.push(`${bang.padEnd(24)} mo_coi         0 ->   0  song ${truoc.song} (KHONG DOI)`);
      continue;
    }

    const khoa = await khoaMoCoiCua(bang, cot);
    console.log(`      tap khoa may mo coi: ${khoa.length} khoa (id ${khoa[0]}..${khoa[khoa.length - 1]})`);
    const chunks = await chunkCua(bang);
    let daXoa = 0n;
    if (chunks) {
      console.log(
        `      hypertable: ${chunks.length} chunk (${chunks.filter((c) => c.nen).length} nen). Xoa TUNG CHUNK, lo 200 khoa.`,
      );
      for (const c of chunks) {
        // ĐO TRƯỚC, XOÁ SAU: chunk 0 mồ côi thì BỎ QUA hẳn, không phát lệnh nào.
        // Đây không phải tối ưu — nó là ĐIỀU KIỆN ĐỂ CHẠY ĐƯỢC. Một DELETE trên
        // chunk nén 4,59 triệu hàng KHÔNG có mồ côi vẫn giải nén để kiểm vị từ và
        // đổ `tuple decompression limit exceeded by operation`
        // (`timescaledb.max_tuples_decompressed_per_dml_transaction`, mặc định
        // 100.000). Chunk sạch phải không bị chạm thì lệnh mới không nổ.
        const [q] = await sql.unsafe<{ n: string; k: string }[]>(`
          SELECT count(*)::bigint AS n, count(DISTINCT x."${cot}")::bigint AS k
            FROM ${c.rel} x LEFT JOIN machines m ON m.id = x."${cot}"
           WHERE x."${cot}" IS NOT NULL AND m.id IS NULL`);
        if (q.n === "0") {
          console.log(`      ${c.rel}${c.nen ? " [nen]" : ""}  0 mo coi — BO QUA`);
          continue;
        }
        // Chỉ nạp đúng những khoá CÓ MẶT trong chunk này ⇒ số đoạn bị giải nén
        // tối thiểu, và lô nhỏ để không vượt trần giải nén mỗi giao dịch.
        const khoaChunk = await sql.unsafe<{ k: number }[]>(`
          SELECT DISTINCT x."${cot}" AS k FROM ${c.rel} x
            LEFT JOIN machines m ON m.id = x."${cot}"
           WHERE x."${cot}" IS NOT NULL AND m.id IS NULL ORDER BY 1`);
        console.log(
          `      ${c.rel}${c.nen ? " [nen]" : ""}  mo_coi=${q.n} tren ${khoaChunk.length} khoa — xoa`,
        );
        daXoa += await xoaTheoKhoaMay(c.rel, cot, khoaChunk.map((v) => v.k), 50);
      }
    } else {
      daXoa += await xoaTheoKhoaMay(`"${bang}"`, cot, khoa, 200);
    }
    console.log(`      da xoa: ${daXoa}`);

    const sau = await doBaSo(bang, cot, "SAU  ");
    if (sau.song < truoc.song) {
      throw new Error(
        `DUNG NGAY: ${bang} song GIAM ${truoc.song} -> ${sau.song} (mat ${truoc.song - sau.song} hang). ` +
          "Khong xoa them bang nao nua.",
      );
    }
    if (sau.moCoi !== 0n) {
      console.log(`      [!] con ${sau.moCoi} mo coi (du lieu moi chay vao trong luc xoa?).`);
    }
    const themSong = sau.song - truoc.song;
    bangKe.push(
      `${bang.padEnd(24)} mo_coi ${String(truoc.moCoi).padStart(9)} -> ${String(sau.moCoi).padStart(3)}  ` +
        `song ${truoc.song} -> ${sau.song}${themSong > 0n ? ` (+${themSong} chay vao)` : " (KHONG DOI)"}`,
    );
  }

  tieuDe("TONG KET");
  for (const d of bangKe) console.log("  " + d);
  const sauGoc = await doGoc();
  console.log(`  GOC TRUOC: factories=${trGoc.f}  machines=${trGoc.m}  twin_dat_cho=${trGoc.t}`);
  console.log(`  GOC SAU  : factories=${sauGoc.f}  machines=${sauGoc.m}  twin_dat_cho=${sauGoc.t}`);
  if (sauGoc.f !== trGoc.f || sauGoc.m !== trGoc.m || sauGoc.t !== trGoc.t) {
    throw new Error("DUNG: bang GOC bi doi — script nay khong duoc phep cham vao chung.");
  }
  console.log("  DB goc: KHONG DOI.");
}

/**
 * ★★★ CHỈ CHẠY KHI ĐƯỢC GỌI TRỰC TIẾP
 *
 * Tệp này export `BANG_DON` cho bộ test, và `import` một module ESM sẽ THỰC THI
 * thân module. Không có cửa này thì chỉ cần `import { BANG_DON }` là script XOÁ
 * tự chạy — đo được: lần đầu chạy test, `main()` đã nối vào `aoi_management_test`
 * và in "Vai: aoi CSDL: aoi_management_test". Nó chưa kịp xoá gì vì mặc định là
 * chỉ-đo, nhưng đó là may, không phải thiết kế: một biến môi trường `--xoa` sót
 * lại trong `argv` của trình chạy test là đủ để biến một lượt test thành một
 * lượt xoá thật trên CSDL bất kỳ mà `DATABASE_URL` đang trỏ tới.
 */
const laGoiTrucTiep =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (laGoiTrucTiep) {
  main()
    .then(() => sql.end())
    .catch(async (e) => {
      console.error("\nLOI:", e instanceof Error ? e.message : e);
      await sql.end();
      process.exit(1);
    });
} else {
  // Được import (bộ test): không chạy gì, và đóng kết nối để vitest không treo.
  void sql.end();
}
