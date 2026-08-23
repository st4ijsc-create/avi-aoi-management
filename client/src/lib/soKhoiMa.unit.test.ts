/**
 * ★★★ 2026-08-23 · LÔ 3 — LƯỚI CHO `soKhoiMa` (so khối mã model viết với tệp thật trên đĩa).
 *
 * ⚠ Đuôi `.unit.test.ts` bắt buộc (vitest gom client bằng `client/src/**\/*.unit.test.ts`;
 *   đặt `.test.ts` thì bị bỏ qua IM LẶNG — lớp "glob rỗng" đã che ca đỏ nhiều lần ở repo này).
 *
 * ORACLE VIẾT TAY — dựng từ ca thật đã đo (buổi đóng vai): tệp `Calculator.cs` trên đĩa CHƯA có
 * guard chia-cho-0, văn xuôi model chứa một khối CÓ guard và khai như mã hiện tại. Mỗi ca dưới đây
 * nói rõ nó canh đột biến nào:
 *   (a) bỏ vế `biCat`            → §3 đỏ (ca "tệp bị cắt + khối nửa-trong-nửa-ngoài PHẢI im lặng"
 *       — ⚠ ca "khối lạ" một mình KHÔNG bắt được (a): 0 dòng chung thì thiếu guard vẫn ra
 *       khong-du-can-cu; nên §3 có thêm hai ca biCat mà thiếu guard sẽ thành `khac`/`khop`).
 *   (b) phép so luôn trả `khop`  → §2 (khac) + §3 (mọi ca) đỏ.
 *   (c) đảo chiều `khac`⇔`khop`  → §1 và §2 đỏ chéo nhau.
 */
import { describe, it, expect } from "vitest";
import {
  NGUONG_DONG_BANG_NHAN,
  SAN_DONG_CHUAN_DE_SO,
  bocTheDocTep,
  chuanHoaDongMa,
  dinhDangLucNhan,
  laKetQuaDocTuDia,
  neoKhopNgonNgu,
  soKhoiVoiTep,
  viTriCauTraLoiCungLuot,
} from "./soKhoiMa";

/** Tệp trên đĩa — CRLF như Windows thật ghi, CHƯA có guard chia-cho-0 (bug còn nguyên). */
const TEP_CALCULATOR = [
  "namespace Demo",
  "{",
  "    public class Calculator",
  "    {",
  "        public int Divide(int a, int b)",
  "        {",
  "            return a / b;",
  "        }",
  "    }",
  "}",
].join("\r\n");

/** Khối model viết — LF, CÓ guard `if (b == 0) throw…` KHÔNG tồn tại trên đĩa. */
const KHOI_CO_GUARD = [
  "public int Divide(int a, int b)",
  "{",
  '    if (b == 0) throw new DivideByZeroException("b = 0");',
  "    return a / b;",
  "}",
].join("\n");

/** Khối trích đúng tệp (thụt dòng khác, dòng-ngoặc riêng — cả hai phải vô hại). */
const KHOI_TRICH_DUNG = [
  "public class Calculator",
  "{",
  "  public int Divide(int a, int b)",
  "  {",
  "    return a / b;",
  "  }",
  "}",
].join("\n");

/** Khối hoàn toàn xa lạ với tệp (0 dòng chung) nhưng vẫn ≥ 3 dòng chuẩn. */
const KHOI_LA = ["def divide(a, b):", "    result = a / b", "    return result"].join("\n");

const TEP_NGUYEN = { noiDung: TEP_CALCULATOR, biCat: false };
const TEP_BI_CAT = { noiDung: TEP_CALCULATOR, biCat: true };

describe("§1 `khop` — mọi dòng chuẩn của khối đều có trong tệp", () => {
  it("khối trích đúng (LF, thụt khác) so với tệp CRLF ⇒ khop", () => {
    expect(soKhoiVoiTep(KHOI_TRICH_DUNG, TEP_NGUYEN)).toBe("khop");
  });

  it("dòng chỉ-ngoặc/dấu của khối (`{`, `});`) không phá phép so", () => {
    const khoi = ["public class Calculator", "{", "});", "public int Divide(int a, int b)", "return a / b;"].join("\n");
    // `});` KHÔNG có trong tệp — nhưng là dòng kết dính, phải bị BỎ trước khi so ⇒ vẫn khop.
    expect(soKhoiVoiTep(khoi, TEP_NGUYEN)).toBe("khop");
  });

  it("khối CRLF so với tệp CRLF ⇒ khop (chuẩn hoá cả hai phía)", () => {
    expect(soKhoiVoiTep(KHOI_TRICH_DUNG.replace(/\n/g, "\r\n"), TEP_NGUYEN)).toBe("khop");
  });
});

