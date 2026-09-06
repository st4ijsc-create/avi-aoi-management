#!/usr/bin/env tsx
/**
 * ============================================================================
 * DI TRÚ BỐ CỤC → TWIN 3D  (spec 2026-09-06-nha-may-3d-digital-twin-design §5.6)
 * ============================================================================
 *
 *   npx tsx scripts/di-tru-bo-cuc-twin.ts --kho              # CHỈ ĐO, không ghi
 *   npx tsx scripts/di-tru-bo-cuc-twin.ts                    # đo + ghi
 *   npx tsx scripts/di-tru-bo-cuc-twin.ts --ti-le-px-mm=12   # đổi giả định tỉ lệ
 *
 * CHẠY TAY, MỘT CHIỀU, IDEMPOTENT. Không có cron, không gọi từ server.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ `TI_LE_PX_MM` LÀ GIẢ ĐỊNH, KHÔNG PHẢI SỐ ĐO — ĐỌC TRƯỚC KHI TIN KẾT QUẢ
 * ════════════════════════════════════════════════════════════════════════════
 * `machine_positions` lưu int PIXEL (đo được: X 60..1255, Y 120..580). `factory_layouts`
 * KHÔNG có trường tỉ lệ và KHÔNG có cờ hiệu chuẩn — nghĩa là **không tồn tại một
 * phép đo nào** cho biết 1 pixel là bao nhiêu mm. Con số dùng ở đây được CHỌN, không
 * được ĐO.
 *
 * Hệ quả bắt buộc, không thương lượng:
 *   • MỌI hàng script này tạo ra mang `nguon='sinh'` và `kichThuocDaDo=false`.
 *   • UI PHẢI hiện badge vàng "chưa đo" trên chúng.
 *   • KHÔNG được trình bày kết quả di trú như toạ độ thật ở bất kỳ đâu.
 * Người dùng hiệu chuẩn lại bằng công cụ "Đặt tỉ lệ" ở màn Thiết kế (§7.4); lúc đó
 * `nguon` chuyển sang 'tay' và lần chạy sau của script này KHÔNG đè lên nữa.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐIỀU SCRIPT NÀY BỊ CẤM LÀM (§10A.0) — CẤM DI TRÚ floorWidthM/floorDepthM
 * ════════════════════════════════════════════════════════════════════════════
 * `factories.floorWidthM = 1500`, `floorDepthM = 1200` trên SIM-FAC. Đọc đúng đơn vị
 * = **1,5 km × 1,2 km** — vô lý cho một xưởng lắp ráp; gần như chắc chắn ai đó nhập
 * PIXEL vào ô MÉT. Ba nhà máy còn lại NULL.
 *
 * Nếu di trú thẳng, ta sẽ có một mặt sàn 1,5 km mà sau này KHÔNG AI TRUY ĐƯỢC vì sao
 * — số rác được rửa sạch bằng một lần ghi vào bảng mới trông có vẻ chính xác hơn. Nên
 * `twin_tang.daiMm`/`rongMm` để **NULL** (nghĩa: chưa ai đo), `nguonHinhHoc='sinh'`.
 * Cầu chì `kiemCamDiTruFloorWidth()` ở cuối file NỔ nếu một hàng tầng nào mang đúng
 * giá trị 1.500.000 mm hoặc 1.200.000 mm — tức là ai đó đã lách luật này về sau.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * PHÂN CẤP: `machines` KHÔNG CÓ CỘT `factoryId` (khác spec §5.6 ngầm định)
 * ════════════════════════════════════════════════════════════════════════════
 * Đo được trên schema thật: machines(id, stationId, …) — không có factoryId. Đường
 * đến nhà máy là chuỗi bốn chặng:
 *      machines.stationId → stations.lineId → production_lines.workshopId
 *                        → workshops.factoryId
 * Máy đứt bất kỳ chặng nào (station NULL, line mồ côi…) KHÔNG thuộc nhà máy nào và
 * KHÔNG được tạo hàng — nó vào "khu chờ xếp chỗ" y như máy không có toạ độ. Báo cáo
 * đối soát tách riêng hai lý do đó, vì cách sửa khác nhau hoàn toàn (một bên sửa dữ
 * liệu phân cấp, một bên kéo máy vào cảnh).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ĐỐI SOÁT — hai mô hình RỜI NHAU (bài học BG-127)
 * ════════════════════════════════════════════════════════════════════════════
 * BG-127: hai phép đo CÙNG KIỂU có thể CÙNG SAI. Nên bước 3 không đếm lại bằng cùng
 * một câu WHERE đã dùng để ghi. Nó:
 *   (a) LIỆT KÊ toàn bộ phân bố máy theo lý do (có hệ B / chỉ hệ A / không có gì /
 *       đứt phân cấp) và đối chiếu TỔNG với `SELECT count(*) FROM machines`;
 *   (b) đếm hàng `twin_dat_cho` thực sự nằm trong DB sau khi ghi;
 *   và DỪNG (exit 1) nếu (a) không cộng đủ tổng, hoặc (b) lệch dự kiến.
 * Số "không có vị trí nào" in ra PHẢI khớp số máy hiện ở "khu chờ xếp chỗ" trên UI —
 * đó là phép đo thứ hai, do người đọc thực hiện, trên một mô hình khác hẳn.
 */
