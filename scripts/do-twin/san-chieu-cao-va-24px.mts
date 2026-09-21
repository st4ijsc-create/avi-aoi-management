/**
 * v7-san-cao.mts — SÀN CHIỀU CAO BIỂU TƯỢNG phải là bao nhiêu để đạt 24 px?
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ CHẨN ĐOÁN CŨ CỦA TÔI SAI — VÀ DỮ LIỆU THẬT LẬT NÓ
 * ════════════════════════════════════════════════════════════════════════════
 * Vòng 4 tôi kết luận *"biểu tượng nhỏ nhất là biểu tượng XA NHẤT; phối cảnh nghiêng ~62° nén
 * trục sâu"* rồi thử hai đòn bẩy **khung nhìn** (góc camera, khe cụm) và bác cả hai.
 * Đọc `twin_toa_nha` thì ra chuyện khác:
 *
 *   toà  24 (nm  1)   38,4 × 29,6 m   cao **8 m**    ← chính là cái 21,7 px
 *   toà  90 (nm 47) 3.000 × 2.000 m   cao **25 m**
 *   toà  91…102      110 × 80 m       cao **42 m**   (12 toà chuẩn QATD)
 *
 * `saBanTapDoan` chuẩn hoá **MẶT BẰNG** về trung vị (mọi biểu tượng cùng 110 × 80 m) nhưng
 * **CHIỀU CAO giữ số thật** — một quyết định CỐ Ý, ghi rõ trong docblock:
 *   *"Chỉ MẶT BẰNG là ước lệ … nói quá thành 'kích thước là ước lệ' cũng là một lời khai sai."*
 * ⇒ Cạnh nhỏ của toà 24 ngắn vì nó **thấp 8 m**, không vì nó ở xa. Khoảng cách chỉ là yếu tố phụ.
 *
 * ★ Và sàn ấy **đã tồn tại**: `BIEU_TUONG_CAO_TOI_THIEU_MM = 6 m`, đặt theo cảm tính
 *   (*"đủ để thấy là khối"*), chưa bao giờ đối chiếu với tiêu chí **24 px** của Task 20.
 *
 * ⇒ Kịch bản này quét sàn ấy trên **dữ liệu THẬT**, qua **chính hàm sản phẩm**, để câu hỏi gửi
 *   chủ dự án có số chứ không có cảm tính: sàn nào đủ, và nó đụng mấy toà trong 14.
 */
import postgres from "postgres";

import {
  hopPxCuaDiem,
  khungNhinCho,
  khungNhinVaoVung,
  vungDungCanvas,
  type HopCanvas,
} from "../../client/src/components/twin3d/van-hanh/phamViCanh";
import {
  BIEU_TUONG_CAO_TOI_THIEU_MM,
  saBanTapDoan,
  type ToaNhaKhuonVien,
} from "../../client/src/components/twin3d/van-hanh/canhTapDoan";
import type { BBox, DiemScene } from "../../client/src/components/twin3d/heToaDo";

const KHUNG = { rongPx: 968, caoPx: 489 }; // vùng canvas thật ở 1280×720
const PHU: HopCanvas[] = [
  { trai: 0, phai: 224, tren: 0, duoi: 489 },
  { trai: 232, phai: 470, tren: 59, duoi: 279 },
  { trai: 400, phai: 704, tren: 59, duoi: 88 },
  { trai: 224, phai: 245, tren: 224, duoi: 266 },
  { trai: 691, phai: 712, tren: 224, duoi: 266 },
  { trai: 0, phai: 968, tren: 451, duoi: 489 },
  { trai: 712, phai: 968, tren: 0, duoi: 489 },
];

