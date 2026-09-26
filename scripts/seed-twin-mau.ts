#!/usr/bin/env tsx
/**
 * ============================================================================
 * SEED TWIN MẪU — sinh bố cục 3D cho SIM-FAC (spec 2026-09-06 §8, §10C)
 * ============================================================================
 *
 *   npx tsx scripts/seed-twin-mau.ts            # sinh + ghi
 *   npx tsx scripts/seed-twin-mau.ts --kho      # CHỈ ĐO, không ghi
 *   npx tsx scripts/seed-twin-mau.ts --json     # in JSON tất định ra stdout
 *
 * CHẠY TAY. TẤT ĐỊNH. IDEMPOTENT. Không cron, không gọi từ server.
 *
 * ⚠ VÌ SAO `tsx` CHỨ KHÔNG `node` TRẦN — ĐO ĐƯỢC, KHÔNG PHẢI SỞ THÍCH
 * Node 24 tự bóc kiểu TS, nên `node scripts/seed-twin-mau.ts` chạy được nếu MỌI
 * import mang đuôi `.ts` tường minh. Nó VỠ ở đây vì `boCucTang.ts` (tệp client,
 * KHÔNG thuộc phạm vi việc này) viết `from "./heToaDo"` không đuôi — kiểu
 * bundler mà `moduleResolution:"bundler"` của tsconfig cho phép. Cờ
 * `--experimental-specifier-resolution=node` ĐÃ BỊ GỠ khỏi Node 24 (đo: chạy
 * vẫn ERR_MODULE_NOT_FOUND). Ba lối thoát: (a) sửa import của tệp client — ngoài
 * phạm vi và chạm tệp dùng chung khi có phiên khác chạy (luật G2); (b) chép lại
 * `sinhTuongBao` vào đây — sinh bản sao trôi dạt, đúng thứ "hai nguồn sự thật"
 * mà cả thiết kế này đang dẹp; (c) dùng `tsx`, đã có sẵn trong devDependencies
 * và đã là khuôn của `scripts/di-tru-bo-cuc-twin.ts` (dòng 1: `#!/usr/bin/env
 * tsx`). Chọn (c).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ MỌI HÀNG NÓ TẠO MANG `nguon='sinh'` VÀ `kichThuocDaDo=false` (NT-4)
 * ════════════════════════════════════════════════════════════════════════════
 * Không một con số hình học nào dưới đây được ĐO trên nhà xưởng thật. Chúng được
 * SUY RA từ số lượng thực thể và bốn tham số cấu hình (§8.1). Cờ `nguon='sinh'` +
 * `kichThuocDaDo=false` là chỗ hệ TỰ KHAI điều đó, và UI phải hiện badge vàng
 * "chưa đo" trên chúng. Kỹ thuật đo thật rồi sửa trong Inspector ⇒ `nguon='tay'`
 * ⇒ lần chạy sau của script này KHÔNG ĐÈ (chứng minh bằng ca dương G5, xem cuối).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ HAI CHỖ TÔI ĐI LỆCH SPEC — CÓ CHỦ Ý, KHAI RÕ
 * ════════════════════════════════════════════════════════════════════════════
 * L-1  §8 bước 6 viết "máy thứ 2, 3… lệch ±buocMayTrongTramMm theo **trục Z**".
 *      Nhưng §5.2 định nghĩa **Z của DB là ĐỘ CAO**. Đo được: trạm `SIM-L1-SPI-ST`
 *      có **7 máy**; xếp chúng theo Z sẽ treo 6 máy lơ lửng tới 4,2 m trên không.
 *      ⇒ Lệch theo **trục Y mặt bằng** (vuông góc dòng chảy), Z giữ = 0 (đứng
 *      trên sàn). Đây là mâu thuẫn NỘI TẠI của spec giữa §8 và §5.2 — không phải
 *      tôi tự đổi ý. Báo lại ở cổng ra thay vì tự sửa spec.
 *
 * L-2  §8 bước 3 (shelf-packing nhiều xưởng) KHÔNG chạy ở đây: đo được **1 xưởng
 *      thật** (`SIM-WS`). Xếp kệ cho một phần tử là mã chết không đo được. Script
 *      này đặt xưởng đầu tại tâm sàn và ghi rõ; khi có xưởng thứ hai, việc mở
 *      rộng nằm ở `sinhBoCuc.ts` (module thuần, Đợt sau), không ở script seed.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * KÍCH THƯỚC TOÀ NHÀ — SUY RA, KHÔNG BỊA SỐ TRÒN (§10A.0)
 * ════════════════════════════════════════════════════════════════════════════
 * ★ CẤM đọc `factories.floorWidthM/floorDepthM` — đo được 1500/1200, tức 1,5 km ×
 *   1,2 km. Số rác (ai đó nhập pixel vào ô mét). Script này KHÔNG chạm hai cột đó,
 *   và cầu chì §10A.0 ở BƯỚC 3 nổ nếu một hàng tầng nào mang đúng giá trị ấy.
 *
 * Thay vào đó suy từ NỘI DUNG phải chứa (mọi số dưới tái tính được từ CAU_HINH):
 *
 *   Trục X (dài):  tường 200 + lối đi 4.000 + ½ bước trạm 1.250 ⇒ trạm đầu @ 5.450
 *                  trạm cuối = 5.450 + 11 × 2.500 = 32.950
 *                  dài sàn   = 32.950 + 1.250 + 4.000 + 200 = **38.400 mm**
 *   Trục Y (rộng): ½ bề sâu chuyền dày nhất (trạm 7 máy) = 3 × 1.400 + 1.500/2 = 4.950
 *                  chuyền 1 @ 200 + 4.000 + 4.950 = 9.150 ; chuyền 3 @ 21.150
 *                  rộng sàn  = 21.150 + 4.950 + 4.000 + 200 = **30.300 mm**
 *   Cao:           thông thuỷ **7.000 mm** (giữa dải 6–8 m của nhà xưởng SMT).
 *
 *   ⇒ 38,4 × 30,3 m = 1.164 m² cho 43 máy. Con số này KHÔNG tròn CHÍNH VÌ nó là
 *     hệ quả của một phép cộng, không phải một lựa chọn thẩm mỹ. Số tròn ở đây
 *     sẽ là dấu hiệu ai đó đã bịa.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ĐỐI SOÁT — HAI MÔ HÌNH RỜI NHAU (bài học BG-127)
 * ════════════════════════════════════════════════════════════════════════════
 * BG-127: hai phép đo CÙNG KIỂU cùng sai một kiểu. Nên bước đối soát KHÔNG đếm
 * lại bằng cùng câu WHERE đã dùng để ghi:
 *   Mô hình 1 — LIỆT KÊ toàn phân bố `twin_dat_cho` GROUP BY (loaiThucThe, nguon)
 *               rồi cộng tổng. KHÔNG lọc, nên mù cấu trúc thì lộ ngay.
 *   Mô hình 2 — đếm NGƯỢC từ `machines`/`stations` đi lên qua chuỗi
 *               station→line→workshop→factory, KHÔNG đọc bảng đích lần nào.
 * Lệch ⇒ exit 1.
 */