import postgres from "postgres";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Tham số ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const CHI_DO = args.includes("--kho") || args.includes("--dry-run");

/**
 * GIẢ ĐỊNH: 1 px ≈ 10 mm (1 cm). Suy ra từ dải pixel đo được (X 60..1255) — với 10
 * mm/px thì xưởng rộng ~12,5 m, một con số HỢP LÝ cho 42 máy; với 1 mm/px thì 1,2 m
 * (vô lý), với 100 mm/px thì 125 m (quá rộng cho số máy đó). "Hợp lý" KHÔNG PHẢI
 * "đo được" — đó chính là lý do mọi hàng mang nguon='sinh'.
 */
const TI_LE_PX_MM = Number(
  args.find((a) => a.startsWith("--ti-le-px-mm="))?.split("=")[1] ?? 10,
);

/** Mặc định cuối cùng khi không có kích thước nào (§5.3 đáy chuỗi dự phòng). */
const MAC_DINH_RONG_MM = 1200;
const MAC_DINH_CAO_MM = 1800;
const MAC_DINH_SAU_MM = 800;

/** Giá trị rác đã biết của `factories.floorWidthM/floorDepthM`, tính ra mm. */
const RAC_FLOOR_MM = [1_500_000, 1_200_000];

// ─── .env ───────────────────────────────────────────────────────────────────
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

/**
 * `avi_app` KHÔNG có quyền ghi bảng mới (42501) — ép sang owner `aoi`, cùng khuôn
 * `scripts/apply-migration-0349.mjs`. Đè được bằng MIGRATION_DB_URL cho môi trường khác.
 */
function urlDiTru(): string {
  if (process.env.MIGRATION_DB_URL) return process.env.MIGRATION_DB_URL;
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    console.error("LOI: DATABASE_URL chua dat (.env hoac bien moi truong).");
    process.exit(1);
  }
  const u = new URL(raw);
  u.username = process.env.MIGRATION_DB_USER ?? "aoi";
  u.password = process.env.MIGRATION_DB_PASSWORD ?? "aoi";
  return u.toString();
}

// ─── Kiểu ───────────────────────────────────────────────────────────────────
interface DongMay {
  id: number;
  factoryId: number | null;
  factoryCode: string | null;
  /** hệ B — int pixel */
  mpX: number | null;
  mpY: number | null;
  /** hệ A — chuẩn hoá 0–1 */
  laX: string | null;
  laY: string | null;
}

