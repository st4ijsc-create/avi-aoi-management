#!/usr/bin/env -S npx tsx
/**
 * ra-soat-du-lieu-twin.mts — **RÀ SOÁT TÍNH HỢP LÝ CỦA DỮ LIỆU HÌNH HỌC TWIN.**
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO CÓ KỊCH BẢN NÀY
 * ════════════════════════════════════════════════════════════════════════════
 * Ngày 2026-09-21 tìm ra `twin_toa_nha` id=90 khai mặt bằng **3.000.000 × 2.000.000 mm = 3 km**
 * (bộ sinh lấy phạm vi khuôn viên làm mặt bằng toà). Nó sống sót vì **không ai từng hỏi dữ liệu
 * một câu hỏi vật lý** — mọi lưới kiểm đều canh *hàm* chứ không canh *số*.
 *
 * > Một giá trị vô lý lọt được thì gần như chắc chắn còn giá trị vô lý khác cùng nguồn.
 *
 * ⇒ Kịch bản này hỏi những câu mà một người đứng trong nhà máy sẽ hỏi: toà nhà có dài 3 km
 *   không, tầng có nằm cao hơn nóc không, máy có nằm ngoài sàn không.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ NGUYÊN TẮC
 * ════════════════════════════════════════════════════════════════════════════
 * · **CHỈ ĐỌC.** Không sửa gì. Sửa là việc của kịch bản riêng, có duyệt riêng.
 * · Mỗi phép kiểm nêu **ngưỡng và lý do vật lý**, không phải một con số nhặt đại.
 * · In **số lượng + tối đa 5 ví dụ** để người đọc tự truy, không in cả bảng.
 * · Thoát mã 1 khi có phát hiện ⇒ cắm được vào CI sau này mà không phải đọc chữ.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ TẬP RỖNG KHÔNG PHẢI LÀ "ĐẠT" — G146
 * ════════════════════════════════════════════════════════════════════════════
 * Dự án này đã trả giá cho `every()` trên tập rỗng (**xanh giả**). Mười hai phép kiểm dưới đây
 * đều có dạng *"tìm hàng vi phạm"*, nên trên một CSDL **không có dữ liệu Twin** chúng trả 0 hàng
 * và in **xanh hết** — trong khi chúng **chưa bác bỏ được gì**.
 *
 * ⚠ Và đó chính là trạng thái của CI hôm nay: job `db-sync-build` dựng Postgres mới + `db:push`
 *   (chỉ lược đồ, **không seed**), còn job E2E **không có CSDL nào**. Cắm kịch bản này vào CI mà
 *   không nói ra điều ấy là tự tạo một dấu xanh **không đo gì** — đúng thứ skill PDCA gọi là
 *   *chỉ số THAY THẾ*.
 *
 * ⇒ Kịch bản **tự khai** khi tập rỗng, và nói rõ nó còn chứng minh được cái gì:
 *   · **trên CSDL rỗng** — 12 truy vấn vẫn chạy ⇒ đây là **canh gác TRÔI LƯỢC ĐỒ**: đổi tên một
 *     cột/bảng là đỏ ngay. Nó KHÔNG nói gì về chất lượng dữ liệu.
 *   · **có dữ liệu** — mới là phép kiểm dữ liệu thật.
 *   · `--yeu-cau-du-lieu` ⇒ tập rỗng là **ĐỎ** (dùng ở máy có dữ liệu thật, nơi rỗng = sự cố).
 *
 * Chạy:  DATABASE_URL=... npx tsx scripts/do-twin/ra-soat-du-lieu-twin.mts
 *        … --yeu-cau-du-lieu     (bắt buộc phải có dữ liệu, rỗng là lỗi)
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Thiếu DATABASE_URL.");
  process.exit(1);
}
const sql = postgres(url, { max: 1, connect_timeout: 30, onnotice: () => {} });
const yeuCauDuLieu = process.argv.includes("--yeu-cau-du-lieu");

let soPhatHien = 0;

function bao(ma: string, cau: string, nguong: string, hang: unknown[]) {
  if (hang.length === 0) {
    console.log(`  ✅ ${ma}  ${cau}`);
    return;
  }
  soPhatHien += hang.length;
  console.log(`  ❌ ${ma}  ${cau}`);
  console.log(`      ngưỡng: ${nguong}`);
  console.log(`      ${hang.length} hàng; ví dụ:`);
  for (const h of hang.slice(0, 5)) console.log(`        ${JSON.stringify(h)}`);
}

try {
  /*
   * ── ĐẾM TRƯỚC, RÀ SAU. Không có số này thì mọi dấu ✅ bên dưới đều mơ hồ. ──
   */
  const [{ toa, tang, dat, vat }] = await sql<
    { toa: number; tang: number; dat: number; vat: number }[]
  >`SELECT (SELECT count(*) FROM twin_toa_nha WHERE "isActive")::int AS toa,
           (SELECT count(*) FROM twin_tang WHERE "isActive")::int AS tang,
           (SELECT count(*) FROM twin_dat_cho WHERE "hienThi")::int AS dat,
           (SELECT count(*) FROM twin_vat_the WHERE "hienThi")::int AS vat`;
  const rong = toa === 0 && tang === 0;
  console.log(`tập đang rà: ${toa} toà · ${tang} tầng · ${dat} đặt chỗ · ${vat} vật thể`);
  if (rong) {
    console.log(
      "⚠⚠ TẬP RỖNG — 12 phép kiểm dưới đây KHÔNG CÓ GÌ ĐỂ BÁC BỎ.\n" +
        "   Dấu ✅ ở đây chỉ chứng minh **lược đồ còn khớp** (truy vấn chạy được),\n" +
        "   KHÔNG chứng minh gì về chất lượng dữ liệu. Đừng đọc nó thành 'dữ liệu sạch'.",
    );
    if (yeuCauDuLieu) {
      console.error("\n❌ `--yeu-cau-du-lieu`: tập rỗng là LỖI ở môi trường này.");
      await sql.end();
      process.exit(1);
    }
  }
  console.log("");

  console.log("══ A. TOÀ NHÀ (twin_toa_nha) ══");

  /*
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ A1 — BẢN ĐẦU HỎI SAI CÂU, VÀ NÓ ĐÃ LÀM TÔI PHÁ MỘT TẬP DỮ LIỆU ĐÚNG
   * ════════════════════════════════════════════════════════════════════════
   * Bản đầu chỉ hỏi *"cạnh có > 1 km không"*. Toà 90 (`FUYU-F-TN1`) vượt ngưỡng, tôi gọi nó
   * là lỗi bộ sinh, trình chủ dự án, được duyệt, và **đã sửa**. Rồi chính kịch bản này bắt
   * được hậu quả ở phép kiểm **B4**: ba tầng của nó vẫn 3.000 × 2.000 m.
   *
   * Đo tiếp mới ra sự thật: ba tầng ấy đang giữ **1.119 đặt chỗ** trải tới
   * **x = 1.500 m, y = 1.000 m**. Tức 3 km **không phải một con số rác** — cả nhà máy
   * FUYU-F được mô hình hoá thành MỘT khối gộp ("tải tổng hợp"), và toà + tầng + đặt chỗ
   * **nhất quán với nhau**. Bản vá của tôi mới là thứ làm chúng lệch nhau.
   * ⇒ Đã hoàn nguyên toà 90 về 3.000.000 × 2.000.000 mm.
   *
   * ★ Câu hỏi đúng không phải *"có to quá không"* mà là **"có NHẤT QUÁN không"**: một toà to
   *   bất thường mà tầng và đặt chỗ cũng trải đúng cỡ ấy thì nó là một **mô hình gộp**, không
   *   phải một lỗi. Còn một toà to mà bên trong trống trơn thì mới đáng ngờ.
   *
   * ⚠ Và đây là lý do phải hỏi đúng câu: một cảnh báo LUÔN kêu thì không ai nghe — dự án này
   *   đã học đúng bài ấy một lần ở `BUILD-INFO` (đếm cả tệp ngoài sổ ⇒ `sach=false` vĩnh viễn).
   */
  bao(
    "A1",
    "toà nhà to bất thường MÀ bên trong KHÔNG trải tương ứng",
    "cạnh > 1.000 m nhưng không tầng nào của nó rộng quá 1/2 cỡ ấy ⇒ con số không có gì đỡ",
    await sql`SELECT b.id, b.ma, b."rongMm", b."sauMm",
                     max(t."daiMm") AS tang_dai_max, max(t."rongMm") AS tang_rong_max
      FROM twin_toa_nha b LEFT JOIN twin_tang t ON t."toaNhaId" = b.id AND t."isActive"
      WHERE b."isActive" AND (b."rongMm" > 1000000 OR b."sauMm" > 1000000)
      GROUP BY b.id, b.ma, b."rongMm", b."sauMm"
      HAVING coalesce(max(t."daiMm"), 0) < b."rongMm" / 2
          OR coalesce(max(t."rongMm"), 0) < b."sauMm" / 2
      ORDER BY b.id`,
  );

  // ── Ghi chú, KHÔNG phải lỗi: toà to bất thường nhưng bên trong trải đúng cỡ ấy ──
  const gop = await sql`SELECT b.id, b.ma, b."rongMm", b."sauMm",
      count(DISTINCT t.id)::int AS so_tang, count(dc.*)::int AS so_dat_cho
    FROM twin_toa_nha b
    LEFT JOIN twin_tang t ON t."toaNhaId" = b.id AND t."isActive"
    LEFT JOIN twin_dat_cho dc ON dc."tangId" = t.id AND dc."hienThi"
    WHERE b."isActive" AND (b."rongMm" > 1000000 OR b."sauMm" > 1000000)
    GROUP BY b.id, b.ma, b."rongMm", b."sauMm" ORDER BY b.id`;
  for (const g of gop as unknown as Record<string, unknown>[]) {
    console.log(
      `  ℹ  MÔ HÌNH GỘP: toà ${g.id} (${g.ma}) ${Number(g.rongMm) / 1000} × ${Number(g.sauMm) / 1000} m — ` +
        `${g.so_tang} tầng, ${g.so_dat_cho} đặt chỗ. To bất thường nhưng NHẤT QUÁN ⇒ không phải lỗi.`,
    );
  }

  bao(
    "A2",
    "chiều cao ngoài khoảng vật lý",
    "cao < 3 m (không chui lọt) hoặc > 300 m (cao hơn mọi nhà xưởng)",
    await sql`SELECT id, ma, "caoMm" FROM twin_toa_nha
      WHERE "isActive" AND ("caoMm" < 3000 OR "caoMm" > 300000) ORDER BY id`,
  );

  bao(
    "A3",
    "toạ độ đặt toà xa gốc khuôn viên một cách vô lý",
    "|x| hoặc |y| > 50 km",
    await sql`SELECT id, ma, "viTriXMm", "viTriYMm" FROM twin_toa_nha
      WHERE "isActive" AND (abs("viTriXMm") > 50000000 OR abs("viTriYMm") > 50000000) ORDER BY id`,
  );

  bao(
    "A4",
    "hai toà CÙNG nhà máy chồng lấn mặt bằng",
    "hai hình chữ nhật giao nhau thực sự (không tính chạm mép)",
    await sql`SELECT a.id AS toa_a, b.id AS toa_b, a."factoryId"
      FROM twin_toa_nha a JOIN twin_toa_nha b
        ON a."factoryId" = b."factoryId" AND a.id < b.id
      WHERE a."isActive" AND b."isActive"
        AND a."viTriXMm" < b."viTriXMm" + b."rongMm" AND b."viTriXMm" < a."viTriXMm" + a."rongMm"
        AND a."viTriYMm" < b."viTriYMm" + b."sauMm" AND b."viTriYMm" < a."viTriYMm" + a."sauMm"
      ORDER BY a.id, b.id`,
  );

  console.log("\n══ B. TẦNG (twin_tang) ══");

  bao(
    "B1",
    "hai tầng CÙNG toà ở CÙNG cao độ",
    "trùng `caoDoMm` trong một `toaNhaId` — hai sàn không thể chồng khít nhau",
    await sql`SELECT "toaNhaId", "caoDoMm", count(*)::int AS so, array_agg(id ORDER BY id) AS ids
      FROM twin_tang WHERE "isActive" GROUP BY "toaNhaId", "caoDoMm" HAVING count(*) > 1
      ORDER BY "toaNhaId"`,
  );

  bao(
    "B2",
    "cao độ KHÔNG tăng theo số tầng",
    "tầng trên phải cao hơn tầng dưới trong cùng một toà",
    await sql`SELECT t1."toaNhaId", t1.id AS duoi, t1."capSo" AS cap_duoi, t1."caoDoMm" AS cao_duoi,
                     t2.id AS tren, t2."capSo" AS cap_tren, t2."caoDoMm" AS cao_tren
      FROM twin_tang t1 JOIN twin_tang t2
        ON t1."toaNhaId" = t2."toaNhaId" AND t1."capSo" < t2."capSo"
      WHERE t1."isActive" AND t2."isActive" AND t2."caoDoMm" <= t1."caoDoMm"
      ORDER BY t1."toaNhaId", t1."capSo"`,
  );

  bao(
    "B3",
    "sàn tầng nằm CAO HƠN nóc toà",
    "`caoDoMm` của tầng > `caoMm` của chính toà chứa nó",
    await sql`SELECT t.id AS tang, t."toaNhaId", t."caoDoMm", b."caoMm" AS cao_toa
      FROM twin_tang t JOIN twin_toa_nha b ON b.id = t."toaNhaId"
      WHERE t."isActive" AND b."isActive" AND t."caoDoMm" > b."caoMm" ORDER BY t.id`,
  );

  bao(
    "B4",
    "mặt sàn LỚN HƠN mặt bằng toà",
    "`daiMm`/`rongMm` của tầng vượt mặt bằng toà quá 1 % (chừa sai số làm tròn)",
    await sql`SELECT t.id AS tang, t."toaNhaId", t."daiMm", t."rongMm", b."rongMm" AS toa_rong, b."sauMm" AS toa_sau
      FROM twin_tang t JOIN twin_toa_nha b ON b.id = t."toaNhaId"
      WHERE t."isActive" AND b."isActive" AND t."daiMm" IS NOT NULL AND t."rongMm" IS NOT NULL
        AND (t."daiMm" > b."rongMm" * 1.01 OR t."rongMm" > b."sauMm" * 1.01)
      ORDER BY t.id`,
  );

  console.log("\n══ C. ĐẶT CHỖ (twin_dat_cho) ══");

  bao(
    "C1",
    "kích thước không dương",
    "rộng/cao/sâu ≤ 0 — một vật thể không có bề thì không vẽ được",
    await sql`SELECT id, "tangId", "loaiThucThe", "rongMm", "caoMm", "sauMm" FROM twin_dat_cho
      WHERE "hienThi" AND ("rongMm" <= 0 OR "caoMm" <= 0 OR "sauMm" <= 0) ORDER BY id`,
  );

  bao(
    "C2",
    "vật thể nằm NGOÀI mặt sàn của tầng chứa nó",
    "tâm vật thể ra ngoài [0, daiMm] × [0, rongMm] của tầng",
    await sql`SELECT d.id, d."tangId", d."loaiThucThe", d."viTriXMm", d."viTriYMm", t."daiMm", t."rongMm"
      FROM twin_dat_cho d JOIN twin_tang t ON t.id = d."tangId"
      WHERE d."hienThi" AND t."isActive" AND t."daiMm" IS NOT NULL AND t."rongMm" IS NOT NULL
        AND (d."viTriXMm" < 0 OR d."viTriYMm" < 0 OR d."viTriXMm" > t."daiMm" OR d."viTriYMm" > t."rongMm")
      ORDER BY d.id`,
  );

  bao(
    "C3",
    "đặt chỗ trỏ tới tầng không còn hoạt động / không tồn tại",
    "`tangId` không khớp một `twin_tang.isActive`",
    await sql`SELECT d.id, d."tangId", d."loaiThucThe" FROM twin_dat_cho d
      LEFT JOIN twin_tang t ON t.id = d."tangId" AND t."isActive"
      WHERE d."hienThi" AND t.id IS NULL ORDER BY d.id`,
  );

  console.log("\n══ D. VẬT THỂ (twin_vat_the) ══");

  bao(
    "D1",
    "kích thước không dương",
    "rộng/cao/sâu ≤ 0",
    await sql`SELECT id, "tangId", loai, "rongMm", "caoMm", "sauMm" FROM twin_vat_the
      WHERE "hienThi" AND ("rongMm" <= 0 OR "caoMm" <= 0 OR "sauMm" <= 0) ORDER BY id`,
  );

  bao(
    "D2",
    "vật thể nằm NGOÀI mặt sàn",
    "tâm ra ngoài [0, daiMm] × [0, rongMm] của tầng",
    await sql`SELECT v.id, v."tangId", v.loai, v."viTriXMm", v."viTriYMm", t."daiMm", t."rongMm"
      FROM twin_vat_the v JOIN twin_tang t ON t.id = v."tangId"
      WHERE v."hienThi" AND t."isActive" AND t."daiMm" IS NOT NULL AND t."rongMm" IS NOT NULL
        AND (v."viTriXMm" < 0 OR v."viTriYMm" < 0 OR v."viTriXMm" > t."daiMm" OR v."viTriYMm" > t."rongMm")
      ORDER BY v.id`,
  );

  console.log(
    soPhatHien > 0
      ? `\n❌ TỔNG ${soPhatHien} hàng đáng ngờ — xem từng mã ở trên.`
      : rong
        ? "\n⚠ KHÔNG CHẠY ĐƯỢC PHÉP KIỂM DỮ LIỆU (tập rỗng) — chỉ xác nhận LƯỢC ĐỒ còn khớp."
        : "\n✅ KHÔNG phát hiện giá trị vô lý nào.",
  );
  process.exitCode = soPhatHien === 0 ? 0 : 1;
} catch (e) {
  console.error("LỖI:", String(e).slice(0, 400));
  process.exitCode = 2;
}
await sql.end();
