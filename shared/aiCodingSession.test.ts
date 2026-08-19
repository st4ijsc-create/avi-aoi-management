/**
 * ★★★ doc 79 · DANH SÁCH PHIÊN — LƯỚI CHO **LUẬT HÌNH DẠNG PHIÊN**.
 *
 * Bốn lớp lỗi được canh, mỗi lớp là một ca đỏ THẬT đã được nêu đích danh trong brief:
 *   §1 nạp lại một phiên **tái phát một thẻ duyệt HITL**            (mục C, ca iv)
 *   §2 phiên mang **ĐƯỜNG DẪN** thay vì id dự án                    (mục C, ca iii)
 *   §3 trạng thái **vòng tự động** sống dậy từ một phiên cũ          (mục C)
 *   §4 nhãn tự sinh: nhãn ghim MỘT ngôn ngữ vào CSDL / nhãn nhiều dòng
 *
 * ⚠ Ba ca đầu đều được cưỡng chế bởi CÙNG MỘT phép chiếu `locLuot()`. Đó là chủ ý: một cơ chế
 *   được ba lưới khác nhau soi từ ba hướng thì một đột biến vào nó không thể "sống sót vì lý do
 *   sai" ở cả ba.
 */
import { describe, it, expect } from "vitest";
import {
  GIOI_HAN_PHIEN,
  KHOA_CAM_TRONG_LUOT,
  locLuot,
  luotSachHitl,
  nhanTuLuot,
  laIdDuAnHopLe,
  laIdPhienHopLe,
  type LuotPhien,
} from "./aiCodingSession";