describe("§2 `khac` — ca thật đã đo: guard model thêm KHÔNG có trên đĩa", () => {
  it("khối có `if (b == 0) throw…` giữa các dòng thật ⇒ khac", () => {
    expect(soKhoiVoiTep(KHOI_CO_GUARD, TEP_NGUYEN)).toBe("khac");
  });

  it("★ chống tự thoả cho §1/§2: hai khối chỉ lệch nhau đúng MỘT dòng guard", () => {
    // Nếu oracle §1 và §2 khác nhau nhiều hơn một dòng nghĩa, một bản vá sai vẫn có thể phân biệt
    // chúng bằng lý do sai. Khối §2 = khối-3-dòng-thật + 1 dòng guard; khẳng định điều đó ở đây.
    const chuan = chuanHoaDongMa(KHOI_CO_GUARD);
    const trongTep = new Set(chuanHoaDongMa(TEP_CALCULATOR));
    const ngoai = chuan.filter((d) => !trongTep.has(d));
    expect(ngoai).toEqual(['if (b == 0) throw new DivideByZeroException("b = 0");']);
  });
});

describe("§3 `khong-du-can-cu` — im lặng khi không đủ căn cứ, ĐÚNG các đường đã khai", () => {
  it("★★★ (đột biến a) tệp BỊ CẮT + khối nửa-trong-nửa-ngoài ⇒ PHẢI im lặng (không được nói `khac`)", () => {
    // Bỏ vế `biCat` thì ca này trả `khac` — khẳng định TOÀN THỂ từ một phép đo BỘ PHẬN.
    expect(soKhoiVoiTep(KHOI_CO_GUARD, TEP_BI_CAT)).toBe("khong-du-can-cu");
  });

  it("★★★ (đột biến a) tệp BỊ CẮT + khối trích đúng ⇒ cũng im lặng (không được nói `khop`)", () => {
    expect(soKhoiVoiTep(KHOI_TRICH_DUNG, TEP_BI_CAT)).toBe("khong-du-can-cu");
  });

  it("tệp bị cắt + khối lạ ⇒ im lặng (ca gọi tên trong brief — mọi ngả biCat đều im lặng)", () => {
    expect(soKhoiVoiTep(KHOI_LA, TEP_BI_CAT)).toBe("khong-du-can-cu");
  });

  it("khối lạ hoàn toàn (0 dòng chung, tệp NGUYÊN VẸN) ⇒ im lặng — mã mới có thể là đề xuất hợp lệ", () => {
    expect(soKhoiVoiTep(KHOI_LA, TEP_NGUYEN)).toBe("khong-du-can-cu");
  });

  it(`khối < ${SAN_DONG_CHUAN_DE_SO} dòng chuẩn ⇒ im lặng, KỂ CẢ khi mọi dòng đều có trong tệp`, () => {
    const nho = ["public class Calculator", "return a / b;"].join("\n");
    expect(chuanHoaDongMa(nho).length).toBe(2); // < sàn — tiền đề của ca, khẳng định để khỏi tự thoả
    expect(soKhoiVoiTep(nho, TEP_NGUYEN)).toBe("khong-du-can-cu");
  });

  it("khối chỉ toàn dòng-ngoặc/trống ⇒ 0 dòng chuẩn ⇒ im lặng", () => {
    expect(soKhoiVoiTep("{\n}\n();\n\n", TEP_NGUYEN)).toBe("khong-du-can-cu");
  });
});

describe("§4 `chuanHoaDongMa` — chuẩn hoá dòng", () => {
  it("trim + bỏ dòng trống + bỏ dòng chỉ ngoặc/dấu + CRLF→LF", () => {
    expect(chuanHoaDongMa("  a = 1;\r\n\r\n{\r\n} ) ;\r\n  b(2);\r\n")).toEqual(["a = 1;", "b(2);"]);
  });

  it("dòng có MÃ THẬT lẫn ngoặc thì GIỮ (chỉ bỏ dòng thuần kết dính)", () => {
    expect(chuanHoaDongMa("if (x) {\n}")).toEqual(["if (x) {"]);
  });
});

describe("§5 neo khối↔tệp theo NGÔN NGỮ (bảng trắng nhỏ)", () => {
  it("cs↔csharp · ts/tsx↔typescript · khớp không phân biệt hoa thường", () => {
    expect(neoKhopNgonNgu("csharp", "src/Calculator.cs")).toBe(true);
    expect(neoKhopNgonNgu("CSharp", "src/Calculator.cs")).toBe(true);
    expect(neoKhopNgonNgu("typescript", "client/src/lib/a.ts")).toBe(true);
    expect(neoKhopNgonNgu("tsx", "client/src/pages/A.tsx")).toBe(true);
    expect(neoKhopNgonNgu("ts", "client/src/pages/A.tsx")).toBe(true);
  });

  it("KHÔNG so khi: fence không nhãn · nhãn lệch đuôi · đuôi lạ · đường dẫn không đuôi", () => {
    expect(neoKhopNgonNgu(null, "src/Calculator.cs")).toBe(false);
    expect(neoKhopNgonNgu("", "src/Calculator.cs")).toBe(false);
    expect(neoKhopNgonNgu("python", "src/Calculator.cs")).toBe(false);
    expect(neoKhopNgonNgu("csharp", "src/Calculator.xyz9")).toBe(false);
    expect(neoKhopNgonNgu("csharp", "Makefile")).toBe(false);
  });
});