const sql = postgres(process.env.DATABASE_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
const hang = await sql<ToaNhaKhuonVien[]>`
  SELECT id, "factoryId", "rongMm", "sauMm", "caoMm", "viTriXMm", "viTriYMm", "viTriZMm"
  FROM twin_toa_nha WHERE "isActive" = true ORDER BY id`;
await sql.end();

const toaNha: ToaNhaKhuonVien[] = hang.map((b) => ({
  id: Number(b.id),
  factoryId: Number(b.factoryId),
  rongMm: Number(b.rongMm),
  sauMm: Number(b.sauMm),
  caoMm: Number(b.caoMm),
  viTriXMm: Number(b.viTriXMm),
  viTriYMm: Number(b.viTriYMm),
  viTriZMm: Number(b.viTriZMm),
}));
console.log(`toà đọc được: ${toaNha.length}`);
console.log(`chiều cao thật (m): ${[...new Set(toaNha.map((b) => b.caoMm / 1000))].sort((a, b) => a - b).join(" · ")}`);

/** Đo cạnh nhỏ nhất trên màn khi ÁP một sàn chiều cao `sanM` (mét). */
function do1(sanM: number) {
  // Áp sàn ngay trên dữ liệu vào — `saBanTapDoan` tự kẹp bằng hằng của nó, nên nâng ở đây
  // cho ra ĐÚNG kết quả mà việc nâng hằng sẽ cho.
  const vao = toaNha.map((b) => ({ ...b, caoMm: Math.max(b.caoMm, sanM * 1000) }));
  const sb = saBanTapDoan(vao);
  if (!sb) return null;
  const hopToa = sb.bieuTuong.map((t) => {
    const d: DiemScene[] = [];
    for (const x of [t.xMm / 1000, (t.xMm + t.rongMm) / 1000])
      for (const y of [0, t.caoMm / 1000])
        for (const z of [t.yMm / 1000, (t.yMm + t.sauMm) / 1000]) d.push({ x, y, z });
    return { toaNhaId: t.toaNhaId, d };
  });
  const diem = hopToa.flatMap((h) => h.d);
  const bbox: BBox = {
    minX: Math.min(...diem.map((p) => p.x)), maxX: Math.max(...diem.map((p) => p.x)),
    minY: Math.min(...diem.map((p) => p.y)), maxY: Math.max(...diem.map((p) => p.y)),
    minZ: Math.min(...diem.map((p) => p.z)), maxZ: Math.max(...diem.map((p) => p.z)),
  };
  const goc = khungNhinCho(bbox, "tapDoan")!;
  const vung = vungDungCanvas(KHUNG.rongPx, KHUNG.caoPx, PHU)!;
  const k = khungNhinVaoVung(diem, goc, KHUNG, vung);
  const canhNho = hopToa.map((h) => {
    const p = hopPxCuaDiem(h.d, k, KHUNG);
    return p ? { toa: h.toaNhaId, v: Math.min(p.phai - p.trai, p.duoi - p.tren) } : null;
  });
  if (canhNho.some((x) => x === null)) return null;
  const vs = canhNho.map((x) => x!.v);
  const min = canhNho.reduce((a, x) => (x!.v < a.v ? x! : a), canhNho[0]!);
  return { min, dat: vs.filter((v) => v >= 24).length, tong: vs.length, lon: Math.max(...vs) };
}

/*
 * ⚠⚠ GIỚI HẠN PHẢI NÓI RA — kịch bản này KHÔNG tái hiện được các hàng DƯỚI sàn hiện hành.
 *   Nó nâng chiều cao ở ĐẦU VÀO, nhưng `saBanTapDoan` còn kẹp lần nữa bằng chính
 *   `BIEU_TUONG_CAO_TOI_THIEU_MM`. Nên mọi `san <` hằng ấy đều cho ra CÙNG một kết quả.
 *   Muốn dựng lại hàng lịch sử (sàn 6 m → 21,7 px → 13/14) thì phải **hạ chính hằng** rồi
 *   dựng lại — tức đúng lượt ABLATION đã chạy và đã ghi trong commit `142e1e76`.
 *   Giấu giới hạn này đi là biến một bảng số thành một bảng trông-như-số.
 */
const HANG = BIEU_TUONG_CAO_TOI_THIEU_MM / 1000;
console.log(`
⚠ sàn ĐANG CÀI trong mã: ${HANG} m — mọi hàng dưới mốc này chỉ lặp lại kết quả của nó.`);
console.log("   (hàng lịch sử sàn 6 m → 21,7 px → 13/14 chỉ dựng lại được bằng ablation: hạ hằng rồi dựng lại)");
console.log("\nsàn(m)  toà nhỏ nhất       cạnh nhỏ   đạt ≥24px   số toà BỊ NÂNG (cao thật < sàn)");
for (const san of [6, 10, 12, 14, 16, 18, 20, 25, 30]) {
  const r = do1(san);
  const biNang = toaNha.filter((b) => b.caoMm < san * 1000).length;
  const duoiHang = san < HANG ? "  ← dưới sàn đang cài, không có nghĩa" : "";
  console.log(
    r
      ? `${String(san).padStart(4)}    toà ${String(r.min.toa).padStart(4)}          ` +
        `${r.min.v.toFixed(1).padStart(6)} px   ${String(r.dat).padStart(2)}/${r.tong}       ` +
        `${String(biNang).padStart(2)}/${toaNha.length}${duoiHang}`
      : `${String(san).padStart(4)}    (không chiếu được)`,
  );
}
