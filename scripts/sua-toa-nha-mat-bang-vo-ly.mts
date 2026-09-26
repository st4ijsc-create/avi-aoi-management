#!/usr/bin/env -S npx tsx
/**
 * sua-toa-nha-mat-bang-vo-ly.mts — **SỬA MẶT BẰNG TOÀ NHÀ DO BỘ SINH LẤY NHẦM PHẠM VI.**
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỌC KHỐI NÀY TRƯỚC KHI CHẠY — LẦN DÙNG ĐẦU TIÊN CỦA NÓ LÀ MỘT SAI LẦM
 * ════════════════════════════════════════════════════════════════════════════
 * 2026-09-21, bản đầu của kịch bản này chỉ hỏi **một** câu: *"cạnh có > 1 km không?"*.
 * `twin_toa_nha` id=90 (`FUYU-F-TN1`) khai 3.000 × 2.000 m ⇒ vượt ngưỡng ⇒ tôi gọi nó là lỗi
 * bộ sinh, trình chủ dự án, được duyệt, và **đã sửa về 110 × 80 m**.
 *
 * Rồi `scripts/do-twin/ra-soat-du-lieu-twin.mts` bắt được hậu quả ở phép kiểm **B4**: ba tầng
 * của toà ấy vẫn 3.000 × 2.000 m. Đo tiếp: ba tầng đang giữ **1.119 đặt chỗ** trải tới
 * **x = 1.500 m, y = 1.000 m**.
 *
 * ⇒ **3 km không phải con số rác.** Cả nhà máy FUYU-F được mô hình hoá thành MỘT khối gộp
 *   ("tải tổng hợp"), và toà + tầng + đặt chỗ **nhất quán với nhau**. Thứ làm chúng lệch nhau
 *   chính là bản vá của tôi. Đã hoàn nguyên.
 *
 * ★★★ BÀI HỌC, NAY LÀ HÀNG RÀO TRONG CHÍNH KỊCH BẢN:
 *   **Một con số chỉ vô lý khi nó KHÔNG ĂN KHỚP với thứ nó chứa.** Đừng phán một cột bằng cách
 *   nhìn riêng cột ấy. Toà to mà bên trong trải đúng cỡ ⇒ mô hình gộp. Toà to mà bên trong
 *   trống trơn ⇒ mới là lỗi.
 *
 * ⇒ Từ nay kịch bản **TỪ CHỐI thu nhỏ** một toà mà tầng hoặc đặt chỗ của nó còn trải ra ngoài
 *   cỡ mới. Muốn thu thật thì phải xử cả cụm (toà + tầng + đặt chỗ) trong một lượt có tính
 *   toán, không phải bằng một lệnh `UPDATE` trên một bảng.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ CÁCH LÀM
 * ════════════════════════════════════════════════════════════════════════════
 * · Mặt bằng mới lấy **trung vị của các toà lành mạnh** — con số đã có trong dữ liệu, không
 *   phải ý kiến của tôi.
 * · **KHÔNG đụng chiều cao.** Đặt nó về "chuẩn" là bịa một con số cho khớp cái nhìn.
 * · In **nguyên văn giá trị cũ** trước khi ghi ⇒ đảo ngược được (chính nhờ dòng ấy mà lần sai
 *   ở trên khôi phục được trong một phút).
 * · Dừng nếu **mọi** toà đều vượt ngưỡng: không còn trung vị lành mạnh nào để lấy ⇒ không đoán.
 *
 * ⚠ Quy ước dự án: **báo trước khi seed lại**, vì phiên khác có thể đang giữ bằng chứng đo trên
 *   chính tập dữ liệu này.
 *
 * Chạy:  npx tsx scripts/sua-toa-nha-mat-bang-vo-ly.mts          (chỉ XEM, không ghi)
 *        npx tsx scripts/sua-toa-nha-mat-bang-vo-ly.mts --sua    (ghi thật)
 */
import postgres from "postgres";