describe("§6 `bocTheDocTep` — bóc neo từ data thẻ tool (hình dạng ĐO trên server)", () => {
  const DAY_DU = { path: "src/Calculator.cs", bytes: 120, truncated: false, redacted: false, content: TEP_CALCULATOR };

  it("bản đọc một tệp có content ⇒ neo; `truncated` HOẶC `redacted` ⇒ biCat", () => {
    expect(bocTheDocTep(DAY_DU)).toEqual({ duongDan: "src/Calculator.cs", noiDung: TEP_CALCULATOR, biCat: false });
    expect(bocTheDocTep({ ...DAY_DU, truncated: true })?.biCat).toBe(true);
    // Nội dung đã CHE bí mật không còn là byte trên đĩa — so trên nó là so vật đã bị thiết bị đo sửa.
    expect(bocTheDocTep({ ...DAY_DU, redacted: true })?.biCat).toBe(true);
    // `read_project_file` (P2) không có ô `redacted` — vẫn bóc được.
    expect(bocTheDocTep({ path: "main.st", bytes: 5, truncated: false, content: "x := 1;" })?.biCat).toBe(false);
  });

  it("mọi hình dạng khác ⇒ null: thẻ tổng {files}, lượt từ chối (path null), content null, data rỗng", () => {
    expect(bocTheDocTep({ files: [{ path: "a.cs", bytes: 1 }] })).toBeNull();
    expect(bocTheDocTep({ path: null, bytes: null, truncated: false, redacted: false, content: null })).toBeNull();
    expect(bocTheDocTep({ ...DAY_DU, content: null })).toBeNull();
    expect(bocTheDocTep(null)).toBeNull();
    expect(bocTheDocTep("chuoi")).toBeNull();
  });
});

describe("§7 `laKetQuaDocTuDia` — vị từ gắn chip bằng chứng", () => {
  it("bản đọc một tệp VÀ thẻ tổng {files:[…]} đều là lượt đọc từ đĩa", () => {
    expect(laKetQuaDocTuDia({ path: "a.cs", bytes: 1, truncated: false, content: "x" })).toBe(true);
    expect(laKetQuaDocTuDia({ files: [{ path: "a.cs", bytes: 1 }, { path: "b.cs", bytes: 2 }] })).toBe(true);
  });

  it("KHÔNG chip cho: files rỗng · data thống kê · data null · lượt từ chối", () => {
    expect(laKetQuaDocTuDia({ files: [] })).toBe(false);
    expect(laKetQuaDocTuDia({ date: "2026-08-23", total: 5, ok: 5, ng: 0 })).toBe(false);
    expect(laKetQuaDocTuDia(null)).toBe(false);
    expect(laKetQuaDocTuDia({ path: null, content: null, truncated: false })).toBe(false);
  });
});

describe("§8 `viTriCauTraLoiCungLuot` — neo chỉ áp cho câu trả lời CÙNG LƯỢT", () => {
  const u = { role: "user" };
  const a = { role: "assistant" };

  it("câu assistant ĐẦU TIÊN sau user CUỐI CÙNG", () => {
    expect(viTriCauTraLoiCungLuot([u, a])).toBe(1);
    // Các câu assistant NỐI SAU (đầu ra lệnh của handleConfirm) không phải câu trả lời của lượt.
    expect(viTriCauTraLoiCungLuot([u, a, a])).toBe(1);
    expect(viTriCauTraLoiCungLuot([a, u, a, a])).toBe(2);
  });

  it("không có neo khi: transcript rỗng · chưa có trả lời · toàn assistant (phiên nạp lại kiểu lạ)", () => {
    expect(viTriCauTraLoiCungLuot([])).toBeNull();
    expect(viTriCauTraLoiCungLuot([u])).toBeNull();
    expect(viTriCauTraLoiCungLuot([u, a, u])).toBeNull();
    expect(viTriCauTraLoiCungLuot([a, a])).toBeNull();
  });
});

describe("§9 hằng + định dạng mốc-nhận", () => {
  it("ngưỡng băng nhãn GHIM `toBe` (số tụt nguy hiểm hơn số phình — bài học ngân sách i18n)", () => {
    expect(NGUONG_DONG_BANG_NHAN).toBe(4);
    expect(SAN_DONG_CHUAN_DE_SO).toBe(3);
  });

  it("`dinhDangLucNhan` — HH:MM:SS 24h, pad 0", () => {
    expect(dinhDangLucNhan(new Date(2026, 7, 23, 7, 5, 9))).toBe("07:05:09");
    expect(dinhDangLucNhan(new Date(2026, 7, 23, 23, 59, 0))).toBe("23:59:00");
  });
});
