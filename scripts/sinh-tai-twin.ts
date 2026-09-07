#!/usr/bin/env tsx
/**
 * ============================================================================
 * SINH TẢI TWIN — dựng nhà máy TỔNG HỢP để ĐO GIỚI HẠN, không phải để dùng thật
 * ============================================================================
 *
 *   npx tsx scripts/sinh-tai-twin.ts --kho                # CHỈ ĐO, không ghi
 *   npx tsx scripts/sinh-tai-twin.ts                      # sinh FUYU-F đầy đủ
 *   npx tsx scripts/sinh-tai-twin.ts --ma=TAI-A --tang=1 --line=1 --may=2
 *   npx tsx scripts/sinh-tai-twin.ts --bo-tai             # sinh 3 nhà máy TAI-*
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỌC `scripts/go-tai-twin.ts` TRƯỚC. Nó được viết TRƯỚC script này.
 * ════════════════════════════════════════════════════════════════════════════
 * Script này ghi vào một CSDL có DỮ LIỆU THẬT (2 nhà máy, 43 máy, 82 hàng
 * `twin_dat_cho`). Không có phép gỡ đã nghiệm thu thì mọi hàng sinh ra ở đây là
 * ô nhiễm vĩnh viễn — `twin_dat_cho` không có cột nào nói "hàng này là tải thử".
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ NHẬN DẠNG BẰNG MÃ, KHÔNG BẰNG ENUM `nguon`
 * ════════════════════════════════════════════════════════════════════════════
 * `twinnguonenum` = {`sinh`, `tay`} — đo được, và KHÔNG được thêm giá trị (đổi
 * lược đồ, ngoài phạm vi duyệt). Mọi hàng ở đây mang `nguon='sinh'` như mọi hàng
 * suy-ra khác; thứ phân biệt nó với 82 hàng thật là **mã nhà máy** `FUYU-F*` /
 * `TAI-*` truy qua chuỗi phân cấp. Đó cũng là khoá mà `go-tai-twin.ts` dùng.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐƠN VỊ — mm, KHÔNG PHẢI m; và KHÔNG đọc `factories.floorWidthM`
 * ════════════════════════════════════════════════════════════════════════════
 * Bảng `twin_*` lưu **milimét** (`numeric(14,3)`). FUYU-F 3000 m × 2000 m × 25 m
 * ⇒ 3.000.000 × 2.000.000 × 25.000 mm.
 * §10A.0 CẤM đọc `factories.floorWidthM/floorDepthM`: SIM-FAC có 1500/1200, đọc
 * đúng đơn vị là 1,5 km × 1,2 km — số rác (ai đó nhập pixel vào ô mét). Script
 * này KHÔNG chạm hai cột đó và KHÔNG ghi giá trị nào vào chúng.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ BẪY HOÁN VỊ TRỤC — Z LÀ ĐỘ CAO (§5.2)
 * ════════════════════════════════════════════════════════════════════════════
 * Trong DB: X = dài (Đông), Y = rộng (mặt bằng), **Z = ĐỘ CAO**. Máy đứng trên
 * sàn ⇒ `viTriZMm = caoDoMm của tầng`, KHÔNG phải 0 và KHÔNG phải toạ độ mặt
 * bằng. Nhầm trục thì máy bay lên trời mà **không gì nổ** — nên có cầu chì
 * `kiemTrucZ()` ở cuối: mọi máy phải nằm trong [caoDoTang, caoDoTang + caoThongThuy].
 *
 * ════════════════════════════════════════════════════════════════════════════
 * TẤT ĐỊNH — seed cố định, không `Math.random()`
 * ════════════════════════════════════════════════════════════════════════════
 * "20–40 máy mỗi line" là NGẪU NHIÊN theo yêu cầu, nhưng phải TÁI LẬP được:
 * dùng LCG 32-bit gieo từ chuỗi mã (`maNhaMay:tang:line`). Chạy lại cho đúng
 * cùng bộ số. Không dùng `Math.random()` — chạy hai lần ra hai CSDL khác nhau
 * thì không đối chiếu được phép đo nào.
 */
import postgres from "postgres";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HAN_MAU_MAY_MS,
  TUOI_HEARTBEAT_MS,
  sinhAndonChoLine,
  sinhCanBangLine,
  sinhKiemTraChoMay,
  sinhSucKhoeChoMay,
  sinhWipChoLine,
  trangThaiCuaMay,
  type TramTai,
} from "./_lib/taiVanHanhTwin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const CHI_DO = args.includes("--kho") || args.includes("--dry-run");
const BO_TAI = args.includes("--bo-tai");
/** Dựng nhà máy 240 máy theo yêu cầu chủ sở hữu (4 tầng × 5 line × 12 máy). */
const BON_TANG = args.includes("--240") || args.includes("--fuyu-g");
/**
 * Dựng CHỈ hình học, bỏ dữ liệu vận hành. Là ĐỐI CHỨNG của lô P: chạy cả hai
 * rồi so lớp phủ là cách duy nhất chứng minh phần vận hành có tác dụng thật,
 * thay vì tin rằng nó có.
 */
const KHONG_VAN_HANH = args.includes("--khong-van-hanh");

/**
 * ★★★ MỘT đồng hồ cho CẢ lần chạy — đọc `Date.now()` ĐÚNG MỘT LẦN.
 *
 * Sinh 240 máy mất vài giây. Nếu mỗi hàng tự gọi `Date.now()` thì mốc của hàng
 * đầu và hàng cuối lệch nhau vài giây, và tệ hơn: hai lần chạy KHÔNG bao giờ ra
 * cùng dữ liệu, nên không phép đo nào đối chiếu được với phép đo nào. Đóng băng
 * ở đây giữ tính tất định của cả bộ sinh (mọi mốc = `BAY_GIO - hằng`).
 */
