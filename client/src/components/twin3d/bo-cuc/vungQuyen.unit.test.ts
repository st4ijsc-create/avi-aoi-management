import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  QUYEN_SUA,
  QUYEN_XEM,
  coQuyenSuaNhaXuong,
  coQuyenXemTwin,
  type DoQuyen,
} from "./vungQuyen";
import { navGroups } from "@/lib/navigation";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * Lưới cho QĐ-18 — **HAI TRANG**, HAI CỔNG (thay QĐ-16: một trang, quyền vùng)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★★ Mọi lưới ở đây chạy **HAI CHIỀU trên cùng một hàm**. Lý do đã ghi ở sổ:
 *   một khẳng định "vai X không thấy nút" là XANH cả khi hàm trả `false` cho
 *   MỌI người (kể cả admin) — tức là ta vừa chứng minh **số 0**. Nên mỗi ca ÂM
 *   đi kèm một ca DƯƠNG trên cùng phép đo.
 *
 * ★★★ ĐỢT 26: `kepVungTheoQuyen`/`docVungTuUrl` ĐÃ BỊ XOÁ cùng khoá `?che-do=`
 *   (0 chỗ gọi ngoài test sau khi tách trang). Các lưới cho hai hàm ấy được gỡ
 *   theo — giữ lưới cho một API đã chết là giữ 8 ô xanh canh gác số 0.
 *   Việc chúng từng làm nay do `RouteGuard navHref="/twin-studio"` đảm nhiệm,
 *   và `dinhTuyenTwinCu.unit.test.ts` cưỡng chế điều đó trên `App.tsx` thật.
 *
 * ★ Bốn vai dựng theo **bảng `permissions` thật** (đo lại 2026-09-09, KHỚP):
 *     operator1   : machine_status
 *     supervisor1 : analytics_oee, machine_control, machine_status
 *     engineer1   : machine_control, machine_status, settings_factory
 *     maint1      : machine_control, machine_status
 */

/** Dựng một `hasPermission` giả từ danh sách module vai đó có `canView`. */
function vai(...co: string[]): DoQuyen {
  const tap = new Set(co);
  return (m) => tap.has(m);
}

const OPERATOR1 = vai("machine_status");
const SUPERVISOR1 = vai("analytics_oee", "machine_control", "machine_status");
const ENGINEER1 = vai("machine_control", "machine_status", "settings_factory");
const MAINT1 = vai("machine_control", "machine_status");
/** Vai không có gì cả — đối chứng để mọi phép "có quyền" không thành hằng `true`. */
const KHONG_GI = vai();

describe("★★★ hợp đồng ba chỗ — danh sách quyền phải KHỚP navigation.tsx", () => {
  /*
   * ⚠ Chép tay một danh sách quyền sang tệp thứ hai là mở đường cho hai chỗ
   *   khai hai cổng khác nhau — đúng lớp lỗi "một lối vào rồi TỪ CHỐI" của Khối
   *   D. Lưới này TRA thẳng `navGroups` nên hai bên không thể lệch mà lưới vẫn
   *   xanh.
   */
  function timO(href: string) {
    for (const g of navGroups) {
      for (const i of g.items) if (i.href === href) return i;
    }
    return undefined;
  }

  it("QUYEN_XEM khớp nguyên văn ô `/twin`", () => {
    const o = timO("/twin");
    expect(o, "phai tim thay o nav /twin").toBeDefined();
    expect([...(o!.requiredPermissionAny ?? [])].sort()).toEqual([...QUYEN_XEM].sort());
  });

  it("QUYEN_SUA khớp nguyên văn ô `/twin-studio`", () => {
    const o = timO("/twin-studio");
    expect(o, "phai tim thay o nav /twin-studio").toBeDefined();
    expect([...(o!.requiredPermissionAny ?? [])].sort()).toEqual([...QUYEN_SUA].sort());
  });

  it("★ hai cổng KHÁC NHAU — nếu bằng nhau thì cả đợt này vô nghĩa", () => {
    expect([...QUYEN_XEM].sort()).not.toEqual([...QUYEN_SUA].sort());
  });
});

describe("★★★ CHỨNG MINH HAI CHIỀU — operator1 vào được, KHÔNG thấy nút sửa", () => {
  it("CHIỀU 1 — operator1 VÀO ĐƯỢC trang (không mất lối vào, chống CHẶN-1)", () => {
    expect(coQuyenXemTwin(OPERATOR1)).toBe(true);
  });

  it("CHIỀU 2 — operator1 KHÔNG thấy vùng sửa (chống cổng RỘNG)", () => {
    expect(coQuyenSuaNhaXuong(OPERATOR1)).toBe(false);
  });

  it("★★★ ĐỐI CHỨNG DƯƠNG bắt buộc: ba vai kia THẤY vùng sửa", () => {
    // Thiếu ba dòng này, một hàm `coQuyenSuaNhaXuong = () => false` sẽ làm
    // CHIỀU 2 xanh mà không đo gì — đo bằng admin chứng minh số 0, phiên bản
    // ngược lại.
    expect(coQuyenSuaNhaXuong(SUPERVISOR1), "supervisor1 co machine_control").toBe(true);
    expect(coQuyenSuaNhaXuong(ENGINEER1), "engineer1 co settings_factory").toBe(true);
    expect(coQuyenSuaNhaXuong(MAINT1), "maint1 co machine_control").toBe(true);
  });

  it("★ đối chứng ÂM ở chiều vào: vai không quyền gì KHÔNG vào được", () => {
    expect(coQuyenXemTwin(KHONG_GI)).toBe(false);
    expect(coQuyenSuaNhaXuong(KHONG_GI)).toBe(false);
  });

  it("★★★ bề mặt: đúng 1/4 vai non-admin chỉ-xem, 3/4 sửa được", () => {
    const bon = [
      ["operator1", OPERATOR1],
      ["supervisor1", SUPERVISOR1],
      ["engineer1", ENGINEER1],
      ["maint1", MAINT1],
    ] as const;
    const vaoDuoc = bon.filter(([, q]) => coQuyenXemTwin(q)).map(([n]) => n);
    const suaDuoc = bon.filter(([, q]) => coQuyenSuaNhaXuong(q)).map(([n]) => n);
    // Cả 4 vào được — KHÔNG ai mất lối vào (đây là điều Đợt 15 đã phải vá ngược).
    expect(vaoDuoc).toHaveLength(4);
    expect(suaDuoc).toHaveLength(3);
    expect(suaDuoc).not.toContain("operator1");
  });
});

