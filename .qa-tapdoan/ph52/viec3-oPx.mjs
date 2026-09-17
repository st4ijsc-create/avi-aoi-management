/**
 * ph52/viec3-oPx.mjs — VIỆC ③: MỘT Ô LƯỚI RỘNG BAO NHIÊU PIXEL TRÊN MÀN HÌNH?
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ MỘT THƯỚC CỦA TÔI ĐÃ BỊ BÁC BỎ — GHI LẠI TRƯỚC KHI ĐƯA SỐ
 * ════════════════════════════════════════════════════════════════════════════
 * Tôi thử đo bằng TỰ TƯƠNG QUAN trên chính ảnh chụp (`ph52/phoLuoi.mjs`). Nó
 * SAI ở đúng những ca cần đo: khi bước ô nhỏ hơn 1 pixel, thứ còn lại trên ảnh
 * là **vân moiré**, và tự tương quan báo chu kỳ của vân moiré chứ không phải của
 * lưới. Ví dụ vùng FCTD-A (`/factory-command` tập đoàn): tự tương quan đọc đỉnh
 * mạnh nhất ở **11,00 px** trong khi ô lưới thật là ~1 px — tức nếu tin nó thì
 * màn hình này "ĐẠT ≥ 8 px" trong khi mắt thấy một tấm dither.
 *
 * ⇒ Thước dùng được là HÌNH HỌC, và nó được KIỂM CHỨNG trên một ca mà lưới ĐỌC
 *   ĐƯỢC (ở đó tự tương quan đáng tin): `/twin` tập đoàn sau khi cuộn vào
 *   `camXa` = 563,773 — công thức cho 5,23 px ở điểm ngắm, tự tương quan đọc
 *   8,06 px ở vùng lấy mẫu nằm DƯỚI tâm khung (gần camera hơn nên ô to hơn).
 *   Hai số cùng bậc và lệch đúng chiều phối cảnh ⇒ công thức dùng được.
 *
 * Công thức: một mặt phẳng cách camera `d`, camera `fov` dọc, khung cao `H` px
 *     px/mét = H / (2 · d · tan(fov/2))
 * Đây là bước ô TẠI ĐIỂM NGẮM. Phần sàn gần camera hơn thì ô to hơn, xa hơn thì
 * nhỏ hơn — nên con số này là ĐẠI DIỆN, không phải cận trên hay cận dưới.
 */
const FOV = 45;
const K = 2 * Math.tan((FOV / 2 / 180) * Math.PI); // 0,828427

/** Mọi số `camXa` và cỡ canvas dưới đây ĐO SỐNG trên dữ liệu QATD, vai `qatd_admin`. */
const CA = [
  { man: "/factory-command", canh: "tập đoàn (3 công ty)", H: 529, camXa: 1199.094, oM: 2, ghi: "drei Grid `cellSize: 2` HẰNG" },
  { man: "/factory-command", canh: "tập đoàn — đường `section`", H: 529, camXa: 1199.094, oM: 10, ghi: "`sectionSize: 10` HẰNG" },
  { man: "/factory-command", canh: "một nhà máy", H: 529, camXa: 434.741, oM: 2, ghi: "" },
  { man: "/twin (CanhVanHanh)", canh: "tập đoàn", H: 489, camXa: 2005.681, oM: 5, ghi: "`canh/round(canh/5)` ≈ 5 m" },
  { man: "/twin (CanhVanHanh)", canh: "một nhà máy", H: 489, camXa: 106.344, oM: 5, ghi: "" },
  { man: "/twin (CanhVanHanh)", canh: "tập đoàn ĐÃ ZOOM (đối chứng)", H: 489, camXa: 563.773, oM: 5, ghi: "tự tương quan đọc 8,06 px" },
  { man: "/twin-studio", canh: "mặc định", H: 251, camXa: 117.054, oM: 1, ghi: "`canh/round(canh)` ≈ 1 m" },
  { man: "/twin-studio", canh: "trần zoom", H: 251, camXa: 365.199, oM: 1, ghi: "" },
];

const NGUONG_PX = 8;
console.log(
  ["màn", "cảnh", "H px", "camXa m", "ô (m)", "px/mét", "Ô (px)", `≥ ${NGUONG_PX} px?`, "ghi chú"].join(" | "),
);
for (const c of CA) {
  const pxTrenMet = c.H / (K * c.camXa);
  const oPx = c.oM * pxTrenMet;
  console.log(
    [
      c.man,
      c.canh,
      c.H,
      c.camXa,
      c.oM,
      pxTrenMet.toFixed(4),
      oPx.toFixed(2),
      oPx >= NGUONG_PX ? "ĐẠT" : "KHÔNG",
      c.ghi,
    ].join(" | "),
  );
}