const BAY_GIO = Date.now();

/**
 * ★★★ Tài khoản KHÔNG-ADMIN được cấp quyền xem nhà máy tải.
 *
 * Danh sách CỐ Ý NGẮN và cố định: chỉ những tài khoản đo (e2e). Nới nó ra thành
 * "mọi supervisor" là biến một tiện ích nghiệm thu thành một lỗ phạm vi.
 *
 *   21075  e2e_tai_loE  supervisor — tài khoản mà e2e lô E/F đang dùng
 *
 * ⚠ Vì sao KHÔNG gán cho admin: admin đã bỏ qua bộ lọc phạm vi, nên gán thêm
 *   chẳng đổi gì — và một hàng thừa chỉ làm phép gỡ khó đối chiếu hơn.
 */
const NGUOI_DUNG_DUOC_XEM: readonly number[] = Object.freeze([21075]);
function soCo(ten: string, mac: number): number {
  const a = args.find((x) => x.startsWith(`--${ten}=`));
  return a ? Number(a.slice(ten.length + 3)) : mac;
}
function chuoiCo(ten: string, mac: string): string {
  const a = args.find((x) => x.startsWith(`--${ten}=`));
  return a ? a.slice(ten.length + 3) : mac;
}

// ════════════════════════════════════════════════════════════════════════════
// PHẦN THUẦN — không chạm DB, tất định, xuất khẩu để test
// ════════════════════════════════════════════════════════════════════════════

/** Quy mô một nhà máy tổng hợp. Mọi số là mm trừ chỗ ghi rõ. */
export interface QuyMo {
  ma: string;
  ten: string;
  daiMm: number;
  rongMm: number;
  caoMm: number;
  soTang: number;
  lineMoiTang: number;
  mayMin: number;
  mayMax: number;
}

/** FUYU-F theo brief lô E: 3000 m × 2000 m × 25 m, 3 tầng, 6 line/tầng, 20–40 máy/line. */
export const FUYU_F: QuyMo = Object.freeze({
  ma: "FUYU-F",
  ten: "FUYU-F (tai tong hop)",
  daiMm: 3_000_000,
  rongMm: 2_000_000,
  caoMm: 25_000,
  soTang: 3,
  lineMoiTang: 6,
  mayMin: 20,
  mayMax: 40,
});

/**
 * ★★★ FUYU-G — YÊU CẦU NGUYÊN VĂN CỦA CHỦ SỞ HỮU (lô P, đợt 14):
 *   *"4 tầng, mỗi tầng 5 Production Line, mỗi Line có 12 máy"* ⇒ **4×5×12 = 240**.
 *
 * ⚠ `mayMin = mayMax = 12` — CỐ Ý, và nó tắt phần ngẫu nhiên của `soMayCuaLine`:
 *   khi hai biên bằng nhau, `mayMin + floor(rnd()*1)` luôn ra đúng 12 với mọi hạt.
 *   Đây là chỗ dễ sai nhất của bản mở rộng này: brief nói "mỗi Line có 12 máy" —
 *   một con số CHÍNH XÁC, không phải một khoảng. Dùng 20–40 như FUYU-F thì tổng
 *   ra ~600 chứ không phải 240, và không phép đo nào ở cổng ra bắt được vì cả hai
 *   đều là "một nhà máy lớn dựng thành công".
 *
 * ★ Kiểm bằng `tongMayDuKien(FUYU_G) === 240` ở cầu chì đầu `main()`.
 */
export const FUYU_G: QuyMo = Object.freeze({
  ma: "FUYU-G",
  ten: "FUYU-G (4 tang x 5 line x 12 may)",
  daiMm: 3_000_000,
  rongMm: 2_000_000,
  caoMm: 34_000,
  soTang: 4,
  lineMoiTang: 5,
  mayMin: 12,
  mayMax: 12,
});

/** Ba nhà máy TAI-* cho kịch bản 4 nhà máy (E3) — cùng quy mô, khác mã. */
export const BO_TAI_QUY_MO: readonly QuyMo[] = Object.freeze([
  Object.freeze({ ...FUYU_F, ma: "TAI-B", ten: "TAI-B (tai tong hop)" }),
  Object.freeze({ ...FUYU_F, ma: "TAI-C", ten: "TAI-C (tai tong hop)" }),
  Object.freeze({ ...FUYU_F, ma: "TAI-D", ten: "TAI-D (tai tong hop)" }),
]);

/** Bước lưới đặt máy. Suy từ nội dung phải chứa, không phải số tròn tuỳ hứng. */
export const BUOC = Object.freeze({
  /** Khoảng giữa hai trạm dọc dòng chảy. */
  tramMm: 6_000,
  /** Khoảng giữa hai line theo chiều rộng. */
  lineMm: 40_000,
  /** Lối đi từ tường tới trạm đầu. */
  loiDiMm: 10_000,
  /** Sàn dày, cộng vào cao độ tầng trên. */
  sanMm: 500,
  /** Cao thông thuỷ mỗi tầng — 25 m / 3 tầng, trừ sàn. */
  caoThongThuyMm: 7_800,
});

/** Kích thước máy mặc định (đáy chuỗi dự phòng §5.3). GIẢ ĐỊNH ⇒ kichThuocDaDo=false. */
export const KT_MAC_DINH = Object.freeze({ rongMm: 1_200, caoMm: 1_800, sauMm: 800 });

/**
 * LCG 32-bit tất định. Cùng `hat` ⇒ cùng dãy, trên mọi máy, mọi lần chạy.
 * Không dùng `Math.random()`: hai lần chạy ra hai CSDL khác nhau thì không phép
 * đo nào đối chiếu được với phép đo nào.
 */
