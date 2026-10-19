/**
 * ★ 2026-10-18 — R2B MỞ RỘNG: bảng kiểu→namespace sinh từ TOÀN BỘ XML IntelliSense (.NET 10 + ASP.NET Core + NuGet dự
 * án) thay cho `dotnet-using.json` chọn tay (chỉ ADO.NET). Tương thích: tên trong bảng cũ (`kieu`) xử lý Y NHƯ CŨ; tên
 * mới (`kieuMoRong`) chỉ được bổ sung khi AN TOÀN.
 *
 * ĐỘT BIẾN PHẢI BẮT:
 *   • tên mở rộng không được dùng (JsonSerializer thiếu `using System.Text.Json;` mà không bổ sung);
 *   • bổ sung namespace của ImplicitUsings (`System.IO`, `System.Linq`…) — dự án SDK mặc định đã có ⇒ thông báo nhiễu;
 *   • mã import một namespace NGOÀI chỉ mục (thư viện lạ có thể khai cùng tên ⇒ thêm using gây CS0104 mơ hồ) mà vẫn
 *     bổ sung tên mở rộng — trong khi tên của bảng cũ vẫn phải hoạt động như trước;
 *   • tên thuộc nhiều namespace trong bảng mở rộng vẫn bị đoán.
 */
import { describe, it, expect } from "vitest";
import { phanTichThieuUsing, type ChiMucUsing } from "./boSungUsingCSharp";

const CHI_MUC: ChiMucUsing = {
  kieu: { SqlDbType: ["System.Data"], SqlConnection: ["Microsoft.Data.SqlClient"], SqlCommand: ["Microsoft.Data.SqlClient"] },
  moRong: {},
  kieuMoRong: {
    JsonSerializer: ["System.Text.Json"],
    File: ["System.IO"],
    Enumerable: ["System.Linq"],
    Session: ["Opc.Ua.Client"],
    Timer: ["System.Threading", "System.Timers"],
    StringBuilder: ["System.Text"],
  },
  nsBiet: ["System", "System.Data", "System.IO", "System.Linq", "System.Text", "System.Text.Json", "Microsoft.Data.SqlClient", "Opc.Ua", "Opc.Ua.Client", "System.Threading", "System.Timers"],
};
const ns = (ma: string) => phanTichThieuUsing(ma, CHI_MUC).map((t) => t.ns);

describe("bảng mở rộng", () => {
  it("★ JsonSerializer thiếu using ⇒ bổ sung System.Text.Json; Session (OPC UA) ⇒ Opc.Ua.Client", () => {
    expect(ns(`class A { string F(object o) => JsonSerializer.Serialize(o); }`)).toEqual(["System.Text.Json"]);
    expect(ns(`using Opc.Ua;\nclass B { Session s = null; }`)).toEqual(["Opc.Ua.Client"]);
    expect(ns(`class C { void F() { var sb = new StringBuilder(); } }`)).toEqual(["System.Text"]);
  });

  it("đã import ⇒ không thêm", () => {
    expect(ns(`using System.Text.Json;\nclass A { string F(object o) => JsonSerializer.Serialize(o); }`)).toEqual([]);
  });

  it("namespace của ImplicitUsings (System.IO, System.Linq…) KHÔNG bổ sung", () => {
    expect(ns(`class A { string F() => File.ReadAllText("a"); int G(int[] x) => Enumerable.Sum(x); }`)).toEqual([]);
  });

  it("tên thuộc NHIỀU namespace ⇒ không đoán", () => {
    expect(ns(`class A { Timer t = new Timer(); }`)).toEqual([]);
  });

  it("★ mã dùng namespace NGOÀI chỉ mục ⇒ tên mở rộng bị bỏ (nguy cơ CS0104), tên bảng cũ VẪN như trước", () => {
    const ma = `using Newtonsoft.Json;\nusing Microsoft.Data.SqlClient;\nclass A { string F(object o) => JsonSerializer.Serialize(o); void G(SqlCommand c) { c.Parameters.Add("@a", SqlDbType.Int); } }`;
    expect(ns(ma)).toEqual(["System.Data"]);
  });

  it("using bí danh / using static không bị coi là namespace lạ", () => {
    expect(ns(`using J = System.Text.Json;\nusing static System.Math;\nclass A { string F(object o) => JsonSerializer.Serialize(o); }`)).toEqual(["System.Text.Json"]);
  });

  it("tương thích: chỉ mục KHÔNG có kieuMoRong (định dạng cũ) ⇒ hành vi cũ", () => {
    const cu: ChiMucUsing = { kieu: CHI_MUC.kieu, moRong: {} };
    expect(phanTichThieuUsing(`class A { string F(object o) => JsonSerializer.Serialize(o); SqlDbType t; }`, cu).map((t) => t.ns)).toEqual(["System.Data"]);
  });
});
