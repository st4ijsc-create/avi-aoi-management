import { describe, expect, it } from "vitest";
import {
  QUYEN_SUA,
  QUYEN_XEM,
  coQuyenSuaNhaXuong,
  coQuyenXemTwin,
  docVungTuUrl,
  kepVungTheoQuyen,
  type DoQuyen,
} from "./vungQuyen";
import { navGroups } from "@/lib/navigation";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * Lưới cho QD-16 — MỘT TRANG, QUYỀN THEO TỪNG VÙNG
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★★ Mọi lưới ở đây chạy **HAI CHIỀU trên cùng một hàm**. Lý do đã ghi ở sổ:
 *   một khẳng định "vai X không thấy nút" là XANH cả khi hàm trả `false` cho
 *   MỌI người (kể cả admin) — tức là ta vừa chứng minh **số 0**. Nên mỗi ca ÂM
 *   đi kèm một ca DƯƠNG trên cùng phép đo.
 *
 * ★ Bốn vai dựng theo **bảng `permissions` thật** (đo 2026-09-08):
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

describe("★★★ kepVungTheoQuyen — URL KHÔNG được là đường vòng vào vùng sửa", () => {
  it("operator1 + `?che-do=botri` ⇒ HẠ về `xem`, và KHAI đã hạ cấp", () => {
    const r = kepVungTheoQuyen("sua", OPERATOR1);
    expect(r.vung).toBe("xem");
    expect(r.daHaCap, "phai NOI RA, khong im lang").toBe(true);
  });

  it("★ ĐỐI CHỨNG DƯƠNG: engineer1 + cùng URL ⇒ vào `sua`, KHÔNG hạ cấp", () => {
    const r = kepVungTheoQuyen("sua", ENGINEER1);
    expect(r.vung).toBe("sua");
    expect(r.daHaCap).toBe(false);
    // ★ G5/G32 — cùng đầu vào `"sua"`, hai vai cho hai đầu ra KHÁC nhau. Một
    //   hàm trả hằng số không thể qua được cặp lưới này.
    expect(r.vung).not.toBe(kepVungTheoQuyen("sua", OPERATOR1).vung);
  });

  it("yêu cầu `xem` ⇒ `xem` với MỌI vai, và không ai bị khai hạ cấp oan", () => {
    for (const q of [OPERATOR1, SUPERVISOR1, ENGINEER1, MAINT1, KHONG_GI]) {
      expect(kepVungTheoQuyen("xem", q)).toEqual({ vung: "xem", daHaCap: false });
    }
  });
});

describe("docVungTuUrl — URL là đầu vào KHÔNG tin được", () => {
  it("`botri` và `sua` ⇒ `sua` (hai lối vào cũ của /twin-studio)", () => {
    expect(docVungTuUrl("botri")).toBe("sua");
    expect(docVungTuUrl("sua")).toBe("sua");
  });

  it("giá trị lạ / rỗng / null ⇒ `xem`, KHÔNG ném lỗi", () => {
    for (const x of ["xoa-het", "", null, undefined, "SUA", "bo-tri"]) {
      expect(docVungTuUrl(x)).toBe("xem");
    }
  });

  it("★★★ docVungTuUrl MỘT MÌNH KHÔNG kẹp quyền — bỏ bước kẹp là tai nạn", () => {
    // Lưới này ghi lại HỢP ĐỒNG: `docVungTuUrl` cố tình KHÔNG biết gì về quyền.
    // Ai gọi nó mà quên `kepVungTheoQuyen` sẽ cho operator1 vào vùng sửa.
    expect(docVungTuUrl("botri")).toBe("sua");
    expect(kepVungTheoQuyen(docVungTuUrl("botri"), OPERATOR1).vung).toBe("xem");
  });
});
