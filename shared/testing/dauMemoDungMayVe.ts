/**
 * `dauMemoDungMayVe.ts` — TÌM `useMemo` DỰNG MÁY VẼ **THEO VIỆC NÓ LÀM**, KHÔNG THEO TÊN BIẾN.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO CÓ TỆP NÀY — MỘT LƯỚI CANH THEO HÌNH DẠNG ĐÃ GÃY
 * ════════════════════════════════════════════════════════════════════════════
 * Ba lưới văn bản (`mucTuoiXinKhung`, `tuoiDuLieuVaoDuongVe`, `manLineNoiVaoTrang`) ghim những
 * đối số/deps của phép dựng máy vẽ trong ba trang Twin. Cả ba tra bằng hằng chữ:
 *
 *     src.indexOf("const mayVe = useMemo")
 *
 * Khi `TwinLine.tsx` thêm bố cục **sơ đồ** (`soDoLine.ts`), memo ấy đổi tên thành `mayVeThat` để
 * nhường tên `mayVe` cho bản đã trải lưới. Thứ ba lưới kia ghim — *"có truyền `gocToaTheoTang`
 * không"*, *"deps có `mucTuoiTheoMay` không"* — **không đổi một chữ**; chỉ cái tên đổi. Vậy mà cả
 * sáu ca đỏ.
 *
 * ⇒ Đó là lưới canh theo **HÌNH DẠNG** (một cái tên) thay vì theo **TÍNH CHẤT** (memo nào gọi
 *   `dungMayVe`). Phân loại theo luật của repo: **không** phải ca ghim một QUYẾT ĐỊNH bị lật —
 *   quyết định còn nguyên; là **cơ chế** của ca đã lạc hậu. Nên sửa cơ chế, đừng nới khẳng định.
 *
 * ★ Và nó KHÔNG bị nới: thước mới vẫn đỏ y như cũ khi một dep bị bỏ, khi `gocToaTheoTang` bị
 *   thay bằng `new Map()`, hay khi phạm vi bị dựng tại chỗ. Nó chỉ thôi phụ thuộc vào việc trang
 *   đặt tên biến là gì.
 *
 * ⚠ Trang KHÔNG gọi `dungMayVe` ⇒ trả `-1` và người gọi `expect(...)` cho đỏ. Trả một chỉ số
 *   bừa (0) sẽ làm mọi ca đọc nhầm phần đầu tệp và cho **xanh oan** — đúng lớp lỗi "cửa sổ cố
 *   định đọc lấn hàng xóm" mà `usePhanTichLine.unit.test.ts` đã ghi.
 */

/**
 * Chỉ số đầu của `const <tên> = useMemo` **gần nhất đứng trước** lời gọi `dungMayVe(`.
 *
 * @param src       mã nguồn trang (nên đã qua `docMaNguon` để chuẩn hoá xuống dòng).
 * @param tepTrang  tên tệp — chỉ dùng cho thông báo lỗi của người gọi.
 * @returns chỉ số, hoặc `-1` khi không tìm thấy (trang không gọi `dungMayVe`, hoặc lời gọi không
 *          nằm trong một `useMemo` nào).
 */
export function dauMemoDungMayVe(src: string, _tepTrang?: string): number {
  const goi = src.indexOf("dungMayVe(");
  if (goi < 0) return -1;
  let i = -1;
  for (const m of src.slice(0, goi).matchAll(/const \w+ = useMemo/g)) {
    if (typeof m.index === "number") i = m.index;
  }
  return i;
}