import postgres from "postgres";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  chuanHoaQuat,
  laQuatChuanHoa,
  quatXoayQuanhTrucDung,
  type Quat,
} from "../client/src/components/twin3d/heToaDo.ts";
import {
  DAY_TUONG_MM,
  sanQuaHepChoTuongBao,
  sinhTuongBao,
  type TangMm,
} from "../client/src/components/twin3d/boCucTang.ts";
import { lechTrongTram } from "../client/src/components/twin3d/sinhBoCuc.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Tham số dòng lệnh ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const CHI_DO = args.includes("--kho") || args.includes("--dry-run");
const IN_JSON = args.includes("--json");

// ─── Cấu hình sinh (§8.1) — HẰNG, không đọc DB, không ngẫu nhiên ────────────
export interface CauHinhSinh {
  buocChuyenMm: number;
  buocTramMm: number;
  buocMayTrongTramMm: number;
  loiDiMm: number;
  caoThongThuyMm: number;
}

export const CAU_HINH: CauHinhSinh = Object.freeze({
  buocChuyenMm: 6_000,
  buocTramMm: 2_500,
  buocMayTrongTramMm: 1_400,
  loiDiMm: 4_000,
  /** 7 m — giữa dải 6–8 m của nhà xưởng SMT. Vẫn là GIẢ ĐỊNH ⇒ nguon='sinh'. */
  caoThongThuyMm: 7_000,
});

/** Đáy chuỗi dự phòng §5.3 khi loại máy không có trong bảng tham chiếu. */
const MAC_DINH = Object.freeze({ rongMm: 1200, caoMm: 1800, sauMm: 800 });

/** Mã ổn định — KHÔNG timestamp, KHÔNG random. Đây là khoá idempotent. */
const MA_TOA_NHA = (factoryId: number): string => `TN-SEED-${factoryId}`;
const CAP_TANG = 1;

// ─── .env → URL owner `aoi` ────────────────────────────────────────────────
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