const luot = (role: "user" | "assistant", content: string): LuotPhien => ({ role, content });

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — THẺ DUYỆT HITL KHÔNG SỐNG SÓT QUA MỘT LƯỢT LƯU/NẠP", () => {
  it("★★★ một lượt mang actionId/token/args/expiresAt ⇒ CHIẾU còn đúng {role, content}", () => {
    const doc = [
      {
        role: "assistant",
        content: "Đề xuất sửa Calculator.cs",
        // Nguyên văn hình dạng `KbPendingAction` mà SSE gửi xuống — thứ TUYỆT ĐỐI không được lưu.
        actionId: "9f1a2b3c-0000-4000-8000-000000000001",
        token: "9f1a2b3c-0000-4000-8000-000000000001",
        tool: "apply_diff",
        args: { path: "src/Calculator.cs", original: "cũ", modified: "mới" },
        expiresAt: "2026-08-19T10:00:00.000Z",
        preview: { entityType: "file", changes: [], warnings: [], humanSummary: "x" },
      },
    ];
    const ra = locLuot(doc);
    expect(ra).toEqual([{ role: "assistant", content: "Đề xuất sửa Calculator.cs" }]);
    expect(luotSachHitl(ra[0])).toBe(true);
    for (const k of KHOA_CAM_TRONG_LUOT) {
      expect(Object.prototype.hasOwnProperty.call(ra[0]!, k), `ô cấm "${k}" còn sót`).toBe(false);
    }
  });

  it("★★ phép chiếu dựng object MỚI — KHÔNG chia sẻ tham chiếu với đầu vào", () => {
    // Nếu ai đó "tối ưu" `locLuot` thành `{...o}` thì ca §1 trên vẫn ĐỎ; ca này canh chiều còn lại:
    // đầu ra không được là CHÍNH đối tượng đầu vào (một alias mang theo mọi ô ẩn/prototype).
    const nguon = { role: "user" as const, content: "xin chào", actionId: "x" };
    const ra = locLuot([nguon]);
    expect(ra[0]).not.toBe(nguon);
    expect(Object.keys(ra[0]!).sort()).toEqual(["content", "role"]);
  });

  it("vai lạ / content không phải chuỗi ⇒ BỎ lượt, không đoán ý", () => {
    expect(locLuot([{ role: "system", content: "x" }])).toEqual([]);
    expect(locLuot([{ role: "user", content: 42 }])).toEqual([]);
    expect(locLuot([{ role: "user" }])).toEqual([]);
    expect(locLuot(["chuỗi trần"])).toEqual([]);
    expect(locLuot([null, undefined, 7])).toEqual([]);
  });

  it("đầu vào KHÔNG phải mảng (jsonb méo / null) ⇒ rỗng, không ném", () => {
    expect(locLuot(null)).toEqual([]);
    expect(locLuot(undefined)).toEqual([]);
    expect(locLuot({ role: "user", content: "x" })).toEqual([]);
    expect(locLuot("[]")).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — PHIÊN MANG **ID DỰ ÁN**, KHÔNG BAO GIỜ ĐƯỜNG DẪN", () => {
  const DUONG_DAN = [
    "D:\\SOURCES\\avi-aoi-management",
    "C:/SOURCES/avi-aoi-management",
    "/etc/passwd",
    "../../etc/passwd",
    "..",
    "sandbox-projects/csharp-demo",
    "\\\\máy\\chia-se",
    "repo/../repo",
    "repo ", // khoảng trắng cuối — một id "gần đúng" vẫn phải bị từ chối
  ];

  for (const d of DUONG_DAN) {
    it(`★★★ TỪ CHỐI "${d}" làm projectId`, () => {
      expect(laIdDuAnHopLe(d)).toBe(false);
    });
  }

  it("chấp nhận đúng hình dạng id đang dùng thật", () => {
    for (const id of ["repo", "csharp-demo", "react_pg_demo", "A1", "a".repeat(64)]) {
      expect(laIdDuAnHopLe(id)).toBe(true);
    }
    expect(laIdDuAnHopLe("a".repeat(65))).toBe(false);
    expect(laIdDuAnHopLe("")).toBe(false);
    expect(laIdDuAnHopLe(null)).toBe(false);
    expect(laIdDuAnHopLe(123)).toBe(false);
  });

  it("id phiên phải là UUID do server sinh — client tự đặt id ⇒ TỪ CHỐI", () => {
    expect(laIdPhienHopLe("9f1a2b3c-0000-4000-8000-000000000001")).toBe(true);
    expect(laIdPhienHopLe("phien-cua-toi")).toBe(false);
    expect(laIdPhienHopLe("1")).toBe(false);
    expect(laIdPhienHopLe("' OR 1=1 --")).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — TRẠNG THÁI VÒNG TỰ ĐỘNG KHÔNG SỐNG SÓT", () => {
  it("★★ ô vòng (luot/tran/lyDoDung/bam*) bị chiếu mất — không dựng lại được vòng ma", () => {
    const ra = locLuot([
      { role: "assistant", content: "Vòng tự động — lượt 2/3", luot: 2, tran: 3, lyDoDung: null, bamDauRaTruoc: "abc", cauHoiGoc: "sửa X" },
    ]);
    expect(ra).toEqual([{ role: "assistant", content: "Vòng tự động — lượt 2/3" }]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — TRẦN KÍCH THƯỚC (một phiên không được phình vô hạn)", () => {
  it("cắt nội dung mỗi lượt theo BYTE_MOI_LUOT", () => {
    const ra = locLuot([luot("assistant", "x".repeat(GIOI_HAN_PHIEN.BYTE_MOI_LUOT + 500))]);
    expect(ra[0]!.content.length).toBe(GIOI_HAN_PHIEN.BYTE_MOI_LUOT);
  });

  it("★ vượt SO_LUOT ⇒ giữ N lượt CUỐI (ngữ cảnh lập trình hữu ích ở cuối mạch)", () => {
    const vao = Array.from({ length: GIOI_HAN_PHIEN.SO_LUOT + 5 }, (_, i) => luot("user", `#${i}`));
    const ra = locLuot(vao);
    expect(ra).toHaveLength(GIOI_HAN_PHIEN.SO_LUOT);
    expect(ra[0]!.content).toBe("#5");
    expect(ra[ra.length - 1]!.content).toBe(`#${GIOI_HAN_PHIEN.SO_LUOT + 4}`);
  });

  it("★ vượt BYTE_CA_PHIEN ⇒ bỏ dần từ ĐẦU cho tới khi vừa trần", () => {
    // 30 lượt × 20.000 = 600.000 > 400.000 ⇒ phải còn ≤ 20 lượt.
    const vao = Array.from({ length: 30 }, () => luot("assistant", "y".repeat(GIOI_HAN_PHIEN.BYTE_MOI_LUOT)));
    const ra = locLuot(vao);
    const tong = ra.reduce((s, t) => s + t.content.length, 0);
    expect(tong).toBeLessThanOrEqual(GIOI_HAN_PHIEN.BYTE_CA_PHIEN);
    expect(ra.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§5 — NHÃN TỰ SINH", () => {
  it("★ lấy từ câu hỏi ĐẦU TIÊN CỦA NGƯỜI, không phải câu trả lời của AI", () => {
    const ra = nhanTuLuot([
      luot("assistant", "```csharp\nnamespace X {}\n```"),
      luot("user", "viết code C# cho chương trình chat LAN"),
    ]);
    expect(ra).toBe("viết code C# cho chương trình chat LAN");
  });

  it("★ nhãn luôn MỘT dòng (xuống dòng/tab gộp thành một dấu cách)", () => {
    expect(nhanTuLuot([luot("user", "  sửa\n\tsrc/Calculator.cs\r\n  cho đúng  ")])).toBe("sửa src/Calculator.cs cho đúng");
  });

  it("cắt theo DAI_NHAN kèm dấu …", () => {
    const ra = nhanTuLuot([luot("user", "đ".repeat(200))]);
    expect(ra.length).toBe(GIOI_HAN_PHIEN.DAI_NHAN);
    expect(ra.endsWith("…")).toBe(true);
  });

  it("★★ KHÔNG suy được ⇒ trả CHUỖI RỖNG, không một chuỗi tiếng Việt cứng", () => {
    // Ghim một câu tiếng Việt vào CSDL là ghim một ngôn ngữ vào DỮ LIỆU — người dùng en/zh sẽ đọc
    // nhãn tiếng Việt và không cổng i18n nào nhìn thấy. Nhãn mặc định là việc của `t()`.
    expect(nhanTuLuot([])).toBe("");
    expect(nhanTuLuot([luot("assistant", "chỉ có AI nói")])).toBe("");
    expect(nhanTuLuot([luot("user", "   \n\t  ")])).toBe("");
  });
});
