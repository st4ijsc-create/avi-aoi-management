#!/usr/bin/env -S npx tsx
/**
 * sua-toa-nha-mat-bang-vo-ly.mts — **SỬA MẶT BẰNG TOÀ NHÀ DO BỘ SINH LẤY NHẦM PHẠM VI.**
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ KHUYẾT TẬT — ĐO ĐƯỢC 2026-09-21
 * ════════════════════════════════════════════════════════════════════════════
 * `twin_toa_nha` có toà **90** (`FUYU-F-TN1`, *"FUYU-F (tai tong hop) — toa chinh"*, `nguon`
 * = `sinh`) khai mặt bằng **3.000.000 × 2.000.000 mm = 3 km × 2 km**. Không toà nhà nào dài
 * 3 km; đây gần như chắc chắn là bộ sinh lấy **phạm vi khuôn viên** làm mặt bằng toà.
 *
 * Hậu quả đo được: chính nó tạo ra tỉ số cạnh **78:1** trên tập `qatd_admin`, và tỉ số ấy là
 * lý do sa bàn tập đoàn phải **ước lệ mặt bằng** (vẽ mọi toà cùng một cỡ) — một sự ước lệ mà
 * banner phải đứng ra khai với người dùng.
 *
 * ⚠ Nó **KHÔNG** ảnh hưởng tiêu chí 24 px (đo: bỏ toà này ra vẫn đúng 13/14, vì mặt bằng vốn
 *   đã được chuẩn hoá về TRUNG VỊ nên một ngoại lai không kéo được trung vị). Sửa nó là sửa
 *   **nguyên nhân gốc của việc phải ước lệ**, không phải sửa để đạt một con số.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ CHỈ SỬA MẶT BẰNG — KHÔNG ĐỤNG CHIỀU CAO
 * ════════════════════════════════════════════════════════════════════════════
 * Chiều cao 25 m là một con số **hợp lý** và không có dấu hiệu sai. Đặt nó về "chuẩn QATD
 * 42 m" là **bịa** một con số cho khớp cái nhìn — đúng lớp *"sửa đề thi cho khớp bài làm"* mà
 * dự án này đã bác hai lần. Mặt bằng lấy **trung vị của các toà còn lại**, không lấy một hằng
 * viết tay: trung vị là con số đã có mặt trong dữ liệu, không phải ý kiến của tôi.
 *
 * ⚠ ĐẢO NGƯỢC ĐƯỢC: kịch bản in **nguyên văn giá trị cũ** trước khi ghi. Chép lại dòng ấy là
 *   đủ để khôi phục.
 * ⚠ Chủ dự án đã duyệt (2026-09-21) sau khi được trình số đo. Quy ước của dự án: **báo trước
 *   khi seed lại**, vì phiên khác có thể đang giữ bằng chứng đo trên chính tập dữ liệu này.
 *
 * Chạy:  npx tsx scripts/sua-toa-nha-mat-bang-vo-ly.mts          (chỉ XEM, không ghi)
 *        npx tsx scripts/sua-toa-nha-mat-bang-vo-ly.mts --sua    (ghi thật)
 */
import postgres from "postgres";

/** Mặt bằng lớn hơn ngưỡng này thì không còn là một toà nhà — nó là một khuôn viên. */
const NGUONG_VO_LY_MM = 1_000_000; // 1 km

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Thiếu DATABASE_URL.");
  process.exit(1);
}
const sua = process.argv.includes("--sua");
const sql = postgres(url, { max: 1, connect_timeout: 30, onnotice: () => {} });

try {
  const tatCa = await sql<
    { id: number; ma: string; ten: string; rongMm: string; sauMm: string; caoMm: string }[]
  >`SELECT id, ma, ten, "rongMm", "sauMm", "caoMm" FROM twin_toa_nha WHERE "isActive" = true ORDER BY id`;

  const voLy = tatCa.filter(
    (b) => Number(b.rongMm) > NGUONG_VO_LY_MM || Number(b.sauMm) > NGUONG_VO_LY_MM,
  );
  const lanhManh = tatCa.filter((b) => !voLy.includes(b));

  console.log(`toà đang hoạt động: ${tatCa.length} · vô lý (> ${NGUONG_VO_LY_MM / 1000} m): ${voLy.length}`);
  if (voLy.length === 0) {
    console.log("Không có toà nào cần sửa.");
    await sql.end();
    process.exit(0);
  }
  if (lanhManh.length === 0) {
    console.error("MỌI toà đều vô lý ⇒ không có trung vị lành mạnh để lấy. DỪNG, không đoán.");
    await sql.end();
    process.exit(1);
  }

  const trungVi = (xs: number[]) => {
    const a = [...xs].sort((p, q) => p - q);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  const rongMoi = Math.round(trungVi(lanhManh.map((b) => Number(b.rongMm))));
  const sauMoi = Math.round(trungVi(lanhManh.map((b) => Number(b.sauMm))));
  console.log(`trung vị của ${lanhManh.length} toà lành mạnh: ${rongMoi} × ${sauMoi} mm`);

  for (const b of voLy) {
    console.log(
      `\n  toà ${b.id} (${b.ma}) "${b.ten}"\n` +
        `    CŨ : rongMm=${b.rongMm}  sauMm=${b.sauMm}  caoMm=${b.caoMm}   ← chép dòng này để khôi phục\n` +
        `    MỚI: rongMm=${rongMoi}  sauMm=${sauMoi}  caoMm=${b.caoMm} (GIỮ NGUYÊN)`,
    );
    if (sua) {
      await sql`UPDATE twin_toa_nha SET "rongMm" = ${rongMoi}, "sauMm" = ${sauMoi}, "updatedAt" = now() WHERE id = ${b.id}`;
      console.log(`    ⇒ ĐÃ GHI.`);
    }
  }
  console.log(sua ? "\nXong — đã ghi." : "\nCHƯA ghi gì (thêm --sua để ghi thật).");
} catch (e) {
  console.error("LỖI:", String(e).slice(0, 300));
  process.exitCode = 1;
}
await sql.end();
