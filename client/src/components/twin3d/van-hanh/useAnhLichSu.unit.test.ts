/**
 * Lưới cho `useAnhLichSu` (T-1, Đợt 28) — §9.8.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ PHÉP ĐỐI CHỨNG: LUẬT "CHƯA CÓ DỮ LIỆU ⇒ KHÔNG THAY CẢNH"
 * ════════════════════════════════════════════════════════════════════════════
 * Đây là truy vấn duy nhất trong đợt này có **TÁC DỤNG PHỤ** (ghi vào kho dùng
 * chung). Thứ một lần dời nhà có thể làm mất mà không cổng nào đỏ:
 *
 *   ① Nhánh `mocTua === null` — rời chế độ tua. Mất nó thì ảnh lịch sử **kẹt
 *      lại** trong kho sau khi người dùng đã quay về trực tiếp: màn hình khai
 *      dữ liệu quá khứ dưới nhãn hiện tại.
 *   ② `?? null` ở cuối. Đổi thành `?? []` biến "chưa tải xong" thành "đã đo,
 *      không có máy nào" — đúng lớp lỗi NT-3 (đếm rỗng ≠ đếm 0) mà cả dự án
 *      này đã trả giá nhiều lần.
 *
 * ⚠ Giới hạn tự khai: phép đo VĂN BẢN (xem lý lẽ ở `useMoPhongTwin.unit.test`).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const GOC = resolve(__dirname, "../../../..");
const doc = (p: string) => readFileSync(resolve(GOC, p), "utf8");

const HOOK = doc("src/components/twin3d/van-hanh/useAnhLichSu.ts");
const TRANG = doc("src/pages/TwinVanHanh.tsx");

/** Tước chú thích trước khi đo — xem `useMoPhongTwin.unit.test.ts`. */
const MA = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const HOOK_MA = MA(HOOK);

describe("★★★ `useAnhLichSu` — đã RỜI TRANG và VẪN ĐƯỢC GỌI", () => {
  it("★★★ truy vấn nằm trong hook, KHÔNG còn trong trang", () => {
    expect(HOOK).toContain("trpc.twinCanh.anhLichSu.useQuery");
    expect(TRANG).not.toContain("trpc.twinCanh.anhLichSu.useQuery");
  });

  it("★★★ trang GỌI hook theo TÊN HÀM, truyền đủ ba tham số", () => {
    expect(TRANG).toContain("useAnhLichSu({ factoryId, mocTua, datAnhLichSu })");
  });

  it("★★★ `useEffect` ghi kho ĐI THEO truy vấn — không bị bỏ lại", () => {
    // Nếu chỉ dời `useQuery` mà để `useEffect` ở trang, hook trả về một truy
    // vấn không ai đổ vào kho: tua lại im lặng không làm gì.
    expect(HOOK_MA).toContain("datAnhLichSu(mocTua, lichSuQ.data?.may ?? null)");
    expect(TRANG).not.toContain("datAnhLichSu(mocTua,");
  });
});

describe("★★★ §9.8 — HAI LUẬT KHÔNG ĐƯỢC MẤT KHI DỜI NHÀ", () => {
  it("★★★ nhánh RỜI CHẾ ĐỘ TUA (`mocTua === null`) còn nguyên", () => {
    // Mất nhánh này ⇒ ảnh lịch sử KẸT trong kho sau khi quay về trực tiếp.
    expect(HOOK_MA).toContain("if (mocTua === null)");
    expect(HOOK_MA).toContain("datAnhLichSu(null, null)");
  });

  it("★★★ NT-3: `?? null`, KHÔNG `?? []` — chưa tải xong ≠ không có máy nào", () => {
    expect(HOOK_MA).toContain("?? null");
    expect(HOOK_MA).not.toContain("lichSuQ.data?.may ?? []");
  });

  it("★★★ cửa GẤP ĐÔI: phải có CẢ nhà máy LẪN mốc tua", () => {
    expect(HOOK_MA).toContain("enabled: factoryId !== null && mocTua !== null");
  });

  it("★★★ G37 + G12: không tự đọc route, không chép tay chữ ký kho", () => {
    expect(HOOK_MA).not.toMatch(/useSearch\s*\(/);
    // Kiểu `datAnhLichSu` lấy THẲNG từ nguồn sự thật; chép tay là bản cài đặt
    // thứ hai của cùng hợp đồng và sẽ lệch im lặng khi kho đổi kiểu.
    expect(HOOK).toContain('KetQuaKhoTrangThai["datAnhLichSu"]');
  });
});