type LyDo = "he_b" | "he_a" | "khong_toa_do" | "dut_phan_cap";

/**
 * Quyết định nguồn toạ độ cho MỘT máy. Hàm THUẦN, không chạm DB — tách ra để phép
 * phân loại kiểm được bằng mắt và test được về sau (RB-8: module tính toán .ts thuần).
 *
 * Thứ tự ưu tiên §5.6: hệ B (pixel, chính xác hơn về tương đối) → hệ A (0–1) → không.
 * Đứt phân cấp thắng tất cả: không biết máy ở nhà máy nào thì không có tầng để đặt.
 */
export function phanLoaiMay(m: DongMay): LyDo {
  if (m.factoryId === null) return "dut_phan_cap";
  if (m.mpX !== null && m.mpY !== null) return "he_b";
  if (m.laX !== null && m.laY !== null) return "he_a";
  return "khong_toa_do";
}

/**
 * Quy đổi toạ độ về mm. Hàm THUẦN.
 *
 * ⚠ Hệ A (0–1) KHÔNG nhân với `factories.floorWidthM` như spec §5.6 bước 2 gợi ý —
 * cột đó là SỐ RÁC (§10A.0, 1500 = 1,5 km). Thay vào đó nhân với kích thước mặc định
 * của tầng (60 × 40 m từ `twin_toa_nha`), nên máy hệ A rơi vào một mặt sàn hợp lý.
 * Đây là chỗ tôi ĐI LỆCH spec một cách CÓ CHỦ Ý và khai rõ — chép đúng spec ở đây sẽ
 * vi phạm chính luật §10A.0 mà spec đặt ra ở chỗ khác.
 */
export function quyDoiMm(
  m: DongMay,
  lyDo: LyDo,
  tiLePxMm: number,
  tangRongMm: number,
  tangSauMm: number,
): { xMm: number; yMm: number } | null {
  if (lyDo === "he_b") {
    return { xMm: Number(m.mpX) * tiLePxMm, yMm: Number(m.mpY) * tiLePxMm };
  }
  if (lyDo === "he_a") {
    return { xMm: Number(m.laX) * tangRongMm, yMm: Number(m.laY) * tangSauMm };
  }
  return null;
}

// ─── Chạy ───────────────────────────────────────────────────────────────────
const sql = postgres(urlDiTru(), { max: 1, connect_timeout: 30 });

function tieuDe(s: string): void {
  console.log("");
  console.log("═".repeat(74));
  console.log("  " + s);
  console.log("═".repeat(74));
}