export function taoNgauNhien(hat: number): () => number {
  let s = hat >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Băm chuỗi → số 32-bit. FNV-1a; đủ tản cho việc gieo, không phải mật mã. */
export function bamChuoi(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Số máy của một line — TẤT ĐỊNH theo (mã nhà máy, tầng, line). */
export function soMayCuaLine(maNhaMay: string, tang: number, line: number, q: QuyMo): number {
  const rnd = taoNgauNhien(bamChuoi(`${maNhaMay}:${tang}:${line}`));
  return q.mayMin + Math.floor(rnd() * (q.mayMax - q.mayMin + 1));
}

/** 24 giá trị `machinetypeenum` — đo bằng `unnest(enum_range(NULL::machinetypeenum))`. */
export const LOAI_MAY: readonly string[] = Object.freeze([
  "AVI", "AOI", "SPI", "AXI", "ICT", "FCT", "CMM", "AUTOMATION",
  "FEEDER", "ASSEMBLY", "SCREWDRIVE", "DISPENSING", "ICT_FUNC", "ROBOT_TEST",
  "PACKAGING", "PALLETIZER", "ROBOT", "MOUNTER", "REFLOW", "STENCIL_PRINTER",
  "WAVE_SOLDER", "WELDER", "IOT_SENSOR", "IOT_GATEWAY",
]);

/** Cao độ mặt sàn tầng `capSo` (1-based). Tầng 1 = 0. */
export function caoDoTangMm(capSo: number): number {
  return (capSo - 1) * (BUOC.caoThongThuyMm + BUOC.sanMm);
}

/** Vị trí mặt bằng của trạm thứ `i` trên line thứ `l`. Z KHÔNG ở đây — Z là độ cao. */
export function viTriTram(l: number, i: number): { xMm: number; yMm: number } {
  return {
    xMm: BUOC.loiDiMm + i * BUOC.tramMm,
    yMm: BUOC.loiDiMm + l * BUOC.lineMm,
  };
}

/**
 * Cầu chì trục Z: mọi máy phải đứng TRÊN SÀN của tầng nó thuộc.
 * Nếu ai đó hoán vị trục (ghi toạ độ mặt bằng vào Z), máy sẽ ở độ cao hàng trăm
 * mét và hàm này bắt được — mà không có nó thì KHÔNG GÌ NỔ.
 */
export function kiemTrucZ(zMm: number, capSo: number): boolean {
  const day = caoDoTangMm(capSo);
  return zMm >= day - 1 && zMm <= day + BUOC.caoThongThuyMm + 1;
}

/** Tổng số máy tất định của một nhà máy — dùng để đối chiếu với `count(*)` sau khi ghi. */
export function tongMayDuKien(q: QuyMo): number {
  let n = 0;
  for (let t = 1; t <= q.soTang; t++) {
    for (let l = 0; l < q.lineMoiTang; l++) n += soMayCuaLine(q.ma, t, l, q);
  }
  return n;
}

// ════════════════════════════════════════════════════════════════════════════
// GHI DB
// ════════════════════════════════════════════════════════════════════════════

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

const sql = postgres(urlOwner(), { max: 1, connect_timeout: 30 });

function tieuDe(s: string): void {
  console.log("");
  console.log("=".repeat(74));
  console.log("  " + s);
  console.log("=".repeat(74));
}

/** Sinh một nhà máy. Trả về số hàng đã ghi từng bảng. */
async function sinhMotNhaMay(
  tx: postgres.TransactionSql,
  q: QuyMo,
  thuTuTrongLuoi: number,
): Promise<Record<string, number>> {
  const dem: Record<string, number> = {
    factories: 0, workshops: 0, production_lines: 0, stations: 0,
    machines: 0, twin_toa_nha: 0, twin_tang: 0, twin_dat_cho: 0,
    wip_tracking: 0, product_inspections: 0, machine_health_history: 0,
    andon_events: 0, line_balance_metrics: 0, user_factory_assignments: 0,
  };

  /**
   * Trạm/máy đã ghi, gom theo line — nguyên liệu cho phần DỮ LIỆU VẬN HÀNH.
   * Phải gom TRONG lúc ghi vì chỉ ở đây mới có id thật vừa `RETURNING`.
   */
  const tramTheoLine = new Map<number, TramTai[]>();
  /** `machineId → code`, cho `machine_health_history.machineCode` (NOT NULL). */
  const maCuaMay = new Map<number, string>();

  // ── Nhà máy. KHÔNG ghi floorWidthM/floorDepthM (§10A.0). ─────────────────
  const [nm] = await tx<{ id: number }[]>`
    INSERT INTO factories (code, name, description, "isActive")
    VALUES (${q.ma}, ${q.ten}, ${"Nha may tong hop sinh boi scripts/sinh-tai-twin.ts — KHONG phai du lieu that. Go bang scripts/go-tai-twin.ts"}, true)
    RETURNING id
  `;
  dem.factories = 1;

  // ══════════════════════════════════════════════════════════════════════════
  // ★★★ GÁN PHẠM VI TENANT — nếu không, nhà máy mới VÔ HÌNH với mọi vai KHÔNG-ADMIN
  // ══════════════════════════════════════════════════════════════════════════
  // Đo được khi nghiệm thu 240 máy bằng vai `supervisor` (`e2e_tai_loE`, id
  // 21075): `factory.list` trả **đúng 1 nhà máy** — SIM-FAC — và ô chọn nhà máy
  // trên màn Twin CHỈ CÓ MỘT MỤC. FUYU-G không hiện, nên cảnh rơi về SIM-FAC và
  // vẽ **2 tam giác**; URL `?nm=29` bị bỏ qua (`boChonNap.chon()` rơi về `ds[0]`
  // khi id yêu cầu không có trong danh sách).
  //
  // Đây KHÔNG phải lỗi: `resolveTenantFactoryScope` lọc theo
  // `user_factory_assignments.factoryCode` / `factories.corporateCode`, và người
  // dùng này chỉ được gán `SIM-FAC`. Nhà máy mới sinh ra có `corporateCode=NULL`
  // ⇒ không khớp trục nào ⇒ đúng ra phải vô hình.
  //
  // ⚠ Và đây là chỗ dễ tự lừa nhất của cả lô: đo bằng **admin** thì mọi thứ
  //   "chạy", vì admin BYPASS `requirePermission` và `resolveTenantFactoryScope`
  //   trả `factoryIds: null` (không lọc). Một nghiệm thu bằng admin sẽ báo XANH
  //   trên đúng cấu hình mà người dùng thật nhìn thấy màn hình trống.
  //
  // ⇒ Cấp quyền xem cho các tài khoản đo, bằng DỮ LIỆU (một hàng gán), không
  //   bằng cách nới lỏng bộ lọc. Hàng này gỡ theo `factoryCode` nên
  //   `go-tai-twin.ts` dọn được, và nó KHÔNG chạm quyền trên nhà máy thật.
  for (const uid of NGUOI_DUNG_DUOC_XEM) {
    await tx`
      INSERT INTO user_factory_assignments ("userId", "factoryCode", "assignedBy")
      SELECT ${uid}, ${q.ma}, ${uid}
       WHERE EXISTS (SELECT 1 FROM users WHERE id = ${uid})
         AND NOT EXISTS (
           SELECT 1 FROM user_factory_assignments
            WHERE "userId" = ${uid} AND "factoryCode" = ${q.ma}
         )
    `;
    dem.user_factory_assignments++;
  }

  // ── Toà nhà: kích thước THẬT bằng mm (§10A.4). ───────────────────────────
  // Bố trí giữa các nhà máy: lưới vuông tất định, bước 4.000.000 mm = 4 km
  // (đủ để hai khối 3 km không chồng nhau) — §10C.6 nói 400 m nhưng đó là cho
  // nhà xưởng 84 m; ở quy mô 3 km thì 400 m làm hai nhà máy LỒNG VÀO NHAU.
  const cot = thuTuTrongLuoi % 2;
  const hang = Math.floor(thuTuTrongLuoi / 2);
  const [tn] = await tx<{ id: number }[]>`
    INSERT INTO twin_toa_nha (
      "factoryId", ma, ten, "viTriXMm", "viTriYMm", "viTriZMm",
      "rongMm", "sauMm", "caoMm", nguon, "isActive"
    ) VALUES (
      ${nm.id}, ${`${q.ma}-TN1`}, ${`${q.ten} — toa chinh`},
      ${cot * 4_000_000}, ${hang * 4_000_000}, 0,
      ${q.daiMm}, ${q.rongMm}, ${q.caoMm}, 'sinh', true
    ) RETURNING id
  `;
  dem.twin_toa_nha = 1;

  // ── Một xưởng cho mỗi tầng. `workshops.tangId` nối xưởng ↔ tầng. ─────────
  for (let t = 1; t <= q.soTang; t++) {
    const caoDo = caoDoTangMm(t);
    const [tg] = await tx<{ id: number }[]>`
      INSERT INTO twin_tang (
        "toaNhaId", "capSo", ten, "caoDoMm", "caoThongThuyMm",
        "daiMm", "rongMm", "nguonHinhHoc", nguon, "isActive"
      ) VALUES (
        ${tn.id}, ${t}, ${`Tang ${t}`}, ${caoDo}, ${BUOC.caoThongThuyMm},
        ${q.daiMm}, ${q.rongMm}, 'sinh', 'sinh', true
      ) RETURNING id
    `;
    dem.twin_tang++;

    const [ws] = await tx<{ id: number }[]>`
      INSERT INTO workshops ("factoryId", code, name, "isActive", "tangId")
      VALUES (${nm.id}, ${`${q.ma}-WS${t}`}, ${`Xuong tang ${t}`}, true, ${tg.id})
      RETURNING id
    `;
    dem.workshops++;

    // Đặt chỗ cho xưởng — tâm mặt sàn, Z = cao độ tầng.
    await tx`
      INSERT INTO twin_dat_cho ("tangId","loaiThucThe","thucTheId","viTriXMm","viTriYMm","viTriZMm","kichThuocDaDo",nguon)
      VALUES (${tg.id}, 'workshop', ${ws.id}, ${q.daiMm / 2}, ${q.rongMm / 2}, ${caoDo}, false, 'sinh')
    `;
    dem.twin_dat_cho++;

    for (let l = 0; l < q.lineMoiTang; l++) {
      const [pl] = await tx<{ id: number }[]>`
        INSERT INTO production_lines ("workshopId", code, name, "isActive")
        VALUES (${ws.id}, ${`${q.ma}-T${t}-L${l + 1}`}, ${`Line ${l + 1} tang ${t}`}, true)
        RETURNING id
      `;
      dem.production_lines++;

      const soMay = soMayCuaLine(q.ma, t, l, q);
      // §10C.1: Line là PHẠM VI, không phải vật thể — hàng `line` chỉ giữ nhãn/màu,
      // cột vị trí bị bỏ qua khi đọc. Vẫn ghi để UI có chỗ treo nhãn.
      await tx`
        INSERT INTO twin_dat_cho ("tangId","loaiThucThe","thucTheId","viTriXMm","viTriYMm","viTriZMm","kichThuocDaDo",nguon)
        VALUES (${tg.id}, 'line', ${pl.id}, 0, 0, ${caoDo}, false, 'sinh')
      `;
      dem.twin_dat_cho++;

      // `machines.stationId` BẮT BUỘC ⇒ mỗi máy phải có trạm. Một trạm / một máy
      // giữ ánh xạ 1-1 và làm `orderIndex` = thứ tự dòng chảy đúng nghĩa.
      for (let i = 0; i < soMay; i++) {
        const p = viTriTram(l, i);
        const [st] = await tx<{ id: number }[]>`
          INSERT INTO stations ("lineId", code, name, "orderIndex", "isActive")
          VALUES (${pl.id}, ${`${q.ma}-T${t}-L${l + 1}-ST${i + 1}`}, ${`Tram ${i + 1}`}, ${i}, true)
          RETURNING id
        `;
        dem.stations++;

        const loai = LOAI_MAY[(bamChuoi(`${q.ma}:${t}:${l}:${i}`) % LOAI_MAY.length)];
        const maMay = `${q.ma}-T${t}-L${l + 1}-M${i + 1}`;
        // ★★★ `operationStatus` + `lastHeartbeat` GHI NGAY Ở ĐÂY, không phải bảng
        //   phụ nào: đó là HAI cột mà `db/twinCanh.traTrangThaiHangLoat` đọc để
        //   phát socket `twin:trangThai` — nguồn THẬT của màu 240 khối trên cảnh.
        //   Bỏ trống ⇒ `trungThucDuLieu.trangThaiHienThi` ghi đè hết về `khong_ro`
        //   và cảnh hiện 240 khối XÁM. Xem docblock `_lib/taiVanHanhTwin.ts`.
        const [m] = await tx<{ id: number }[]>`
          INSERT INTO machines (
            "stationId", code, name, "machineType", "isActive",
            "operationStatus", "lastHeartbeat"
          )
          VALUES (
            ${st.id}, ${maMay}, ${`May ${i + 1}`}, ${loai}::machinetypeenum, true,
            ${trangThaiCuaMay(q.ma, bamChuoi(`${q.ma}:${t}:${l}:${i}`))}::operationstatusenum,
            ${new Date(BAY_GIO - TUOI_HEARTBEAT_MS)}
          )
          RETURNING id
        `;
        dem.machines++;
        maCuaMay.set(m.id, maMay);
        const ds = tramTheoLine.get(pl.id) ?? [];
        ds.push({
          stationId: st.id, machineId: m.id, lineId: pl.id,
          thuTu: i, soTramCuaLine: soMay,
        });
        tramTheoLine.set(pl.id, ds);

        // ★ Z = caoDo (ĐỘ CAO của tầng), KHÔNG phải toạ độ mặt bằng.
        await tx`
          INSERT INTO twin_dat_cho (
            "tangId","loaiThucThe","thucTheId","viTriXMm","viTriYMm","viTriZMm",
            "rongMm","caoMm","sauMm","kichThuocDaDo",nguon
          ) VALUES (
            ${tg.id}, 'station', ${st.id}, ${p.xMm}, ${p.yMm}, ${caoDo},
            NULL, NULL, NULL, false, 'sinh'
          )
        `;
        await tx`
          INSERT INTO twin_dat_cho (
            "tangId","loaiThucThe","thucTheId","viTriXMm","viTriYMm","viTriZMm",
            "rongMm","caoMm","sauMm","kichThuocDaDo",nguon
          ) VALUES (
            ${tg.id}, 'machine', ${m.id}, ${p.xMm}, ${p.yMm}, ${caoDo},
            ${KT_MAC_DINH.rongMm}, ${KT_MAC_DINH.caoMm}, ${KT_MAC_DINH.sauMm}, false, 'sinh'
          )
        `;
        dem.twin_dat_cho += 2;
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ★★★ DỮ LIỆU VẬN HÀNH (lô P) — vì hình học KHÔNG đủ để mô phỏng
  // ══════════════════════════════════════════════════════════════════════════
  // §11g.4 đo được: `wip_tracking` 0 hàng trong 24h, `product_inspections` 0
  // hàng ⇒ mọi lớp phủ của màn Vận hành trống VĨNH VIỄN. Sinh 240 máy mà bỏ
  // phần này thì giao một cảnh 3D đẹp với overlay rỗng — đúng bẫy G5.
  //
  // ⚠ `--khong-van-hanh` để dựng CHỈ hình học (đối chứng: chạy cả hai rồi so
  //   lớp phủ, đó là cách duy nhất chứng minh phần này có tác dụng thật).
  if (!KHONG_VAN_HANH) {
    for (const [lineId, tram] of tramTheoLine) {
      tram.sort((a, b) => a.thuTu - b.thuTu);

      for (const w of sinhWipChoLine(q.ma, lineId, tram, BAY_GIO)) {
        await tx`
          INSERT INTO wip_tracking (
            "serialNumber", "lineId", "currentStationId", "currentMachineId",
            status, quantity, "enteredAt"
          ) VALUES (
            ${w.serialNumber}, ${w.lineId}, ${w.currentStationId}, ${w.currentMachineId},
            ${w.status}::wipstatusenum, ${w.quantity}, ${new Date(w.enteredAtMs)}
          )
        `;
        dem.wip_tracking++;
      }

      for (const a of sinhAndonChoLine(lineId, tram, BAY_GIO)) {
        await tx`
          INSERT INTO andon_events (
            state, reason, status, "lineId", "stationId", "machineId",
            title, "raisedBySystem", "raisedAt"
          ) VALUES (
            ${a.state}::andonstateenum, ${a.reason}::andonreasonenum,
            ${a.status}::andonstatusenum, ${a.lineId}, ${a.stationId}, ${a.machineId},
            ${a.title}, true, ${new Date(a.raisedAtMs)}
          )
        `;
        dem.andon_events++;
      }

      const cb = sinhCanBangLine(lineId, tram, BAY_GIO);
      if (cb) {
        await tx`
          INSERT INTO line_balance_metrics (
            "lineId", "periodStart", "periodEnd", "bottleneckStationId",
            "bottleneckMachineId", "utilizationPct", "balanceRatePct",
            "throughputUnits", "wipCount", "avgCycleTimeMs"
          ) VALUES (
            ${cb.lineId}, ${new Date(cb.periodStartMs)}, ${new Date(cb.periodEndMs)},
            ${cb.bottleneckStationId}, ${cb.bottleneckMachineId},
            ${cb.utilizationPct}, ${cb.balanceRatePct},
            ${cb.throughputUnits}, ${cb.wipCount}, ${12_000}
          )
        `;
        dem.line_balance_metrics++;
      }

      for (const t of tram) {
        for (const k of sinhKiemTraChoMay(q.ma, t.machineId, BAY_GIO)) {
          // ══════════════════════════════════════════════════════════════════
          // ★★★ `factoryCode` BẮT BUỘC ĐIỀN, dù cột cho phép NULL
          // ══════════════════════════════════════════════════════════════════
          // Đo được khi nghiệm thu 240 máy: ghi **2.880 hàng** rồi gọi
          // `digitalTwin.defectHeatmap` — nó vẫn trả **[]**.
          //
          // Loại trừ từng giả thuyết bằng phép đo, không bằng suy đoán:
          //   • KHÔNG phải thời gian — SQL thô cùng cửa sổ `>= now()-24h` trả
          //     đủ 240 máy × 12 hàng.
          //   • KHÔNG phải quyền — vai `avi_app` (vai mà server dùng) tự đếm
          //     được cả 2.880 hàng.
          //   • Nguyên nhân THẬT: `digitalTwinRouter.defectHeatmap` lọc tenant
          //     theo **TRỤC MÃ** — `congMaTenant({factoryCode, corporateCode})`
          //     — vì `product_inspections` mang mã THẲNG TRÊN HÀNG, không treo
          //     vào chuỗi phân cấp `machineId → stations → … → factories`.
          //     Hàng để NULL không khớp mã nào ⇒ bị lọc sạch.
          //
          // ★ Bài học rộng hơn con số: **"máy thuộc nhà máy X" KHÔNG kéo theo
          //   "hàng đo của máy ấy thuộc phạm vi X"**. Hai bảng cùng nói về một
          //   cái máy có thể dùng HAI TRỤC phạm vi khác nhau; bảng nào mang mã
          //   trên hàng thì phải được ĐIỀN, phạm vi không tự thừa kế.
          //
          // ⚠ Và đây là lớp lỗi mà một cầu chì đếm-hàng KHÔNG bắt được: đếm ra
          //   2.880 rồi báo ĐẠT, trong khi lớp phủ vẫn trống. Nên cầu chì vận
          //   hành ở `main()` đếm kèm `factoryCode IS NOT NULL`.
          await tx`
            INSERT INTO product_inspections (
              "machineId", "serialNumber", "overallResult", "originalResult",
              "inspectionTime", "factoryCode"
            ) VALUES (
              ${k.machineId}, ${k.serialNumber},
              ${k.overallResult}::overallresultenum,
              ${k.overallResult}::originalresultenum,
              ${new Date(k.inspectionTimeMs)}, ${q.ma}
            )
          `;
          dem.product_inspections++;
        }

        const h = sinhSucKhoeChoMay(q.ma, t.machineId, maCuaMay.get(t.machineId) ?? "?", BAY_GIO);
        await tx`
          INSERT INTO machine_health_history (
            "machineId", "machineCode", timestamp, "healthScore", "oeeScore",
            "uptimeScore", "errorRateScore", "cycleTimeScore", "predictedFailureRisk"
          ) VALUES (
            ${h.machineId}, ${h.machineCode}, ${new Date(h.timestampMs)},
            ${h.healthScore}, ${h.oeeScore}, ${h.uptimeScore},
            ${h.errorRateScore}, ${h.cycleTimeScore}, ${h.predictedFailureRisk}
          )
        `;
        dem.machine_health_history++;
      }
    }
  }
  return dem;
}

async function main(): Promise<void> {
  tieuDe("SINH TAI TWIN" + (CHI_DO ? "   [--kho: CHI DO, KHONG GHI]" : ""));
  const [{ nguoiDung, csdl }] = await sql<{ nguoiDung: string; csdl: string }[]>`
    SELECT current_user AS "nguoiDung", current_database() AS "csdl"
  `;
  console.log(`  Vai: ${nguoiDung}   CSDL: ${csdl}`);

  // Cho phép ép quy mô nhỏ để NGHIỆM THU SCRIPT GỠ trước khi sinh khối lớn.
  const quyMos: QuyMo[] = BO_TAI
    ? [...BO_TAI_QUY_MO]
    : BON_TANG
    ? [{ ...FUYU_G, ma: chuoiCo("ma", FUYU_G.ma), ten: FUYU_G.ten }]
    : [
        {
          ...FUYU_F,
          ma: chuoiCo("ma", FUYU_F.ma),
          ten: chuoiCo("ma", FUYU_F.ma) + " (tai tong hop)",
          soTang: soCo("tang", FUYU_F.soTang),
          lineMoiTang: soCo("line", FUYU_F.lineMoiTang),
          mayMin: soCo("may", FUYU_F.mayMin),
          mayMax: soCo("may-max", soCo("may", FUYU_F.mayMax)),
        },
      ];

  for (const q of quyMos) {
    const tong = tongMayDuKien(q);
    console.log(
      `\n  ${q.ma}: ${q.daiMm / 1000}m x ${q.rongMm / 1000}m x ${q.caoMm / 1000}m, ` +
        `${q.soTang} tang x ${q.lineMoiTang} line, may du kien = ${tong}`,
    );
    // In phân bố từng line — mô hình RỜI với `tongMayDuKien` (liệt kê ↔ tổng).
    const phanBo: number[] = [];
    for (let t = 1; t <= q.soTang; t++) {
      for (let l = 0; l < q.lineMoiTang; l++) phanBo.push(soMayCuaLine(q.ma, t, l, q));
    }
    console.log(`    phan bo/line: [${phanBo.join(",")}]  tong=${phanBo.reduce((a, b) => a + b, 0)}`);
    // ★ Cầu chì brief: preset 240 phải ra ĐÚNG 240. Brief nói "mỗi Line có 12
    //   máy" — số chính xác, không phải khoảng; 20–40 cũng dựng "thành công"
    //   nhưng ra ~600, và không cổng nào khác bắt được sai lệch đó.
    if (BON_TANG && tong !== 240) {
      console.error(`LOI: preset --240 phai ra dung 240 may, dang ra ${tong}. Dung.`);
      await sql.end();
      process.exit(1);
    }
    if (phanBo.reduce((a, b) => a + b, 0) !== tong) {
      console.error("LOI: hai mo hinh dem lech nhau. Dung.");
      await sql.end();
      process.exit(1);
    }
  }

  if (CHI_DO) {
    console.log("\n  [--kho] KHONG ghi gi. Dung.");
    await sql.end();
    return;
  }

  // Cầu chì: mã đã tồn tại ⇒ dừng, bắt gỡ trước. Không upsert — sinh chồng lên
  // dữ liệu cũ tạo ra một trạng thái không ai đối chiếu được với phép đo nào.
  const daCo = await sql<{ code: string }[]>`
    SELECT code FROM factories WHERE code = ANY(${quyMos.map((q) => q.ma)}) ORDER BY code
  `;
  if (daCo.length) {
    console.error(
      `LOI: cac ma da ton tai: ${daCo.map((r) => r.code).join(", ")}.` +
        ` Chay 'npx tsx scripts/go-tai-twin.ts' truoc.`,
    );
    await sql.end();
    process.exit(1);
  }

  const tongDem: Record<string, number> = {};
  const t0 = Date.now();
  await sql.begin(async (tx) => {
    // Thứ tự trong lưới bố trí: tiếp sau các nhà máy tải đã có (tất định theo mã).
    let i = 0;
    for (const q of quyMos) {
      const d = await sinhMotNhaMay(tx, q, i++);
      for (const [k, v] of Object.entries(d)) tongDem[k] = (tongDem[k] ?? 0) + v;
    }
  });
  console.log(`\n  DA GHI trong ${((Date.now() - t0) / 1000).toFixed(1)}s:`);
  for (const [k, v] of Object.entries(tongDem)) console.log(`    ${k.padEnd(18)} ${v}`);

  // ── Cầu chì trục Z: đo TRÊN DỮ LIỆU ĐÃ GHI, không tin biến trong bộ nhớ ──
  const lech = await sql<{ id: number; z: string; capSo: number; caoDo: string }[]>`
    SELECT d.id, d."viTriZMm"::text z, t."capSo", t."caoDoMm"::text "caoDo"
      FROM twin_dat_cho d
      JOIN twin_tang t ON t.id = d."tangId"
      JOIN twin_toa_nha n ON n.id = t."toaNhaId"
      JOIN factories f ON f.id = n."factoryId"
     WHERE f.code = ANY(${quyMos.map((q) => q.ma)})
       AND (d."viTriZMm" < t."caoDoMm" - 1 OR d."viTriZMm" > t."caoDoMm" + ${BUOC.caoThongThuyMm} + 1)
     ORDER BY d.id LIMIT 10
  `;
  console.log(`\n  Cau chi truc Z (may ngoai khoang tang): ${lech.length === 0 ? "0 — DAT" : `${lech.length}+ — VO`}`);
  if (lech.length) {
    console.error(JSON.stringify(lech, null, 1));
    process.exitCode = 1;
  }

  // ── Đối chiếu HAI MÔ HÌNH RỜI (BG-127): tổng dự kiến ↔ count(*) trên DB ──
  const duKien = quyMos.reduce((a, q) => a + tongMayDuKien(q), 0);
  const [{ n: thucTe }] = await sql<{ n: string }[]>`
    SELECT count(*)::text n
      FROM machines m
      JOIN stations s ON s.id = m."stationId"
      JOIN production_lines p ON p.id = s."lineId"
      JOIN workshops w ON w.id = p."workshopId"
      JOIN factories f ON f.id = w."factoryId"
     WHERE f.code = ANY(${quyMos.map((q) => q.ma)})
  `;
  console.log(`  Doi chieu may: du kien=${duKien}  DB dem=${thucTe}  ${duKien === Number(thucTe) ? "KHOP" : "LECH"}`);
  if (duKien !== Number(thucTe)) process.exitCode = 1;

  // ══════════════════════════════════════════════════════════════════════════
  // ★★★ CẦU CHÌ VẬN HÀNH — đo LẠI TỪ DB, không đọc biến trong bộ nhớ
  // ══════════════════════════════════════════════════════════════════════════
  // Đếm cái vừa ghi bằng biến vừa dùng để ghi là `f(x)=x`: nó xanh kể cả khi
  // `INSERT` ghi sai múi giờ hay trigger đổi giá trị. Nên mọi câu dưới đây hỏi
  // ĐÚNG câu mà router sẽ hỏi (cùng cửa sổ, cùng điều kiện), trên DB thật.
  if (!KHONG_VAN_HANH) {
    const mas = quyMos.map((q) => q.ma);
    const [vh] = await sql<
      { wip24h: string; buckets: string; ins24h: string; andonMo: string; cbMoi: string; mayTuoi: string }[]
    >`
      WITH tram AS (
        SELECT s.id
          FROM stations s
          JOIN production_lines p ON p.id = s."lineId"
          JOIN workshops w ON w.id = p."workshopId"
          JOIN factories f ON f.id = w."factoryId"
         WHERE f.code = ANY(${mas})
      ), may AS (
        SELECT m.id FROM machines m JOIN tram t ON t.id = m."stationId"
      ), lin AS (
        SELECT p.id
          FROM production_lines p
          JOIN workshops w ON w.id = p."workshopId"
          JOIN factories f ON f.id = w."factoryId"
         WHERE f.code = ANY(${mas})
      )
      SELECT
        (SELECT count(*)::text FROM wip_tracking
          WHERE "currentStationId" IN (SELECT id FROM tram)
            AND "enteredAt" > now() - interval '24 hours'
            AND "exitedAt" IS NULL)                                   AS "wip24h",
        (SELECT count(DISTINCT date_trunc('hour', "enteredAt")
                 + interval '30 min' * floor(extract(minute FROM "enteredAt") / 30))::text
           FROM wip_tracking
          WHERE "currentStationId" IN (SELECT id FROM tram)
            AND "enteredAt" > now() - interval '24 hours')            AS "buckets",
        -- factoryCode IS NOT NULL KHONG phai trang tri: do la truc ma
        -- defectHeatmap loc tenant. Thieu no, cau chi dem 2.880 va bao DAT
        -- trong khi router tra [] — mot cong xanh tren lop phu TRONG.
        (SELECT count(*)::text FROM product_inspections
          WHERE "machineId" IN (SELECT id FROM may)
            AND "inspectionTime" > now() - interval '24 hours'
            AND "factoryCode" IS NOT NULL)                            AS "ins24h",
        (SELECT count(*)::text FROM andon_events
          WHERE "lineId" IN (SELECT id FROM lin) AND status <> 'resolved') AS "andonMo",
        (SELECT count(*)::text FROM line_balance_metrics
          WHERE "lineId" IN (SELECT id FROM lin)
            AND "periodEnd" > now() - interval '8 hours')             AS "cbMoi",
        (SELECT count(*)::text FROM machines
          WHERE id IN (SELECT id FROM may)
            AND "lastHeartbeat" > now() - interval '5 minutes')       AS "mayTuoi"
    `;
    console.log("\n  Cau chi VAN HANH (do lai tu DB, dung cua so ma router hoi):");
    console.log(`    wip_tracking trong 24h, chua ra          ${vh.wip24h}`);
    console.log(`    so BUCKET 30' co WIP (router can >= 3)   ${vh.buckets}`);
    console.log(`    product_inspections trong 24h            ${vh.ins24h}`);
    console.log(`    andon dang mo                            ${vh.andonMo}`);
    console.log(`    line_balance con han 8h                  ${vh.cbMoi}`);
    console.log(`    may co heartbeat < 5 phut                ${vh.mayTuoi}`);
    // Mỗi số 0 ở đây là một lớp phủ TRỐNG trên màn hình — nói thẳng, đừng để
    // người nghiệm thu tự phát hiện bằng mắt.
    const trong = Object.entries(vh).filter(([, v]) => Number(v) === 0).map(([k]) => k);
    if (Number(vh.buckets) < 3) trong.push("buckets<3");
    if (trong.length) {
      console.error(`LOI: lop phu se TRONG vi: ${trong.join(", ")}`);
      process.exitCode = 1;
    } else {
      console.log("    => moi lop phu co du lieu. DAT.");
    }
    console.log(
      `\n  ★ HAN DUNG MAU MAY: ${Math.round(HAN_MAU_MAY_MS / 1000)}s ke tu heartbeat` +
        ` (${TUOI_HEARTBEAT_MS / 1000}s truoc luc sinh).` +
        `\n    Qua han, 'mucTuoi' quy ve 'khong_ro' va MOI MAY hoa XAM — WIP/andon van con.` +
        `\n    Lam tuoi lai: 'npx tsx scripts/sinh-tai-twin.ts --chi-nhip'`,
    );
  }

  await sql.end();
}

/**
 * ★★★ `--chi-nhip` — LÀM TƯƠI NHỊP TIM, không đụng hình học.
 *
 * Sinh ra vì một ràng buộc đo được: `NGUONG_CU_MS = 300_000` ⇒ 5 phút sau khi
 * sinh, mọi máy hoá xám `khong_ro`. Dựng lại cả nhà máy chỉ để chụp một tấm ảnh
 * là lãng phí và — quan trọng hơn — nó đổi toàn bộ id, nên phép đo trước và sau
 * không so được với nhau nữa.
 *
 * CHỈ đụng `machines.lastHeartbeat` của máy thuộc nhà máy tải. Không tạo, không
 * xoá hàng nào; `go-tai-twin.ts` không cần biết gì về nó.
 */
async function chiNhip(): Promise<void> {
  tieuDe("LAM TUOI NHIP TIM (--chi-nhip)");
  const tienTos = ["FUYU-F%", "FUYU-G%", "TAI-%"];
  const r = await sql`
    UPDATE machines SET "lastHeartbeat" = ${new Date(BAY_GIO - TUOI_HEARTBEAT_MS)}
     WHERE "stationId" IN (
       SELECT s.id FROM stations s
         JOIN production_lines p ON p.id = s."lineId"
         JOIN workshops w ON w.id = p."workshopId"
         JOIN factories f ON f.id = w."factoryId"
        WHERE f.code LIKE ANY(${tienTos}) AND f.code <> 'SIM-FAC'
     )
  `;
  console.log(`  Da lam tuoi ${r.count} may. Han dung ${HAN_MAU_MAY_MS / 1000}s.`);
  await sql.end();
}

(args.includes("--chi-nhip") ? chiNhip() : main()).catch(async (e) => {
  console.error(e);
  try {
    await sql.end();
  } catch {
    /* đã đóng */
  }
  process.exit(1);
});