/** Mặt bằng lớn hơn ngưỡng này thì ĐÁNG NGỜ — chưa phải kết luận, xem hàng rào nhất quán. */
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

  const dangNgo = tatCa.filter(
    (b) => Number(b.rongMm) > NGUONG_VO_LY_MM || Number(b.sauMm) > NGUONG_VO_LY_MM,
  );
  const lanhManh = tatCa.filter((b) => !dangNgo.includes(b));

  console.log(
    `toà đang hoạt động: ${tatCa.length} · vượt ngưỡng ${NGUONG_VO_LY_MM / 1000} m: ${dangNgo.length}`,
  );
  if (dangNgo.length === 0) {
    console.log("Không có toà nào cần xét.");
    await sql.end();
    process.exit(0);
  }
  if (lanhManh.length === 0) {
    console.error("MỌI toà đều vượt ngưỡng ⇒ không có trung vị lành mạnh để lấy. DỪNG, không đoán.");
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

  let daGhi = 0;
  for (const b of dangNgo) {
    /*
     * ★★★ HÀNG RÀO NHẤT QUÁN — thứ mà bản đầu KHÔNG có, và thiếu nó tôi đã phá một tập đúng.
     *   Hỏi thẳng: bên trong toà này có gì trải ra ngoài cỡ mới không?
     */
    const [{ tang_dai, tang_rong, dat_x, dat_y, so_tang, so_dat }] = await sql<
      {
        tang_dai: number | null; tang_rong: number | null;
        dat_x: number | null; dat_y: number | null;
        so_tang: number; so_dat: number;
      }[]
    >`SELECT max(t."daiMm")::float AS tang_dai, max(t."rongMm")::float AS tang_rong,
             max(dc."viTriXMm")::float AS dat_x, max(dc."viTriYMm")::float AS dat_y,
             count(DISTINCT t.id)::int AS so_tang, count(dc.*)::int AS so_dat
        FROM twin_tang t
        LEFT JOIN twin_dat_cho dc ON dc."tangId" = t.id AND dc."hienThi"
       WHERE t."toaNhaId" = ${b.id} AND t."isActive"`;

    const vuot: string[] = [];
    if ((tang_dai ?? 0) > rongMoi) vuot.push(`tầng dài ${tang_dai} > ${rongMoi}`);
    if ((tang_rong ?? 0) > sauMoi) vuot.push(`tầng rộng ${tang_rong} > ${sauMoi}`);
    if ((dat_x ?? 0) > rongMoi) vuot.push(`đặt chỗ x tới ${dat_x} > ${rongMoi}`);
    if ((dat_y ?? 0) > sauMoi) vuot.push(`đặt chỗ y tới ${dat_y} > ${sauMoi}`);

    console.log(`\n  toà ${b.id} (${b.ma}) "${b.ten}"`);
    console.log(`    hiện: ${b.rongMm} × ${b.sauMm} mm · ${so_tang} tầng · ${so_dat} đặt chỗ`);

    if (vuot.length > 0) {
      console.log(`    ⛔ BỎ QUA — NHẤT QUÁN, không phải lỗi. Bên trong trải đúng cỡ lớn ấy:`);
      for (const v of vuot) console.log(`         · ${v}`);
      console.log(
        `    ⇒ Đây là MÔ HÌNH GỘP (cả nhà máy vẽ thành một khối). Thu nó về ${rongMoi} × ${sauMoi}`,
      );
      console.log(
        `      sẽ ném ${so_dat} đặt chỗ ra ngoài sàn. Muốn thu thật thì phải xử CẢ CỤM trong một lượt.`,
      );
      continue;
    }

    console.log(
      `    CŨ : rongMm=${b.rongMm}  sauMm=${b.sauMm}  caoMm=${b.caoMm}   ← chép dòng này để khôi phục`,
    );
    console.log(`    MỚI: rongMm=${rongMoi}  sauMm=${sauMoi}  caoMm=${b.caoMm} (GIỮ NGUYÊN)`);
    if (sua) {
      await sql`UPDATE twin_toa_nha SET "rongMm" = ${rongMoi}, "sauMm" = ${sauMoi}, "updatedAt" = now() WHERE id = ${b.id}`;
      daGhi += 1;
      console.log(`    ⇒ ĐÃ GHI.`);
    }
  }
  console.log(
    sua
      ? `\nXong — đã ghi ${daGhi}/${dangNgo.length} toà (số còn lại bị hàng rào nhất quán giữ lại).`
      : "\nCHƯA ghi gì (thêm --sua để ghi thật).",
  );
} catch (e) {
  console.error("LỖI:", String(e).slice(0, 300));
  process.exitCode = 1;
}
await sql.end();
