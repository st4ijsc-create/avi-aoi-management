/**
 * R2 phần B — lưới bộ bổ sung `using` (`boSungUsingCSharp.ts`), đọc CHỈ MỤC THẬT trong repo.
 * ĐỘT BIẾN PHẢI BẮT: tính tên trong chuỗi/chú thích · tính tên thuộc tính (`string Rule`) là kiểu ·
 * `cmd.CommandType` (thuộc tính) kéo theo using · thêm lặp khi đã import · coi System.Data.SqlClient
 * là thiếu Microsoft.Data.SqlClient · `.GetInt32(0)` (overload gốc) kéo theo System.Data · đụng khối
 * không phải C#.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  phanTichThieuUsing,
  chenUsing,
  boSungUsingTrongVanBan,
  boChuThichVaChuoi,
  thongBaoBoSung,
  type ChiMucUsing,
} from "./boSungUsingCSharp";

const CHI_MUC: ChiMucUsing = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "knowledge", "api-ref", "dotnet-using.json"), "utf8"),
);
const ns = (ma: string) => phanTichThieuUsing(ma, CHI_MUC).map((t) => t.ns);

describe("chỉ mục thật", () => {
  it("có các kiểu và phương thức mở rộng mà hai lỗi D1/D2 đã đo cần tới", () => {
    expect(CHI_MUC.kieu.SqlDbType).toEqual(["System.Data"]);
    expect(CHI_MUC.kieu.SqlConnection).toEqual(["Microsoft.Data.SqlClient"]);
    expect(CHI_MUC.moRong.GetInt32).toMatchObject({ ns: "System.Data", thamSo2: ["String"] });
  });
});

describe("phanTichThieuUsing — hai hình dạng lỗi ĐÃ ĐO", () => {
  it("CS0103 `SqlDbType` (duan-r2b-truoc-3 D2) ⇒ thiếu System.Data", () => {
    const ma = `using Microsoft.Data.SqlClient;\nclass S { void F(SqlCommand c){ c.Parameters.Add("@a", SqlDbType.Int).Value = 1; } }`;
    expect(ns(ma)).toEqual(["System.Data"]);
    expect(phanTichThieuUsing(ma, CHI_MUC)[0].vi).toEqual(["SqlDbType"]);
  });

  it("CS1503 `reader.GetInt32(\"MaHocSinh\")` (D1) ⇒ thiếu System.Data (phương thức MỞ RỘNG)", () => {
    const ma = `using Microsoft.Data.SqlClient;\nclass R { int F(SqlDataReader r) => r.GetInt32("MaHocSinh"); }`;
    expect(ns(ma)).toEqual(["System.Data"]);
  });

  it("đối chứng: `r.GetInt32(0)` là overload GỐC ⇒ không kéo System.Data", () => {
    expect(ns(`using Microsoft.Data.SqlClient;\nclass R { int F(SqlDataReader r) => r.GetInt32(0); }`)).toEqual([]);
  });
});

describe("phanTichThieuUsing — không báo oan", () => {
  it("đã import (kể cả `global using`) ⇒ rỗng", () => {
    expect(ns(`using System.Data;\nusing Microsoft.Data.SqlClient;\nclass S { SqlDbType t = SqlDbType.Int; }`)).toEqual([]);
    expect(ns(`global using System.Data;\nclass S { DataTable t = new DataTable(); }`)).toEqual([]);
  });

  it("`System.Data.SqlClient` (gói cũ) được coi là đủ cho các kiểu SqlClient", () => {
    expect(ns(`using System.Data;\nusing System.Data.SqlClient;\nclass S { SqlConnection c = new SqlConnection(""); }`)).toEqual([]);
  });

  it("tên trong CHUỖI SQL và CHÚ THÍCH không phải lượt dùng kiểu", () => {
    const ma = `class S { string q = "SELECT DataTable FROM SqlDbType"; // DataTable SqlDbType\n /* new DataTable() */ }`;
    expect(ns(ma)).toEqual([]);
    expect(boChuThichVaChuoi(`a("x\\"y") // z`)).toBe(`a("")  `);
  });

  it("tên THUỘC TÍNH / thành viên truy cập qua dấu chấm không kéo using", () => {
    expect(ns(`class M { public string Rule { get; set; } public int Constraint { get; set; } }`)).toEqual([]);
    expect(ns(`class M { void F(dynamic cmd){ var x = cmd.CommandType; } }`)).toEqual([]);
  });

  it("kiểu TỰ KHAI cùng tên ⇒ không kéo using", () => {
    expect(ns(`class DataTable { } class U { DataTable t = new DataTable(); }`)).toEqual([]);
  });

  it("vị trí kiểu: khai biến, kiểu trả về, new, enum, ép kiểu, generic, typeof — đều nhận", () => {
    for (const ma of [
      "class A { DataTable dt; }",
      "class A { public DataTable Lay() { return null; } }",
      "class A { object o = new DataTable(); }",
      "class A { object o = CommandType.Text; }",
      "class A { object o = (IDataReader)null!; }",
      "class A { System.Collections.Generic.List<DataRow> x; }",
      "class A { System.Type t = typeof(DataSet); }",
    ]) expect(ns(ma), ma).toEqual(["System.Data"]);
  });
});

describe("chenUsing / boSungUsingTrongVanBan", () => {
  it("chèn SAU using cuối ở đầu tệp, giữ CRLF; không có using ⇒ đầu tệp", () => {
    expect(chenUsing("using System;\r\nusing Microsoft.Data.SqlClient;\r\n\r\nnamespace X;", ["System.Data"])).toBe(
      "using System;\r\nusing Microsoft.Data.SqlClient;\r\nusing System.Data;\r\n\r\nnamespace X;",
    );
    expect(chenUsing("namespace X;\nclass A {}", ["System.Data"])).toBe("using System.Data;\nnamespace X;\nclass A {}");
  });

  it("chỉ sửa khối csharp/cs/c#; khối sql và văn bản ngoài khối giữ nguyên từng byte; báo đúng lý do", () => {
    const vb =
      "Lời dẫn.\n```sql\nCREATE TABLE DataTable (Id INT);\n```\n\n```csharp\nusing Microsoft.Data.SqlClient;\nclass S { SqlDbType t = SqlDbType.Int; }\n```\nKết.";
    const r = boSungUsingTrongVanBan(vb, CHI_MUC);
    expect(r.them).toEqual([{ ns: "System.Data", vi: ["SqlDbType"] }]);
    expect(r.text).toContain("```sql\nCREATE TABLE DataTable (Id INT);\n```");
    expect(r.text).toContain("using Microsoft.Data.SqlClient;\nusing System.Data;\nclass S");
    expect(r.text.startsWith("Lời dẫn.")).toBe(true);
    expect(r.text.endsWith("Kết.")).toBe(true);
    expect(thongBaoBoSung(r.them, "vi")).toContain("`using System.Data;` (`SqlDbType`)");
  });

  it("không thiếu gì ⇒ văn bản y hệt, thông báo rỗng", () => {
    const vb = "```csharp\nusing System.Data;\nclass S { DataTable t; }\n```";
    const r = boSungUsingTrongVanBan(vb, CHI_MUC);
    expect(r.text).toBe(vb);
    expect(thongBaoBoSung(r.them, "vi")).toBe("");
  });
});
