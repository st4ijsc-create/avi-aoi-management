/**
 * ★ `lookup_api` — tra CHÍNH XÁC theo tên / đuôi tên trên chỉ mục ký hiệu API cục bộ (khuyến nghị #1 + #2, báo cáo
 * 2026-10-18). Chỉ mục dựng bằng ĐÚNG bộ ghi của bộ dựng (`scripts/ai-kb/api-ref/phanTich.mjs`) từ mẫu nhỏ — không đọc
 * `knowledge/` (tệp sinh, gitignore), không mạng, không model.
 *
 * ĐỘT BIẾN PHẢI BẮT: tìm nhị phân trượt khoá đầu/cuối · khớp theo cosine/chuỗi con thay vì nguyên tên (`Copy` ⇒
 * `SqlBulkCopy`) · bỏ qua bộ lọc ngôn ngữ · đuôi tên không lọc (`SqlBulkCopy.WriteToServer` trả cả `Other.WriteToServer`)
 * · kiểu không kèm thành viên · không trần kết quả · chỉ mục vắng ⇒ ném thay vì `null`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-expect-error — mô-đun .mjs không có khai báo kiểu
import { vietChiMuc } from "../../../../scripts/ai-kb/api-ref/phanTich.mjs";
import { moChiMucApi, dinhDangKetQuaApi, chuanHoaTenTra, type ChiMucApiMo } from "./traApi";

const m = (o: Record<string, unknown>) => ({ tomTat: "", chuKy: String(o.ten), ...o });

let thuMuc = "";
let cm: ChiMucApiMo;

beforeAll(() => {
  thuMuc = fs.mkdtempSync(path.join(os.tmpdir(), "tra-api-"));
  const sql = [
    m({ nn: "csharp", loai: "type", ns: "Microsoft.Data.SqlClient", ten: "SqlBulkCopyOptions", tomTat: "Bitwise flag options for SqlBulkCopy.", _nhom: "g1", tep: "Microsoft.Data.SqlClient.xml" }),
    m({ nn: "csharp", loai: "field", ns: "Microsoft.Data.SqlClient", ten: "SqlBulkCopyOptions.KeepIdentity", cha: "SqlBulkCopyOptions", chuKy: "KeepIdentity", tomTat: "Preserve source identity values.", _thuoc: "g1", tep: "Microsoft.Data.SqlClient.xml" }),
    m({ nn: "csharp", loai: "field", ns: "Microsoft.Data.SqlClient", ten: "SqlBulkCopyOptions.TableLock", cha: "SqlBulkCopyOptions", chuKy: "TableLock", _thuoc: "g1", tep: "Microsoft.Data.SqlClient.xml" }),
    m({ nn: "csharp", loai: "type", ns: "Microsoft.Data.SqlClient", ten: "SqlBulkCopy", _nhom: "g2", tep: "Microsoft.Data.SqlClient.xml" }),
    m({ nn: "csharp", loai: "method", ns: "Microsoft.Data.SqlClient", ten: "SqlBulkCopy.WriteToServer", cha: "SqlBulkCopy", chuKy: "WriteToServer(System.Data.DataTable)", _thuoc: "g2", tep: "Microsoft.Data.SqlClient.xml" }),
    m({ nn: "csharp", loai: "method", ns: "Other.Lib", ten: "Other.WriteToServer", cha: "Other", chuKy: "WriteToServer()", tep: "Other.xml" }),
    ...Array.from({ length: 30 }, (_, i) =>
      m({ nn: "csharp", loai: "method", ns: `Ns${i}`, ten: `T${i}.Dispose`, cha: `T${i}`, chuKy: "Dispose()", tep: "x.xml" }),
    ),
    m({ nn: "csharp", loai: "type", ns: "Aaa", ten: "Aaa", tep: "a.xml" }),
    m({ nn: "csharp", loai: "type", ns: "Zzz", ten: "Zzzz", tep: "z.xml" }),
  ];
  const java = [
    m({ nn: "java", loai: "class", ns: "java.net.http", ten: "HttpClient", tomTat: "An HTTP Client.", _nhom: "j1", tep: "java.net.http/java/net/http/HttpClient.java" }),
    m({ nn: "java", loai: "method", ns: "java.net.http", ten: "HttpClient.newHttpClient", cha: "HttpClient", chuKy: "public static HttpClient newHttpClient()", _thuoc: "j1", tep: "java.net.http/java/net/http/HttpClient.java" }),
  ];
  const tsMuc = [
    m({ nn: "typescript", loai: "function", ns: "drizzle-orm", ten: "inArray", chuKy: "export declare function inArray<T>(column: T, values: T[]): SQL;", tep: "sql/expressions/conditions.d.ts" }),
    m({ nn: "typescript", loai: "class", ns: "node-opcua-client", ten: "HttpClient", tep: "fake.d.ts" }),
  ];
  vietChiMuc(
    thuMuc,
    [
      { id: "sqlclient", nn: "csharp", nhan: "Microsoft.Data.SqlClient 5.2.2", muc: sql },
      { id: "jdk", nn: "java", nhan: "JDK 26.0.1", muc: java },
      { id: "ts", nn: "typescript", nhan: "drizzle-orm 0.44.7", muc: tsMuc },
    ],
    { taoLuc: "2026-10-18T00:00:00Z" },
  );
  cm = moChiMucApi(thuMuc)!;
});

afterAll(() => {
  fs.rmSync(thuMuc, { recursive: true, force: true });
});

describe("chuanHoaTenTra", () => {
  it("đuôi tên + khoá: bỏ (), <T>, `1, khoảng trắng; tách theo . : # /", () => {
    expect(chuanHoaTenTra("SqlBulkCopyOptions")).toEqual({ khoa: "sqlbulkcopyoptions", duoi: "sqlbulkcopyoptions" });
    expect(chuanHoaTenTra(" SqlBulkCopy.WriteToServer() ")).toEqual({ khoa: "writetoserver", duoi: "sqlbulkcopy.writetoserver" });
    expect(chuanHoaTenTra("List<T>")).toEqual({ khoa: "list", duoi: "list" });
    expect(chuanHoaTenTra("System.Collections.Generic.List`1")).toEqual({ khoa: "list", duoi: "system.collections.generic.list" });
    expect(chuanHoaTenTra("drizzle-orm/pg-core#pgTable")).toEqual({ khoa: "pgtable", duoi: "drizzle-orm.pg-core.pgtable" });
    expect(chuanHoaTenTra("   ")).toBeNull();
  });
});

describe("moChiMucApi", () => {
  it("thư mục không có chỉ mục ⇒ null (không ném)", () => {
    expect(moChiMucApi(path.join(thuMuc, "khong-co"))).toBeNull();
  });

  it("★ SqlBulkCopyOptions ⇒ namespace + thành viên (KeepIdentity…)", () => {
    const r = cm.tra({ ten: "SqlBulkCopyOptions" });
    expect(r.khop).toHaveLength(1);
    expect(r.khop[0]).toMatchObject({ ns: "Microsoft.Data.SqlClient", ten: "SqlBulkCopyOptions", loai: "type", nguonNhan: "Microsoft.Data.SqlClient 5.2.2" });
    expect(r.khop[0].thanhVien!.map((t) => t.ten)).toEqual(["KeepIdentity", "TableLock"]);
  });

  it("★ KeepIdentity ⇒ nơi định nghĩa (kiểu chứa + namespace)", () => {
    const r = cm.tra({ ten: "KeepIdentity" });
    expect(r.khop.map((k) => [k.ns, k.cha, k.ten])).toEqual([["Microsoft.Data.SqlClient", "SqlBulkCopyOptions", "SqlBulkCopyOptions.KeepIdentity"]]);
  });

  it("NGUYÊN TÊN, không chuỗi con: `Copy` / `SqlBulk` ⇒ rỗng; không phân biệt hoa thường", () => {
    expect(cm.tra({ ten: "Copy" }).khop).toEqual([]);
    expect(cm.tra({ ten: "SqlBulk" }).khop).toEqual([]);
    expect(cm.tra({ ten: "sqlbulkcopyoptions" }).khop[0].ten).toBe("SqlBulkCopyOptions");
  });

  it("đuôi tên lọc đúng chủ: SqlBulkCopy.WriteToServer ⇒ không lẫn Other.WriteToServer", () => {
    expect(cm.tra({ ten: "WriteToServer" }).khop).toHaveLength(2);
    const r = cm.tra({ ten: "SqlBulkCopy.WriteToServer" });
    expect(r.khop.map((k) => k.ten)).toEqual(["SqlBulkCopy.WriteToServer"]);
    expect(cm.tra({ ten: "Microsoft.Data.SqlClient.SqlBulkCopy.WriteToServer" }).khop).toHaveLength(1);
  });

  it("lọc ngôn ngữ", () => {
    expect(cm.tra({ ten: "HttpClient" }).khop.map((k) => k.nn).sort()).toEqual(["java", "typescript"]);
    expect(cm.tra({ ten: "HttpClient", ngonNgu: "java" }).khop.map((k) => k.nn)).toEqual(["java"]);
    expect(cm.tra({ ten: "HttpClient", ngonNgu: "python" }).khop).toEqual([]);
    expect(cm.tra({ ten: "inArray", ngonNgu: "typescript" }).khop[0]).toMatchObject({ ns: "drizzle-orm", loai: "function" });
  });

  it("khoá đầu/cuối của tệp sắp xếp vẫn tìm được (tìm nhị phân không trượt biên)", () => {
    expect(cm.tra({ ten: "Aaa" }).khop).toHaveLength(1);
    expect(cm.tra({ ten: "Zzzz" }).khop).toHaveLength(1);
    expect(cm.tra({ ten: "zzzzz" }).khop).toHaveLength(0);
    expect(cm.tra({ ten: "a" }).khop).toHaveLength(0);
  });

  it("trần kết quả: tên phổ biến ⇒ tối đa `tran`, báo tổng + cắt", () => {
    const r = cm.tra({ ten: "Dispose", tran: 5 });
    expect(r.khop).toHaveLength(5);
    expect(r.tongKhop).toBe(30);
    expect(r.catBot).toBe(true);
  });
});

describe("dinhDangKetQuaApi — văn bản cho model", () => {
  it("có namespace, chữ ký, nguồn + phiên bản, danh sách thành viên; trần ký tự", () => {
    const v = dinhDangKetQuaApi("SqlBulkCopyOptions", cm.tra({ ten: "SqlBulkCopyOptions" }));
    expect(v).toContain("Microsoft.Data.SqlClient");
    expect(v).toContain("KeepIdentity");
    expect(v).toContain("Microsoft.Data.SqlClient 5.2.2");
    expect(v).toMatch(/using Microsoft\.Data\.SqlClient;/);
    const dai = dinhDangKetQuaApi("Dispose", cm.tra({ ten: "Dispose", tran: 20 }), 600);
    expect(dai.length).toBeLessThanOrEqual(700);
  });

  it("không khớp ⇒ nói thật, KHÔNG đoán", () => {
    const v = dinhDangKetQuaApi("Copy", cm.tra({ ten: "Copy" }));
    expect(v).toMatch(/No API symbol named "Copy"/);
    expect(v).toMatch(/do not guess/i);
  });
});
