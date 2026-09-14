/**
 * ════════════════════════════════════════════════════════════════════════════
 * `mauChuTrenNen.ts` — ĐỢT 57 (mục thiết kế 11): CHỌN MÀU CHỮ THEO **ĐỘ CHÓI CỦA NỀN**
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ VÌ SAO CÓ TỆP NÀY — một con số, không phải một ý thích.
 *
 * `LopCanhBao` vẽ badge cảnh báo trên cảnh 3D: nền là màu MỨC ĐỘ (`--destructive` /
 * `--warning` / `--info`), chữ 11 px nằm trên nền ấy. Bản trước ghim `color: "#fff"`
 * cho cả ba mức. Đo tương phản WCAG 2.1 trên **pixel thật sau khi vẽ** (Đợt 57,
 * `.qa-dot57/01-do-truoc.txt`) cho thấy cách ghim ấy hỏng ở hai mức:
 *
 *     trắng trên `--warning` (hổ phách oklch 0.78)  ⇒ ~2,0    (ngưỡng 4,5)
 *     trắng trên `--destructive` (đỏ oklch 0.65)     ⇒ ~3,2
 *     trắng trên `--info` (xanh oklch 0.70)          ⇒ ~2,6
 *
 * Bước đầu của Đợt 57 thay `#fff` bằng `--<mức>-foreground`. Nó cứu `--warning` và
 * `--info` (hai token ấy CÓ foreground sẫm) nhưng **không cứu `--destructive`**:
 * `--destructive-foreground` là màu SÁNG (oklch 0.98), nên đỏ vẫn ra **3,11–3,29**.
 * Đo tiếp: chữ SẪM trên đúng nền đỏ ấy cho **≈ 5,0**. Tức cặp token mà hệ thiết kế
 * ghép sẵn cho `--destructive` là cặp SAI cho chữ nhỏ trên nền đặc.
 *
 * ⇒ Thay vì thêm một mã màu thứ tám (§10.2 trần 7 mã) hay ghim tay từng mức, hàm này
 *   **CHỌN** giữa hai đầu có sẵn của thang chữ — `--foreground` và `--background` —
 *   bằng chính công thức WCAG. Nó tự đúng ở CẢ HAI theme: theme sáng làm
 *   `--destructive` sẫm đi và `--background` sáng lên, và phép chọn lật theo.
 *
 * ★ PHẦN TÍNH TÁCH RỜI PHẦN ĐỌC DOM (RB-8 / khuôn `mauTrangThai.ts`): `doChoi` và
 *   `chonByteTuongPhan` là hàm THUẦN trên byte sRGB, test được ở `environment: "node"`.
 *   Chỉ `mauChuTrenNen` chạm `getComputedStyle`/canvas, và nó có nhánh dự phòng.
 */
import { mauCss } from "./mauThree";
import { byteMau } from "./byteMau";

export type ByteMau = readonly [number, number, number];

/** Kênh sRGB 0–255 → kênh tuyến tính (WCAG 2.1 §"relative luminance"). */
function kenh(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

/**
 * Độ chói tương đối WCAG 2.1 của một màu sRGB.
 *
 * ⚠ KHÔNG dùng công thức "brightness" `(r*299+g*587+b*114)/1000` hay so sánh
 *   `L` của `oklch` — cả hai đều KHÔNG phải đại lượng mà ngưỡng 4,5 : 1 được
 *   định nghĩa trên. Dùng nhầm thang là cách chắc chắn để ra một con số đẹp
 *   cho một cặp màu người dùng vẫn không đọc nổi.
 */
export function doChoi(b: ByteMau): number {
  return 0.2126 * kenh(b[0]) + 0.7152 * kenh(b[1]) + 0.0722 * kenh(b[2]);
}

/** Tỉ số tương phản WCAG 2.1 giữa hai màu sRGB (luôn ≥ 1). */
export function tiSoTuongPhan(a: ByteMau, b: ByteMau): number {
  const la = doChoi(a);
  const lb = doChoi(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Chọn giữa hai ứng viên màu chữ cái nào tương phản hơn với `nen`.
 *
 * Trả về `{ chon: 0 | 1, tiSo }` — chỉ số ứng viên và tỉ số đạt được, để chỗ gọi
 * (và lưới test) đọc được **vì sao** chứ không chỉ **cái gì**.
 */
export function chonByteTuongPhan(
  nen: ByteMau,
  ungVien: readonly [ByteMau, ByteMau],
): { chon: 0 | 1; tiSo: number } {
  const t0 = tiSoTuongPhan(nen, ungVien[0]);
  const t1 = tiSoTuongPhan(nen, ungVien[1]);
  return t0 >= t1 ? { chon: 0, tiSo: t0 } : { chon: 1, tiSo: t1 };
}

const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/;
function tachByte(css: string): ByteMau | null {
  const m = RGB.exec(css);
  if (m) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
  return byteMau(css);
}

/**
 * Màu chữ CSS đọc được nhất trên một nền đã biết.
 *
 * @param nenCss  màu nền ĐÃ phân giải (`rgb(...)` hoặc bất kỳ cú pháp CSS nào) —
 *                thường là kết quả `mauCss("--destructive", …)`.
 * @param duPhong màu trả về khi không có DOM (node/SSR) hoặc không phân giải được.
 *
 * ★ Hai ứng viên là `--foreground` và `--background` — **token có sẵn**, không phải
 *   mã mới; chúng cũng chính là hai đầu của thang chữ mà cả app đang dùng.
 */
export function mauChuTrenNen(nenCss: string | null, duPhong = "#fff"): string {
  if (!nenCss) return duPhong;
  const nen = tachByte(nenCss);
  if (!nen) return duPhong;
  const sangCss = mauCss("--foreground", "#ffffff");
  const toiCss = mauCss("--background", "#000000");
  const sang = tachByte(sangCss);
  const toi = tachByte(toiCss);
  if (!sang || !toi) return duPhong;
  return chonByteTuongPhan(nen, [sang, toi]).chon === 0 ? sangCss : toiCss;
}