/** `avi_app` KHÔNG ghi được bảng twin (42501) ⇒ ép owner `aoi`, cùng khuôn di-tru. */
function urlSeed(): string {
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

// ════════════════════════════════════════════════════════════════════════════
// PHẦN THUẦN — không chạm DB, tất định
// ════════════════════════════════════════════════════════════════════════════

export interface KichThuoc {
  rongMm: number;
  caoMm: number;
  sauMm: number;
}

export interface MayVao {
  id: number;
  ma: string;
  loaiMay: string | null;
  stationId: number;
}

export interface TramVao {
  id: number;
  ma: string;
  lineId: number;
  thuTu: number | null;
}

export interface ChuyenVao {
  id: number;
  ma: string;
  workshopId: number;
}

export interface DatChoRa {
  loaiThucThe: "machine" | "station" | "line" | "workshop";
  thucTheId: number;
  viTriXMm: number;
  viTriYMm: number;
  viTriZMm: number;
  rongMm: number | null;
  caoMm: number | null;
  sauMm: number | null;
  quat: Quat;
}

/**
 * Kích thước máy theo thứ tự ưu tiên §5.3 — CHỈ hai bậc cuối chạy ở đây:
 * `twin_kich_thuoc_loai[machineType]` → mặc định 1200×1800×800.
 *
 * Hai bậc TRÊN (`twin_dat_cho` đã nhập tay, `equipment_3d_models.bounds`) cố ý
 * KHÔNG đọc: hàng `nguon='tay'` không bao giờ đi tới đây (bị loại ở bước bỏ qua),
 * và `bounds IS NULL` ở 5/5 hàng model — đọc một cột toàn NULL rồi khai "đã áp
 * dụng đủ chuỗi ưu tiên" chính là lớp lỗi "đo với cờ tắt" (C-1).
 */
export function kichThuocMay(
  loaiMay: string | null,
  bang: ReadonlyMap<string, KichThuoc>,
): KichThuoc {
  if (loaiMay) {
    const kt = bang.get(loaiMay);
    if (kt) return kt;
  }
  return { ...MAC_DINH };
}

/**
 * Toạ độ X của một trạm theo `orderIndex`.
 *
 * ⚠ `orderIndex` đo được là **0-based** (min 0, max 11 trên cả ba chuyền) — khác
 * giả định "thứ tự 1,2,3…" mà §8 bước 5 ngầm mang. Hàm trừ `thuTuNhoNhat` chứ
 * KHÔNG giả định gốc bằng 0, nên vẫn đúng nếu dữ liệu đổi sang 1-based sau này.
 */
export function xTram(
  thuTu: number,
  thuTuNhoNhat: number,
  cauHinh: CauHinhSinh,
): number {
  const mocX = DAY_TUONG_MM + cauHinh.loiDiMm + cauHinh.buocTramMm / 2;
  return mocX + (thuTu - thuTuNhoNhat) * cauHinh.buocTramMm;
}

/**
 * Toạ độ Y của một chuyền theo thứ hạng của nó (0,1,2… sắp theo `code`).
 *
 * `nuaBeSauLonNhatMm` = nửa bề sâu của chuyền DÀY NHẤT — cần để chuyền đầu tiên
 * không thò ra ngoài lối đi. Truyền vào thay vì tính trong hàm, vì cùng MỘT mốc
 * phải dùng cho MỌI chuyền: nếu mỗi chuyền tự tính mốc riêng thì khoảng cách
 * tâm-tâm không còn bằng `buocChuyenMm` và T4 đổ.
 */
export function yChuyen(
  hang: number,
  nuaBeSauLonNhatMm: number,
  cauHinh: CauHinhSinh,
): number {
  const mocY = DAY_TUONG_MM + cauHinh.loiDiMm + nuaBeSauLonNhatMm;
  return mocY + hang * cauHinh.buocChuyenMm;
}

/*
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỘ LỆCH MÁY TRONG TRẠM — MỘT BẢN CÀI ĐẶT DUY NHẤT, Ở `sinhBoCuc.ts`
 * ════════════════════════════════════════════════════════════════════════════
 * Ở ĐÂY TỪNG CÓ `lechYMay(chiSo, soMay, cauHinh)` = `(i − (n−1)/2) × bước` —
 * đối xứng quanh tâm trạm. Nó ĐÃ BỊ XOÁ. Script nay IMPORT `lechTrongTram` từ
 * `client/src/components/twin3d/sinhBoCuc.ts` (xem khối import đầu tệp).
 *
 * VÌ SAO: spec §8 hứa "server gọi lại chính module này để không có hai bản cài
 * đặt lệch nhau", nhưng thực tế có HAI bản KHÁC THUẬT TOÁN, không chỉ lệch số:
 *   - bản seed  : đối xứng quanh tâm ⇒ n=2 cho −700 / +700
 *   - sinhBoCuc : máy 0 neo TẠI tâm, máy sau toả hai phía ⇒ n=2 cho 0 / +1400
 * Đo được triệu chứng: seed rồi chạy `sinhTuDong` trên đúng dữ liệu vừa seed thì
 * `sum(viTriXMm)` nhảy 1259233 → 1252950 — tức bố cục ĐỔI dù không ai sửa gì.
 *
 * CHỦ SỞ HỮU ĐÃ QUYẾT: `sinhBoCuc.ts` LÀ NGUỒN SỰ THẬT. Ba lý do:
 *   1. Máy đầu đứng ĐÚNG TÂM trạm ⇒ 36/37 trạm chỉ có 1 máy nên nằm chính xác
 *      trên đường tâm chuyền.
 *   2. Thêm/bớt máy vào trạm thì máy CŨ KHÔNG DỊCH CHỖ. Với công thức đối xứng,
 *      thêm một máy làm MỌI máy cũ trong trạm trượt đi nửa bước — xoá công sức
 *      của người đã kéo tay chỉnh vị trí.
 *   3. Đó là bản có 38 test T1–T9 và là bản server gọi THẬT khi người dùng bấm
 *      "Sinh tự động" (`server/routers/twinCanhRouter.ts` → `chuanBiSinh` →
 *      `sinhBoCuc`).
 *
 * ⚠ ĐỪNG CHÉP LẠI CÔNG THỨC VÀO ĐÂY. Chép lại chính là tái tạo cái lỗi vừa vá.
 *   Import chạy được dưới `tsx` — đã đo, và tệp này vốn đã import `heToaDo.ts`
 *   lẫn `boCucTang.ts` từ cùng thư mục ấy.
 *
 * ★ L-1 vẫn giữ nguyên: lệch theo trục **Y** mặt bằng, không theo Z — xem
 *   docblock đầu tệp. `lechTrongTram` trả một SỐ VÔ HƯỚNG (không mang trục),
 *   nơi gọi mới là chỗ quyết định cộng nó vào Y.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ HAI CHỖ LỆCH NỮA, CÙNG LỚP LỖI, TÌM ĐƯỢC KHI ĐO CHỨ KHÔNG KHI ĐỌC
 * ════════════════════════════════════════════════════════════════════════════
 * Gộp riêng công thức lệch KHÔNG làm hai bên khớp — đo lại vẫn còn 6 hàng lệch
 * và số hàng còn vênh 82/81. Trừ đi hằng số tịnh tiến gốc toạ độ thì 72/78 hàng
 * khớp TUYỆT ĐỐI, và 6 hàng còn lại đều nằm trong ĐÚNG trạm 7 máy với phần dư là
 * bội số của 1.400 — dấu hiệu của lệch THỨ TỰ, không phải lệch công thức. Hai
 * nguyên nhân, cả hai đều ở truy vấn của script này:
 *
 *   (a) THỨ TỰ MÁY TRONG TRẠM. `sinhBoCuc` xếp máy bằng `sapTheoMa` = theo
 *       `code` rồi `id`. Script này trước đây `ORDER BY m."stationId", m.id`,
 *       tức theo **id**. Trạm `SIM-L1-SPI-ST` cho hai thứ tự khác hẳn nhau
 *       (id: 1,243,244,245,246,247 · code: 244,245,243,1,247,246) ⇒ cùng công
 *       thức vẫn ra vị trí khác. Đã sửa thành `ORDER BY m."stationId", m.code,
 *       m.id` — KHỚP `sapTheoMa`, kể cả khoá phá hoà `id`.
 *
 *   (b) MÁY NGỪNG HOẠT ĐỘNG. `sinhBoCuc` lọc `.filter((m) => m.isActive)`;
 *       script này KHÔNG lọc, nên nó xếp chỗ cho `SN-ST4I-TRIAL-WELD-20260818`
 *       (`isActive=false`) còn `sinhTuDong` thì không ⇒ 82 hàng vs 81. Đã thêm
 *       `AND m."isActive"`.
 *
 * ⚠ Bài học đo: sửa xong (a)+(b) mà chỉ nhìn `count(*)` thì vẫn tưởng đã xong —
 *   phải đối chiếu TỪNG HÀNG theo khoá thực thể. Xem cổng ra "bằng chứng đồng
 *   nhất": chạy seed rồi chạy đúng đường `sinhTuDong` phải cho 0 hàng lệch.
 */

/**
 * Hướng máy (§8 bước 7): quay quanh trục ĐỨNG sao cho mặt trước hướng ra lối đi.
 * Chuyền hạng CHẴN quay 0°, hạng LẺ quay 180° — hai chuyền kề quay lưng vào nhau,
 * chừa lối đi chung ở giữa. Đây là bố trí "back-to-back" chuẩn của xưởng SMT.
 *
 * Trả quaternion ĐÃ CHUẨN HOÁ — CHECK `ck_dat_cho_quat` từ chối sai số > 1e-6,
 * nên chuẩn hoá không phải phép lịch sự mà là điều kiện ghi được.
 */
export function huongMay(hangChuyen: number): Quat {
  const goc = hangChuyen % 2 === 0 ? 0 : Math.PI;
  return chuanHoaQuat(quatXoayQuanhTrucDung(goc));
}

/** Dài sàn (trục X) suy từ số trạm nhiều nhất trên một chuyền. */
export function daiSanMm(soTramLonNhat: number, cauHinh: CauHinhSinh): number {
  const xCuoi = xTram(soTramLonNhat - 1, 0, cauHinh);
  return xCuoi + cauHinh.buocTramMm / 2 + cauHinh.loiDiMm + DAY_TUONG_MM;
}

/** Rộng sàn (trục Y) suy từ số chuyền và bề sâu chuyền dày nhất. */
export function rongSanMm(
  soChuyen: number,
  nuaBeSauLonNhatMm: number,
  cauHinh: CauHinhSinh,
): number {
  const yCuoi = yChuyen(soChuyen - 1, nuaBeSauLonNhatMm, cauHinh);
  return yCuoi + nuaBeSauLonNhatMm + cauHinh.loiDiMm + DAY_TUONG_MM;
}

// ─── Trình bày ──────────────────────────────────────────────────────────────
function tieuDe(s: string): void {
  if (IN_JSON) return;
  console.log("");
  console.log("=".repeat(74));
  console.log("  " + s);
  console.log("=".repeat(74));
}
function ghi(s: string): void {
  if (!IN_JSON) console.log(s);
}

// ════════════════════════════════════════════════════════════════════════════
// CHẠY
// ════════════════════════════════════════════════════════════════════════════
const sql = postgres(urlSeed(), { max: 1, connect_timeout: 30 });

async function main(): Promise<void> {
  tieuDe("SEED TWIN MAU" + (CHI_DO ? "   [--kho: CHI DO, KHONG GHI]" : ""));
  const [{ nguoiDung, csdl }] = await sql<{ nguoiDung: string; csdl: string }[]>`
    SELECT current_user AS "nguoiDung", current_database() AS "csdl"
  `;
  ghi(`  Vai: ${nguoiDung}   CSDL: ${csdl}`);

  // ── ĐỌC CÂY PHÂN CẤP — ORDER BY tất định trên MỌI câu (§8.3) ─────────────
  // Không dựa vào thứ tự trả về mặc định của DB: mọi ORDER BY kết bằng `id` để
  // tổng thứ tự là DUY NHẤT, kể cả khi hai hàng trùng khoá sắp chính.
  const xuongs = await sql<{ id: number; ma: string; factoryId: number }[]>`
    SELECT w.id, w.code AS ma, w."factoryId"
      FROM workshops w
      JOIN factories f ON f.id = w."factoryId"
     WHERE f.code = 'SIM-FAC'
     ORDER BY w.code, w.id
  `;
  if (xuongs.length === 0) {
    console.error("LOI: khong tim thay xuong nao cua SIM-FAC. Dung.");
    await sql.end();
    process.exit(1);
  }
  const factoryId = xuongs[0].factoryId;

  const chuyens = await sql<ChuyenVao[]>`
    SELECT pl.id, pl.code AS ma, pl."workshopId"
      FROM production_lines pl
     WHERE pl."workshopId" IN ${sql(xuongs.map((x) => x.id))}
     ORDER BY pl.code, pl.id
  `;
  const trams = chuyens.length
    ? await sql<TramVao[]>`
        SELECT s.id, s.code AS ma, s."lineId", s."orderIndex" AS "thuTu"
          FROM stations s
         WHERE s."lineId" IN ${sql(chuyens.map((c) => c.id))}
         ORDER BY s."lineId", s."orderIndex" NULLS LAST, s.code, s.id
      `
    : [];
  const mays = trams.length
    ? await sql<MayVao[]>`
        SELECT m.id, m.code AS ma, m."machineType"::text AS "loaiMay", m."stationId"
          FROM machines m
         WHERE m."stationId" IN ${sql(trams.map((t) => t.id))}
           AND m."isActive"
         ORDER BY m."stationId", m.code, m.id
      `
    : [];

  const ktRows = await sql<
    { loaiMay: string; rongMm: string; caoMm: string; sauMm: string }[]
  >`
    SELECT "loaiMay"::text AS "loaiMay", "rongMm", "caoMm", "sauMm"
      FROM twin_kich_thuoc_loai ORDER BY "loaiMay"
  `;
  const bangKt = new Map<string, KichThuoc>(
    ktRows.map((r) => [
      r.loaiMay,
      { rongMm: Number(r.rongMm), caoMm: Number(r.caoMm), sauMm: Number(r.sauMm) },
    ]),
  );

  ghi(
    `  Doc duoc: ${xuongs.length} xuong · ${chuyens.length} chuyen · ` +
      `${trams.length} tram · ${mays.length} may`,
  );
  ghi(`  Bang kich thuoc loai: ${bangKt.size} loai`);
  if (xuongs.length > 1) {
    ghi(`  ! L-2: ${xuongs.length} xuong — script chi dat xuong DAU (xep ke §8.3 chua chay).`);
  }

  // ── TÍNH BỐ CỤC (thuần) ───────────────────────────────────────────────────
  tieuDe("BUOC 1 — TINH BO CUC (thuan, tat dinh)");

  const mayTheoTram = new Map<number, MayVao[]>();
  for (const m of mays) {
    const ds = mayTheoTram.get(m.stationId) ?? [];
    ds.push(m);
    mayTheoTram.set(m.stationId, ds);
  }
  const tramTheoChuyen = new Map<number, TramVao[]>();
  for (const t of trams) {
    const ds = tramTheoChuyen.get(t.lineId) ?? [];
    ds.push(t);
    tramTheoChuyen.set(t.lineId, ds);
  }

  // Nửa bề sâu chuyền dày nhất — quyết định bước Y và rộng sàn.
  // ⚠ G7: đo trên ĐẦU RA (vị trí máy sau khi đã lệch + nửa kích thước), KHÔNG
  //    trên ĐẦU VÀO (số máy trong trạm). Hai đại lượng khác nhau; lẫn chúng là
  //    đúng lớp lỗi "đếm đầu vào ≠ đếm đầu ra".
  let nuaBeSauLonNhat = 0;
  for (const ds of mayTheoTram.values()) {
    for (let i = 0; i < ds.length; i++) {
      const kt = kichThuocMay(ds[i].loaiMay, bangKt);
      const bien = Math.abs(lechTrongTram(i, CAU_HINH.buocMayTrongTramMm)) + kt.sauMm / 2;
      if (bien > nuaBeSauLonNhat) nuaBeSauLonNhat = bien;
    }
  }
  const soTramLonNhat = Math.max(1, ...[...tramTheoChuyen.values()].map((d) => d.length));
  const dai = daiSanMm(soTramLonNhat, CAU_HINH);
  const rong = rongSanMm(Math.max(1, chuyens.length), nuaBeSauLonNhat, CAU_HINH);

  ghi(`  So tram lon nhat / 1 chuyen: ${soTramLonNhat}`);
  ghi(`  Nua be sau chuyen day nhat:  ${nuaBeSauLonNhat} mm  (do TREN vi tri may)`);
  ghi(`  => DAI san  = ${dai} mm (${(dai / 1000).toFixed(1)} m)   [SUY RA, khong doc floorWidthM]`);
  ghi(`  => RONG san = ${rong} mm (${(rong / 1000).toFixed(1)} m)  [SUY RA, khong doc floorDepthM]`);
  ghi(`  => CAO thong thuy = ${CAU_HINH.caoThongThuyMm} mm (dai 6-8 m nha xuong SMT)`);

  const tangMm: TangMm = {
    capSo: CAP_TANG,
    ten: "Tang tret",
    caoDoMm: 0,
    caoThongThuyMm: CAU_HINH.caoThongThuyMm,
    daiMm: dai,
    rongMm: rong,
    nguonHinhHoc: "sinh",
    caoDoNguon: "sinh",
    kichThuocNguon: "sinh",
    nguon: "sinh",
  };
  if (sanQuaHepChoTuongBao(tangMm)) {
    console.error(`LOI: san ${dai}x${rong} qua hep cho tuong day ${DAY_TUONG_MM}. Dung.`);
    await sql.end();
    process.exit(1);
  }
  const tuongs = sinhTuongBao(tangMm);

  // Đặt chỗ
  const datCho: DatChoRa[] = [];
  const canhBao: string[] = [];
  const chuyenTheoHang = new Map<number, number>();
  chuyens.forEach((c, i) => chuyenTheoHang.set(c.id, i));

  for (const c of chuyens) {
    const ds = tramTheoChuyen.get(c.id) ?? [];
    if (ds.length === 0) {
      canhBao.push(`chuyen ${c.ma} khong co tram nao`);
      continue;
    }
    const hang = chuyenTheoHang.get(c.id) ?? 0;
    const thuTus = ds.map((t) => t.thuTu).filter((v): v is number => v !== null);
    const thuTuNhoNhat = thuTus.length ? Math.min(...thuTus) : 0;
    const yTam = yChuyen(hang, nuaBeSauLonNhat, CAU_HINH);
    const quat = huongMay(hang);

    for (let iTram = 0; iTram < ds.length; iTram++) {
      const t = ds[iTram];
      // thuTu NULL => dùng thứ hạng trong danh sách (đã sắp theo code) — vẫn tất định.
      const tt = t.thuTu ?? thuTuNhoNhat + iTram;
      if (t.thuTu === null) {
        canhBao.push(`tram ${t.ma} khong co orderIndex — dung thu hang ${iTram}`);
      }
      const x = xTram(tt, thuTuNhoNhat, CAU_HINH);

      // Trạm: nhãn/phạm vi. Kích thước NULL = "chưa biết" (bao của máy suy ra khi vẽ)
      // — KHÔNG điền số giả, vì "chưa biết" hoá thành "biết rồi" là mất tin (NT-3).
      datCho.push({
        loaiThucThe: "station",
        thucTheId: t.id,
        viTriXMm: x,
        viTriYMm: yTam,
        viTriZMm: 0,
        rongMm: null,
        caoMm: null,
        sauMm: null,
        quat,
      });

      const dsMay = mayTheoTram.get(t.id) ?? [];
      if (dsMay.length === 0) {
        canhBao.push(`tram ${t.ma} khong co may nao`);
        continue;
      }
      for (let i = 0; i < dsMay.length; i++) {
        const m = dsMay[i];
        const kt = kichThuocMay(m.loaiMay, bangKt);
        if (!m.loaiMay || !bangKt.has(m.loaiMay)) {
          canhBao.push(
            `may ${m.ma} loai='${m.loaiMay}' khong co trong bang kich thuoc — dung mac dinh`,
          );
        }
        datCho.push({
          loaiThucThe: "machine",
          thucTheId: m.id,
          viTriXMm: x,
          viTriYMm: yTam + lechTrongTram(i, CAU_HINH.buocMayTrongTramMm),
          viTriZMm: 0,
          rongMm: kt.rongMm,
          caoMm: kt.caoMm,
          sauMm: kt.sauMm,
          quat,
        });
      }
    }
  }

  // Line: §10C.1 QĐ-12 — hàng TỒN TẠI để giữ nhãn/màu dải Line, nhưng các cột vị
  // trí BỊ BỎ QUA khi đọc (hình học Line = bao lồi trạm+máy của nó). Ghi 0/0/0
  // để không ai nhầm là toạ độ thật rồi "sửa" thành dùng nó.
  for (const c of chuyens) {
    datCho.push({
      loaiThucThe: "line",
      thucTheId: c.id,
      viTriXMm: 0,
      viTriYMm: 0,
      viTriZMm: 0,
      rongMm: null,
      caoMm: null,
      sauMm: null,
      quat: { x: 0, y: 0, z: 0, w: 1 },
    });
  }
  // Xưởng: tâm mặt sàn, bao trọn vùng dùng được (trừ tường + lối đi bao).
  datCho.push({
    loaiThucThe: "workshop",
    thucTheId: xuongs[0].id,
    viTriXMm: dai / 2,
    viTriYMm: rong / 2,
    viTriZMm: 0,
    rongMm: dai - 2 * (DAY_TUONG_MM + CAU_HINH.loiDiMm),
    caoMm: CAU_HINH.caoThongThuyMm,
    sauMm: rong - 2 * (DAY_TUONG_MM + CAU_HINH.loiDiMm),
    quat: { x: 0, y: 0, z: 0, w: 1 },
  });

  ghi(`  Dat cho tinh duoc: ${datCho.length} hang`);
  ghi(
    `     machine=${datCho.filter((d) => d.loaiThucThe === "machine").length}` +
      ` station=${datCho.filter((d) => d.loaiThucThe === "station").length}` +
      ` line=${datCho.filter((d) => d.loaiThucThe === "line").length}` +
      ` workshop=${datCho.filter((d) => d.loaiThucThe === "workshop").length}`,
  );
  ghi(`  Tuong bao: ${tuongs.length}   Canh bao: ${canhBao.length}`);
  for (const c of canhBao) ghi(`     ! ${c}`);

  // ── CẦU CHÌ THUẦN: T6 quaternion · T4 không chồng · T5 trong biên ────────
  // Dụng cụ đo ĐỘC LẬP với thuật toán (G7): quét HẬU ĐIỀU KIỆN trên kết quả,
  // không đọc một biến đếm nội bộ nào của phần sinh.
  let loiThuan = 0;
  for (const d of datCho) {
    if (!laQuatChuanHoa(d.quat)) {
      console.error(`  x T6: quat khong chuan hoa o ${d.loaiThucThe}:${d.thucTheId}`);
      loiThuan++;
    }
  }
  const hopMay = datCho
    .filter((d) => d.loaiThucThe === "machine")
    .map((d) => ({
      id: d.thucTheId,
      x0: d.viTriXMm - (d.rongMm ?? 0) / 2,
      x1: d.viTriXMm + (d.rongMm ?? 0) / 2,
      y0: d.viTriYMm - (d.sauMm ?? 0) / 2,
      y1: d.viTriYMm + (d.sauMm ?? 0) / 2,
    }));
  let capChong = 0;
  const viDuChong: string[] = [];
  for (let i = 0; i < hopMay.length; i++) {
    for (let j = i + 1; j < hopMay.length; j++) {
      const a = hopMay[i];
      const b = hopMay[j];
      // So CHẶT: chạm biên đúng bằng nhau (a.x1 === b.x0) KHÔNG tính là chồng.
      if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) {
        capChong++;
        if (viDuChong.length < 5) viDuChong.push(`may${a.id}-may${b.id}`);
      }
    }
  }
  ghi(`  T4 khong chong lan (quet HAU DIEU KIEN ${hopMay.length} hop): ${capChong} cap chong`);
  if (capChong > 0) {
    console.error(`  x T4 VO: ${capChong} cap chong. Vi du: ${viDuChong.join(", ")}`);
    loiThuan++;
  }
  const ngoaiBien = hopMay.filter((h) => h.x0 < 0 || h.y0 < 0 || h.x1 > dai || h.y1 > rong);
  ghi(`  T5 trong bien tang (0..${dai} x 0..${rong}): ${ngoaiBien.length} may ngoai bien`);
  if (ngoaiBien.length > 0) {
    console.error(`  x T5 VO: ids=[${ngoaiBien.map((h) => h.id).join(",")}]`);
    loiThuan++;
  }
  if (loiThuan > 0) {
    console.error(`  x ${loiThuan} cau chi THUAN no — DUNG truoc khi cham DB.`);
    await sql.end();
    process.exit(1);
  }

  if (IN_JSON) {
    // Đầu ra tất định để so byte-for-byte giữa hai lượt chạy (T1).
    console.log(
      JSON.stringify(
        {
          dai,
          rong,
          caoThongThuyMm: CAU_HINH.caoThongThuyMm,
          nuaBeSauLonNhat,
          soTramLonNhat,
          tuongs,
          canhBao: [...canhBao].sort(),
          datCho: [...datCho].sort(
            (a, b) =>
              a.loaiThucThe.localeCompare(b.loaiThucThe) || a.thucTheId - b.thucTheId,
          ),
        },
        null,
        2,
      ),
    );
    await sql.end();
    return;
  }

  if (CHI_DO) {
    ghi("");
    ghi("  [KHO] khong ghi hang nao.");
    await sql.end();
    return;
  }

  // ── GHI (idempotent, KHÔNG đè 'tay') ──────────────────────────────────────
  tieuDe("BUOC 2 — GHI (idempotent, KHONG DE hang nguon='tay')");

  const maToa = MA_TOA_NHA(factoryId);
  const [toa] = await sql<{ id: number }[]>`
    INSERT INTO twin_toa_nha (
      "factoryId", ma, ten, "rongMm", "sauMm", "caoMm", nguon, "isActive"
    ) VALUES (
      ${factoryId}, ${maToa}, ${"Xuong lap rap ao (SIM)"},
      ${dai}, ${rong}, ${CAU_HINH.caoThongThuyMm + 1000}, 'sinh', true
    )
    ON CONFLICT ("factoryId", ma) WHERE "isActive" DO UPDATE SET
      "rongMm" = EXCLUDED."rongMm", "sauMm" = EXCLUDED."sauMm",
      "caoMm" = EXCLUDED."caoMm", "updatedAt" = now()
    WHERE twin_toa_nha.nguon = 'sinh'
    RETURNING id
  `;
  // ON CONFLICT … WHERE nguon='sinh' trả 0 hàng khi toà đã 'tay' ⇒ phải đọc lại,
  // KHÔNG được coi 0 hàng là lỗi (đó chính là luật không-đè đang hoạt động).
  const toaId =
    toa?.id ??
    (
      await sql<{ id: number }[]>`
        SELECT id FROM twin_toa_nha
         WHERE "factoryId" = ${factoryId} AND ma = ${maToa} AND "isActive"
      `
    )[0]?.id;
  if (!toaId) {
    console.error("LOI: khong lay duoc id toa nha.");
    await sql.end();
    process.exit(1);
  }
  ghi(`  toa nha #${toaId} (${maToa})${toa ? "" : "  [GIU NGUYEN — nguon='tay']"}`);

  const [tg] = await sql<{ id: number }[]>`
    INSERT INTO twin_tang (
      "toaNhaId", "capSo", ten, "caoDoMm", "caoThongThuyMm",
      "daiMm", "rongMm", "nguonHinhHoc", nguon, "isActive"
    ) VALUES (
      ${toaId}, ${CAP_TANG}, 'Tang tret', 0, ${CAU_HINH.caoThongThuyMm},
      ${dai}, ${rong}, 'sinh', 'sinh', true
    )
    ON CONFLICT ("toaNhaId", "capSo") WHERE "isActive" DO UPDATE SET
      "daiMm" = EXCLUDED."daiMm", "rongMm" = EXCLUDED."rongMm",
      "caoThongThuyMm" = EXCLUDED."caoThongThuyMm", "updatedAt" = now()
    WHERE twin_tang.nguon = 'sinh'
    RETURNING id
  `;
  const tangId =
    tg?.id ??
    (
      await sql<{ id: number }[]>`
        SELECT id FROM twin_tang
         WHERE "toaNhaId" = ${toaId} AND "capSo" = ${CAP_TANG} AND "isActive"
      `
    )[0]?.id;
  if (!tangId) {
    console.error("LOI: khong lay duoc id tang.");
    await sql.end();
    process.exit(1);
  }
  ghi(`  tang   #${tangId} (cap ${CAP_TANG})${tg ? "" : "  [GIU NGUYEN — nguon='tay']"}`);

  // Xưởng gắn tầng (§8 bước 2) — CHỈ khi chưa gán. GC-1: lựa chọn tầng của người
  // dùng không được xoá mỗi lần bấm "Sinh tự động".
  const gan = await sql`
    UPDATE workshops SET "tangId" = ${tangId}
     WHERE id = ${xuongs[0].id} AND "tangId" IS NULL
    RETURNING id
  `;
  ghi(`  workshops.tangId: ${gan.length ? "da gan" : "giu nguyen (da co)"}`);

  // Đặt chỗ
  let ghiMoi = 0;
  let capNhat = 0;
  let boQuaTay = 0;
  for (const d of datCho) {
    const truoc = await sql<{ id: number; nguon: string }[]>`
      SELECT id, nguon FROM twin_dat_cho
       WHERE "loaiThucThe" = ${d.loaiThucThe}::twinthuctheenum
         AND "thucTheId" = ${d.thucTheId}
    `;
    if (truoc.length && truoc[0].nguon === "tay") {
      boQuaTay++;
      continue;
    }
    // ★ `kichThuocDaDo` PHẢI nằm trong DO UPDATE. Bỏ nó ra là một lỗi CÂM đã xảy
    //   ra THẬT ở lượt G5 đầu: hàng từng là 'tay' (kichThuocDaDo=true) rồi được
    //   trả về 'sinh' vẫn giữ cờ true ⇒ một hàng SINH tự nhận là ĐÃ ĐO — đúng lớp
    //   lỗi NT-4 chống. Cầu chì NT-4 ở BƯỚC 3 bắt được, và đó cũng là bằng chứng
    //   cầu chì ấy KHÔNG phải chỉ báo luôn-đúng (G8): nó đã nói "không" một lần,
    //   trên một ca dương có thật, chứ không chỉ sẵn sàng nói.
    const kq = await sql`
      INSERT INTO twin_dat_cho (
        "tangId","loaiThucThe","thucTheId","viTriXMm","viTriYMm","viTriZMm",
        "rongMm","caoMm","sauMm","kichThuocDaDo",
        "quatX","quatY","quatZ","quatW",nguon
      ) VALUES (
        ${tangId}, ${d.loaiThucThe}::twinthuctheenum, ${d.thucTheId},
        ${d.viTriXMm}, ${d.viTriYMm}, ${d.viTriZMm},
        ${d.rongMm}, ${d.caoMm}, ${d.sauMm}, false,
        ${d.quat.x}, ${d.quat.y}, ${d.quat.z}, ${d.quat.w}, 'sinh'
      )
      ON CONFLICT ("loaiThucThe","thucTheId") DO UPDATE SET
        "tangId"    = EXCLUDED."tangId",
        "viTriXMm"  = EXCLUDED."viTriXMm",
        "viTriYMm"  = EXCLUDED."viTriYMm",
        "viTriZMm"  = EXCLUDED."viTriZMm",
        "rongMm"    = EXCLUDED."rongMm",
        "caoMm"     = EXCLUDED."caoMm",
        "sauMm"     = EXCLUDED."sauMm",
        "kichThuocDaDo" = EXCLUDED."kichThuocDaDo",
        "quatX"     = EXCLUDED."quatX",
        "quatY"     = EXCLUDED."quatY",
        "quatZ"     = EXCLUDED."quatZ",
        "quatW"     = EXCLUDED."quatW",
        "updatedAt" = now()
      WHERE twin_dat_cho.nguon = 'sinh'
      RETURNING id
    `;
    if (!kq.length) boQuaTay++;
    else if (truoc.length) capNhat++;
    else ghiMoi++;
  }
  ghi(`  dat cho: moi=${ghiMoi}  cap nhat=${capNhat}  BO QUA vi nguon='tay'=${boQuaTay}`);

  // Tường bao — khoá idempotent là (tangId, loai, ten): bốn tên cố định, không
  // timestamp, nên chạy N lần để lại ĐÚNG bốn bức.
  let tuongMoi = 0;
  let tuongCapNhat = 0;
  let tuongBoQua = 0;
  for (const t of tuongs) {
    const co = await sql<{ id: number; nguon: string }[]>`
      SELECT id, nguon FROM twin_vat_the
       WHERE "tangId" = ${tangId} AND loai = 'tuong'::twinvattheenum AND ten = ${t.ten}
    `;
    if (co.length && co[0].nguon === "tay") {
      tuongBoQua++;
      continue;
    }
    if (co.length) {
      await sql`
        UPDATE twin_vat_the SET
          "viTriXMm" = ${t.viTriXMm}, "viTriYMm" = ${t.viTriYMm},
          "viTriZMm" = ${t.viTriZMm}, "rongMm" = ${t.rongMm},
          "caoMm" = ${t.caoMm}, "sauMm" = ${t.sauMm}, "updatedAt" = now()
         WHERE id = ${co[0].id} AND nguon = 'sinh'
      `;
      tuongCapNhat++;
    } else {
      await sql`
        INSERT INTO twin_vat_the (
          "tangId", loai, ten, "viTriXMm","viTriYMm","viTriZMm",
          "rongMm","caoMm","sauMm", nguon
        ) VALUES (
          ${tangId}, 'tuong'::twinvattheenum, ${t.ten},
          ${t.viTriXMm}, ${t.viTriYMm}, ${t.viTriZMm},
          ${t.rongMm}, ${t.caoMm}, ${t.sauMm}, 'sinh'
        )
      `;
      tuongMoi++;
    }
  }
  ghi(`  tuong bao: moi=${tuongMoi}  cap nhat=${tuongCapNhat}  BO QUA vi 'tay'=${tuongBoQua}`);

  // ── BƯỚC 3: ĐỐI SOÁT HAI MÔ HÌNH RỜI (BG-127) ────────────────────────────
  tieuDe("BUOC 3 — DOI SOAT HAI MO HINH ROI (BG-127)");

  // MÔ HÌNH 1 — LIỆT KÊ toàn phân bố, KHÔNG lọc. Mù cấu trúc thì lộ ngay.
  const phanBo = await sql<{ loai: string; nguon: string; n: number }[]>`
    SELECT "loaiThucThe"::text AS loai, nguon::text AS nguon, count(*)::int AS n
      FROM twin_dat_cho GROUP BY 1, 2 ORDER BY 1, 2
  `;
  ghi("  MO HINH 1 — liet ke toan phan bo twin_dat_cho (khong loc):");
  let tongM1 = 0;
  for (const r of phanBo) {
    ghi(`     ${r.loai.padEnd(11)} nguon=${r.nguon.padEnd(5)} = ${r.n}`);
    tongM1 += r.n;
  }
  ghi(`     TONG (cong tay tu phan bo) = ${tongM1}`);
  const [{ tongBang }] = await sql<{ tongBang: number }[]>`
    SELECT count(*)::int AS "tongBang" FROM twin_dat_cho
  `;
  ghi(`     count(*) toan bang         = ${tongBang}`);

  // MÔ HÌNH 2 — đếm NGƯỢC từ nguồn gốc đi lên, KHÔNG chạm bảng đích.
  const [m2] = await sql<
    { nMay: number; nTram: number; nChuyen: number; nXuong: number }[]
  >`
    SELECT
      (SELECT count(*)::int FROM machines m
         JOIN stations s ON s.id = m."stationId"
         JOIN production_lines pl ON pl.id = s."lineId"
         JOIN workshops w ON w.id = pl."workshopId"
         JOIN factories f ON f.id = w."factoryId" WHERE f.code = 'SIM-FAC')  AS "nMay",
      (SELECT count(*)::int FROM stations s
         JOIN production_lines pl ON pl.id = s."lineId"
         JOIN workshops w ON w.id = pl."workshopId"
         JOIN factories f ON f.id = w."factoryId" WHERE f.code = 'SIM-FAC')  AS "nTram",
      (SELECT count(*)::int FROM production_lines pl
         JOIN workshops w ON w.id = pl."workshopId"
         JOIN factories f ON f.id = w."factoryId" WHERE f.code = 'SIM-FAC')  AS "nChuyen",
      (SELECT count(*)::int FROM workshops w
         JOIN factories f ON f.id = w."factoryId" WHERE f.code = 'SIM-FAC')  AS "nXuong"
  `;
  const duKienM2 = m2.nMay + m2.nTram + m2.nChuyen + 1; // +1 = xưởng đầu (L-2)
  ghi("");
  ghi("  MO HINH 2 — dem NGUOC tu machines/stations di len (khong doc bang dich):");
  ghi(`     may    thuoc SIM-FAC = ${m2.nMay}`);
  ghi(`     tram   thuoc SIM-FAC = ${m2.nTram}`);
  ghi(`     chuyen thuoc SIM-FAC = ${m2.nChuyen}`);
  ghi(`     xuong  thuoc SIM-FAC = ${m2.nXuong}  (script dat 1 — xem L-2)`);
  ghi(`     DU KIEN tong = ${m2.nMay} + ${m2.nTram} + ${m2.nChuyen} + 1 = ${duKienM2}`);

  // Máy chưa xếp chỗ — con số UI hiện ở "Khu chờ xếp chỗ".
  const [{ tongMayHe }] = await sql<{ tongMayHe: number }[]>`
    SELECT count(*)::int AS "tongMayHe" FROM machines
  `;
  const [{ mayCoCho }] = await sql<{ mayCoCho: number }[]>`
    SELECT count(*)::int AS "mayCoCho" FROM twin_dat_cho WHERE "loaiThucThe" = 'machine'
  `;
  ghi("");
  ghi(
    `  * KHU CHO XEP CHO = ${tongMayHe} may toan he - ${mayCoCho} da xep = ` +
      `${tongMayHe - mayCoCho}`,
  );
  ghi(`    (may thuoc nha may KHAC SIM-FAC => chua co toa nha => nam o khu cho)`);

  let loi = 0;
  const kiem = (ten: string, dk: boolean): void => {
    ghi(`  ${dk ? "v" : "x"} ${ten}`);
    if (!dk) loi++;
  };
  ghi("");
  kiem(`M1 tong phan bo (${tongM1}) = count(*) toan bang (${tongBang})`, tongM1 === tongBang);
  kiem(`M1 (${tongM1}) = M2 du kien (${duKienM2})  <- HAI MO HINH ROI`, tongM1 === duKienM2);
  kiem(`may co cho (${mayCoCho}) = may SIM-FAC (${m2.nMay})`, mayCoCho === m2.nMay);

  // NT-4: không hàng 'sinh' nào tự nhận là đã đo.
  const [{ saiCo }] = await sql<{ saiCo: number }[]>`
    SELECT count(*)::int AS "saiCo" FROM twin_dat_cho
     WHERE nguon = 'sinh' AND "kichThuocDaDo" = true
  `;
  kiem(`NT-4: 0 hang nguon='sinh' tu nhan kichThuocDaDo=true (do ${saiCo})`, saiCo === 0);

  // §10A.0: không hàng tầng nào mang số rác floorWidthM/floorDepthM.
  const [{ tangRac }] = await sql<{ tangRac: number }[]>`
    SELECT count(*)::int AS "tangRac" FROM twin_tang
     WHERE "daiMm" IN (1500000, 1200000) OR "rongMm" IN (1500000, 1200000)
  `;
  kiem(`§10A.0: 0 tang mang so rac 1.500.000/1.200.000 mm (do ${tangRac})`, tangRac === 0);

  ghi("");
  if (loi > 0) {
    console.error(`  x DOI SOAT KHONG DAT — ${loi} sai lech. DUNG.`);
    await sql.end();
    process.exit(1);
  }
  ghi("  v DOI SOAT DAT — hai mo hinh roi nhau cung mot so.");
  ghi("");
  await sql.end();
}

main().catch(async (e) => {
  console.error("LOI:", (e as Error)?.message ?? e);
  try {
    await sql.end();
  } catch {
    /* da dong */
  }
  process.exit(1);
});