async function main(): Promise<void> {
  tieuDe("DI TRU BO CUC → TWIN 3D" + (CHI_DO ? "   [--kho: CHI DO, KHONG GHI]" : ""));
  const [{ nguoiDung, csdl }] = await sql<{ nguoiDung: string; csdl: string }[]>`
    SELECT current_user AS "nguoiDung", current_database() AS "csdl"
  `;
  console.log(`  Vai: ${nguoiDung}   CSDL: ${csdl}`);
  console.log(`  TI_LE_PX_MM = ${TI_LE_PX_MM} mm/px  ← GIA DINH, khong phai so do`);

  // ── ĐO TRƯỚC KHI GHI (mô hình 1: liệt kê toàn phân bố) ────────────────────
  const mays = await sql<DongMay[]>`
    SELECT m.id,
           w."factoryId"          AS "factoryId",
           f.code                 AS "factoryCode",
           mp."positionX"         AS "mpX",
           mp."positionY"         AS "mpY",
           m."layoutPositionX"    AS "laX",
           m."layoutPositionY"    AS "laY"
      FROM machines m
      LEFT JOIN stations s          ON s.id  = m."stationId"
      LEFT JOIN production_lines pl ON pl.id = s."lineId"
      LEFT JOIN workshops w         ON w.id  = pl."workshopId"
      LEFT JOIN factories f         ON f.id  = w."factoryId"
      LEFT JOIN machine_positions mp ON mp."machineId" = m.id
     ORDER BY m.id
  `;

  const phanBo: Record<LyDo, number[]> = {
    he_b: [], he_a: [], khong_toa_do: [], dut_phan_cap: [],
  };
  for (const m of mays) phanBo[phanLoaiMay(m)].push(m.id);

  const [{ tongMay, mayActive }] = await sql<{ tongMay: number; mayActive: number }[]>`
    SELECT count(*)::int AS "tongMay",
           count(*) FILTER (WHERE "isActive")::int AS "mayActive"
      FROM machines
  `;

  // ── CẦU CHÌ 1: bốn nhóm phải cộng đúng TỔNG (mô hình rời nhau) ────────────
  // `mays` có thể có NHIỀU hàng một máy nếu machine_positions có bản ghi trùng —
  // câu này bắt điều đó, thay vì âm thầm đếm thừa.
  const tongPhanBo = Object.values(phanBo).reduce((s, a) => s + a.length, 0);
  if (tongPhanBo !== tongMay) {
    console.error("");
    console.error(`  ✗ DUNG: phan bo cong duoc ${tongPhanBo} nhung machines co ${tongMay} hang.`);
    console.error("    Nguyen nhan thuong gap: machine_positions co NHIEU hang cho MOT may");
    console.error("    (JOIN nhan ban). Sua du lieu truoc khi di tru.");
    await sql.end();
    process.exit(1);
  }

  // ── BƯỚC 1: khung tối thiểu — mỗi nhà máy CÓ MÁY được 1 toà + 1 tầng ──────
  const nhaMayCoMay = [
    ...new Map(
      mays.filter((m) => m.factoryId !== null)
          .map((m) => [m.factoryId!, m.factoryCode ?? String(m.factoryId)]),
    ).entries(),
  ].sort((a, b) => a[0] - b[0]);

  tieuDe("BUOC 1 — khung toi thieu (1 toa nha + 1 tang moi nha may co may)");
  const tangTheoNhaMay = new Map<number, { tangId: number; rongMm: number; sauMm: number }>();

  for (const [factoryId, code] of nhaMayCoMay) {
    const soMay = mays.filter((m) => m.factoryId === factoryId).length;
    if (CHI_DO) {
      console.log(`  [KHO] nha may ${factoryId} (${code}) — ${soMay} may → se tao 1 toa + 1 tang`);
      continue;
    }
    // Idempotent: mã toà nhà ỔN ĐỊNH theo factoryId (không timestamp/random), nên
    // chạy N lần để lại TỐI ĐA một toà — khuôn "tìm-trước-khi-tạo" của BG-93/0349.
    const maToa = `TN-DITRU-${factoryId}`;
    const [toa] = await sql<{ id: number }[]>`
      INSERT INTO twin_toa_nha ("factoryId", ma, ten, nguon)
      VALUES (${factoryId}, ${maToa}, ${"Toa nha " + code}, 'sinh')
      ON CONFLICT ("factoryId", ma) DO UPDATE SET "updatedAt" = now()
      RETURNING id
    `;
    // ⚠ daiMm/rongMm CỐ Ý để NULL — CẤM di trú floorWidthM/floorDepthM (§10A.0).
    const [tang] = await sql<{ id: number }[]>`
      INSERT INTO twin_tang ("toaNhaId", "capSo", ten, "nguonHinhHoc", nguon)
      VALUES (${toa.id}, 1, 'Tang tret', 'sinh', 'sinh')
      ON CONFLICT ("toaNhaId", "capSo") DO UPDATE SET "updatedAt" = now()
      RETURNING id
    `;
    const [kt] = await sql<{ rongMm: string; sauMm: string }[]>`
      SELECT "rongMm", "sauMm" FROM twin_toa_nha WHERE id = ${toa.id}
    `;
    tangTheoNhaMay.set(factoryId, {
      tangId: tang.id,
      rongMm: Number(kt.rongMm),
      sauMm: Number(kt.sauMm),
    });
    console.log(`  ✓ nha may ${factoryId} (${code}) — ${soMay} may → toa #${toa.id}, tang #${tang.id}`);
  }

  // ── BƯỚC 2: di trú vị trí ────────────────────────────────────────────────
  tieuDe("BUOC 2 — di tru vi tri (uu tien he B pixel, roi he A 0-1)");
  let daGhi = 0;
  let boQuaVìTay = 0;

  if (!CHI_DO) {
    for (const m of mays) {
      const lyDo = phanLoaiMay(m);
      if (lyDo === "khong_toa_do" || lyDo === "dut_phan_cap") continue;
      const tang = tangTheoNhaMay.get(m.factoryId!);
      if (!tang) continue;
      const toaDo = quyDoiMm(m, lyDo, TI_LE_PX_MM, tang.rongMm, tang.sauMm);
      if (!toaDo) continue;

      // ★ NT-4: KHÔNG đè hàng người dùng đã chỉnh tay (nguon='tay'). Câu UPDATE có
      //   WHERE nguon='sinh' — nên chạy lại script sau khi kỹ thuật đã kéo máy vào
      //   đúng chỗ sẽ KHÔNG xoá công của họ.
      const kq = await sql`
        INSERT INTO twin_dat_cho (
          "tangId","loaiThucThe","thucTheId","viTriXMm","viTriYMm","viTriZMm",
          "rongMm","caoMm","sauMm","kichThuocDaDo",nguon
        ) VALUES (
          ${tang.tangId}, 'machine', ${m.id}, ${toaDo.xMm}, ${toaDo.yMm}, 0,
          ${MAC_DINH_RONG_MM}, ${MAC_DINH_CAO_MM}, ${MAC_DINH_SAU_MM}, false, 'sinh'
        )
        ON CONFLICT ("loaiThucThe","thucTheId") DO UPDATE SET
          "tangId"    = EXCLUDED."tangId",
          "viTriXMm"  = EXCLUDED."viTriXMm",
          "viTriYMm"  = EXCLUDED."viTriYMm",
          "updatedAt" = now()
        WHERE twin_dat_cho.nguon = 'sinh'
        RETURNING id
      `;
      if (kq.length > 0) daGhi++;
      else boQuaVìTay++;
    }
  }
  console.log(`  he B (pixel × ${TI_LE_PX_MM} mm): ${phanBo.he_b.length} may`);
  console.log(`  he A (0-1 × kich thuoc tang):    ${phanBo.he_a.length} may`);
  console.log(CHI_DO ? "  [KHO] khong ghi hang nao." : `  ✓ da ghi/cap nhat: ${daGhi}   bo qua vi nguon='tay': ${boQuaVìTay}`);

  // ── BƯỚC 3: ĐỐI SOÁT BẮT BUỘC — dừng nếu lệch ────────────────────────────
  tieuDe("BUOC 3 — DOI SOAT (dung neu lech)");
  const khongViTri = phanBo.khong_toa_do.length + phanBo.dut_phan_cap.length;
  console.log(`  May trong DB:                 ${tongMay}`);
  console.log(`  May isActive:                 ${mayActive}`);
  console.log(`  Da co vi tri (he B):          ${phanBo.he_b.length}`);
  console.log(`  Chi co he A (khong he B):     ${phanBo.he_a.length}`);
  console.log(`  Hop nhat duoc (N):            ${phanBo.he_b.length + phanBo.he_a.length}`);
  console.log(`  Khong co vi tri nao:          ${khongViTri}`);
  console.log(`     ├─ co nha may, thieu toa do: ${phanBo.khong_toa_do.length}  ids=[${phanBo.khong_toa_do.join(",")}]`);
  console.log(`     └─ DUT PHAN CAP (khong ro nha may): ${phanBo.dut_phan_cap.length}  ids=[${phanBo.dut_phan_cap.join(",")}]`);
  console.log("");
  console.log(`  ★ So "Khong co vi tri nao" = ${khongViTri} PHAI KHOP so may hien o`);
  console.log(`    "khu cho xep cho" tren UI. Do la phep do THU HAI, tren mo hinh khac.`);

  // Mô hình 2: đếm từ chính bảng đích, KHÔNG dùng lại biến đếm ở trên.
  const [{ trongDb }] = await sql<{ trongDb: number }[]>`
    SELECT count(*)::int AS "trongDb" FROM twin_dat_cho WHERE "loaiThucThe" = 'machine'
  `;
  const duKien = phanBo.he_b.length + phanBo.he_a.length;
  console.log("");
  console.log(`  Hang twin_dat_cho (machine) trong DB: ${trongDb}   [du kien ${duKien}]`);

  let loi = 0;
  if (phanBo.he_b.length + phanBo.he_a.length + khongViTri !== tongMay) {
    console.error(`  ✗ LECH: N + khong-vi-tri ≠ tong may.`);
    loi++;
  }
  if (!CHI_DO && trongDb !== duKien) {
    console.error(`  ✗ LECH: bang dich co ${trongDb} hang, du kien ${duKien}.`);
    console.error(`    (Neu ban da chinh tay mot so may — nguon='tay' — con so nay VAN phai khop,`);
    console.error(`     vi hang cu khong bi xoa, chi khong bi ghi de.)`);
    loi++;
  }

  // ── CẦU CHÌ 2: chưa ai lách luật §10A.0 ──────────────────────────────────
  const tangRac = await sql<{ id: number; daiMm: string | null; rongMm: string | null }[]>`
    SELECT id, "daiMm", "rongMm" FROM twin_tang
     WHERE "daiMm"::numeric  = ANY(${RAC_FLOOR_MM}::numeric[])
        OR "rongMm"::numeric = ANY(${RAC_FLOOR_MM}::numeric[])
  `;
  if (tangRac.length > 0) {
    console.error("");
    console.error(`  ✗ ★★★ VI PHAM §10A.0: ${tangRac.length} hang twin_tang mang dung gia tri RAC`);
    console.error(`    cua factories.floorWidthM/floorDepthM (1.500.000 / 1.200.000 mm = 1,5 km).`);
    console.error(`    ids = [${tangRac.map((t) => t.id).join(",")}]`);
    loi++;
  } else {
    console.log(`  ✓ §10A.0: 0 hang twin_tang mang gia tri rac 1.500.000/1.200.000 mm.`);
  }

  // ── CẦU CHÌ 3: mọi hàng di trú phải tự khai là giả định ──────────────────
  const [{ saiCo }] = await sql<{ saiCo: number }[]>`
    SELECT count(*)::int AS "saiCo" FROM twin_dat_cho
     WHERE "loaiThucThe" = 'machine' AND nguon = 'sinh' AND "kichThuocDaDo" = true
  `;
  if (saiCo > 0) {
    console.error(`  ✗ ${saiCo} hang nguon='sinh' nhung kichThuocDaDo=true — so sinh dang gia vo la so do.`);
    loi++;
  } else {
    console.log(`  ✓ NT-4: 0 hang nguon='sinh' tu nhan la da do.`);
  }

  console.log("");
  if (loi > 0) {
    console.error(`  ✗ DOI SOAT KHONG DAT — ${loi} sai lech. DUNG.`);
    await sql.end();
    process.exit(1);
  }
  console.log(`  ✓ DOI SOAT DAT.`);
  console.log("");
  await sql.end();
}

main().catch(async (e) => {
  console.error("LOI:", e?.message ?? e);
  try { await sql.end(); } catch { /* đã đóng */ }
  process.exit(1);
});