/*
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỢT 26 (QĐ-18) — LƯỚI ĐO **KẾT CỤC CỦA VIỆC TÁCH**, KHÔNG ĐO CƠ CHẾ
 * ════════════════════════════════════════════════════════════════════════════
 * Ba câu dưới đây là ba câu chủ sở hữu thật sự hỏi, và chúng đọc trên NGUỒN
 * THẬT (`navigation.tsx`, `TwinVanHanh.tsx`) chứ không trên một bản sao:
 *
 *   1. Người chỉ xem có bị mất `/twin` không?          → PHẢI: không
 *   2. Người chỉ xem có thấy lối vào studio không?     → PHẢI: không
 *   3. `/twin` có còn sửa được không?                  → PHẢI: không
 */
describe("★★★ QĐ-18 — TÁCH TRANG: đo KẾT CỤC trên nguồn thật", () => {
  const nguonVanHanh = fs.readFileSync(
    path.resolve(__dirname, "../../../pages/TwinVanHanh.tsx"),
    "utf8",
  );

  it("★★★ CÂU 1 — `operator1` KHÔNG mất `/twin` (nỗi lo lớn nhất của QĐ-16)", () => {
    // Đây là con số đã lật ngược lập luận "cổng CHẶT" của QĐ-16.
    expect(coQuyenXemTwin(OPERATOR1)).toBe(true);
    // ĐỐI CHỨNG: phép đo biết KÊU — vai trắng tay thì không vào được.
    expect(coQuyenXemTwin(KHONG_GI)).toBe(false);
  });

  it("★★★ CÂU 2 — ô nav `/twin-studio` gate ĐÚNG `QUYEN_SUA` ⇒ operator1 không THẤY", () => {
    /*
     * Luật ẩn-không-disable ở tầng nav: `hasAccessToItem` lọc ô theo
     * `requiredPermissionAny`, nên gate của ô CHÍNH LÀ thứ quyết định
     * `operator1` có thấy dòng menu hay không. Đo trên ô thật.
     */
    const o = navGroups
      .flatMap((g) => g.items ?? [])
      .find((x) => x.href === "/twin-studio");
    expect(o, "ô nav /twin-studio phải TỒN TẠI — tách trang mà không có lối vào là màn mồ côi").toBeDefined();
    expect([...(o!.requiredPermissionAny ?? [])].sort()).toEqual([...QUYEN_SUA].sort());
    // operator1 không thoả gate ⇒ không thấy ô. Ba vai kia thoả ⇒ thấy.
    const thay = (q: DoQuyen) => (o!.requiredPermissionAny ?? []).some((p) => q(p, "canView"));
    expect(thay(OPERATOR1), "operator1 KHONG duoc thay o nav").toBe(false);
    expect(thay(ENGINEER1), "engineer1 PHAI thay").toBe(true);
    expect(thay(MAINT1), "maint1 PHAI thay").toBe(true);
    expect(thay(SUPERVISOR1), "supervisor1 PHAI thay").toBe(true);
  });

  it("★★★ CÂU 3 — `/twin` CHỈ ĐỌC: không còn nạp `TwinStudio`, không còn `?che-do=`", () => {
    /*
     * G74 — *"đã có"* là lời khai về TỆP, không phải về VIỆC. Nên không hỏi
     * "TwinStudio.tsx còn không" (còn, và §11b cấm xoá); hỏi **`/twin` có nạp
     * nó không**. Ba dấu vết dưới đây là ba cách vùng sửa từng sống ở trang này.
     */
    expect(nguonVanHanh).not.toContain('import("./TwinStudio")');
    expect(nguonVanHanh).not.toContain("<VungSuaNhaXuong");
    expect(nguonVanHanh).not.toContain('get("che-do")');
  });

  it("★ ĐỐI CHỨNG cho CÂU 3 — phép đo biết KÊU: liên kết sang studio VẪN CÒN", () => {
    /*
     * Thiếu ca này, một `TwinVanHanh.tsx` đọc hỏng (rỗng) làm CÂU 3 xanh trơn.
     * Và nó đo luôn điều chủ sở hữu đòi: *"2 trang LIÊN KẾT với nhau"* — tách
     * mà không nối là làm hỏng đúng thứ ông yêu cầu.
     */
    expect(nguonVanHanh).toContain('href="/twin-studio"');
    expect(nguonVanHanh).toContain('data-testid="lien-ket-twin-studio"');
    // …và liên kết ấy nằm SAU hàng rào quyền, không phải hiện cho mọi người.
    expect(nguonVanHanh).toContain("{duocSuaNhaXuong ? (");
  });
});
