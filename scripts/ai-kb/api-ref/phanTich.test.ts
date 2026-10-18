/**
 * ★ Chỉ mục ký hiệu API cục bộ (khuyến nghị #1, báo cáo 2026-10-18) — lưới cho các bộ PHÂN TÍCH thuần của bộ dựng
 * `dung-chi-muc-api.mjs` và bộ GHI chỉ mục. Mẫu đầu vào là trích đoạn NGUYÊN DẠNG của nguồn thật (XML IntelliSense,
 * mã nguồn JDK, .d.ts) thu nhỏ.
 *
 * ĐỘT BIẾN PHẢI BẮT: kiểu lồng nhau (`T:System.Environment.SpecialFolder`) bị coi là namespace `System.Environment` ·
 * thành viên của kiểu không vào khối thành viên của kiểu · cài đặt giao diện tường minh (`System#IDisposable#Dispose`) lọt
 * vào bề mặt API · phương thức `private`/lớp không `public` của JDK lọt vào · thân phương thức Java (chứa `{` `}` trong
 * chuỗi) làm lệch độ sâu ⇒ thành viên sau gán nhầm kiểu · khai báo KHÔNG export của module .d.ts lọt vào · khoá chỉ mục
 * không sắp xếp ⇒ tìm nhị phân trượt.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
// @ts-expect-error — mô-đun .mjs không có khai báo kiểu
import { tachIdXml, mucTuXmlDotnet, mucTuJava, mucTuTs, goiXuatJava, khoaCua, vietChiMuc } from "./phanTich.mjs";

type Muc = {
  nn: string;
  loai: string;
  ns: string;
  ten: string;
  cha?: string;
  chuKy: string;
  tomTat: string;
  loiThoi?: boolean;
  _nhom?: string;
  _thuoc?: string;
};

const XML = `<?xml version="1.0" encoding="utf-8"?>
<doc>
  <assembly><name>Microsoft.Data.SqlClient</name></assembly>
  <members>
    <member name="T:Microsoft.Data.SqlClient.SqlBulkCopyOptions">
      <summary>Bitwise flag that specifies one or more options to use with an instance of <see cref="T:Microsoft.Data.SqlClient.SqlBulkCopy" />.</summary>
      <remarks>long remarks</remarks>
    </member>
    <member name="F:Microsoft.Data.SqlClient.SqlBulkCopyOptions.KeepIdentity">
      <summary>Preserve source identity values. When not specified, identity values are assigned by the destination.</summary>
    </member>
    <member name="F:Microsoft.Data.SqlClient.SqlBulkCopyOptions.CheckConstraints">
      <summary>Check constraints while data is being inserted.</summary>
    </member>
    <member name="T:Microsoft.Data.SqlClient.SqlBulkCopy">
      <summary>Lets you efficiently bulk load a SQL Server table.</summary>
    </member>
    <member name="M:Microsoft.Data.SqlClient.SqlBulkCopy.#ctor(System.String,Microsoft.Data.SqlClient.SqlBulkCopyOptions)">
      <summary>Initializes a new instance.</summary>
    </member>
    <member name="M:Microsoft.Data.SqlClient.SqlBulkCopy.WriteToServer(System.Data.DataTable)">
      <summary>Copies all rows in the supplied <see cref="T:System.Data.DataTable" /> to a destination table.</summary>
    </member>
    <member name="M:Microsoft.Data.SqlClient.SqlBulkCopy.System#IDisposable#Dispose">
      <summary>explicit impl</summary>
    </member>
    <member name="P:Microsoft.Data.SqlClient.SqlBulkCopy.BatchSize">
      <summary>Number of rows in each batch.</summary>
    </member>
    <member name="T:System.Environment">
      <summary>Provides information about the current environment.</summary>
    </member>
    <member name="T:System.Environment.SpecialFolder">
      <summary>Specifies enumerated constants used to retrieve directory paths to system special folders.</summary>
    </member>
    <member name="F:System.Environment.SpecialFolder.Desktop">
      <summary>The logical Desktop.</summary>
    </member>
    <member name="T:System.Linq.Enumerable">
      <summary>Provides static methods.</summary>
    </member>
    <member name="M:System.Linq.Enumerable.Where\`\`1(System.Collections.Generic.IEnumerable{\`\`0},System.Func{\`\`0,System.Boolean})">
      <typeparam name="TSource">The type of the elements.</typeparam>
      <summary>Filters a sequence of values based on a predicate.</summary>
    </member>
  </members>
</doc>`;

describe("tachIdXml", () => {
  it("tách loại · tên chứa · thành viên · tham số (generic {} ⇒ <>)", () => {
    expect(tachIdXml("F:Microsoft.Data.SqlClient.SqlBulkCopyOptions.KeepIdentity")).toMatchObject({
      loai: "F",
      chua: "Microsoft.Data.SqlClient.SqlBulkCopyOptions",
      thanhVien: "KeepIdentity",
      thamSo: [],
    });
    const w = tachIdXml("M:System.Linq.Enumerable.Where``1(System.Collections.Generic.IEnumerable{``0},System.Func{``0,System.Boolean})");
    expect(w.chua).toBe("System.Linq.Enumerable");
    expect(w.thanhVien).toBe("Where");
    expect(w.soThamSoKieu).toBe(1);
    expect(w.thamSo).toEqual(["System.Collections.Generic.IEnumerable<``0>", "System.Func<``0,System.Boolean>"]);
  });
});

describe("mucTuXmlDotnet", () => {
  const ds: Muc[] = mucTuXmlDotnet(XML, { tep: "Microsoft.Data.SqlClient.xml" });
  const tim = (ten: string) => ds.find((m) => m.ten === ten);

  it("kiểu: namespace đúng, tóm tắt làm phẳng cref", () => {
    const k = tim("SqlBulkCopyOptions")!;
    expect(k).toMatchObject({ nn: "csharp", loai: "type", ns: "Microsoft.Data.SqlClient" });
    expect(k.tomTat).toContain("`SqlBulkCopy`");
    expect(k.tomTat).not.toContain("remarks");
  });

  it("thành viên enum ⇒ field của kiểu, thuộc khối thành viên của kiểu", () => {
    const k = tim("SqlBulkCopyOptions")!;
    const v = tim("SqlBulkCopyOptions.KeepIdentity")!;
    expect(v).toMatchObject({ loai: "field", ns: "Microsoft.Data.SqlClient", cha: "SqlBulkCopyOptions" });
    expect(v._thuoc).toBe(k._nhom);
  });

  it("kiểu LỒNG: namespace là System, tên là Environment.SpecialFolder", () => {
    expect(tim("Environment.SpecialFolder")).toMatchObject({ loai: "type", ns: "System" });
    expect(tim("Environment.SpecialFolder.Desktop")).toMatchObject({ cha: "Environment.SpecialFolder", ns: "System" });
  });

  it("chữ ký: phương thức + hàm dựng + thuộc tính; System.X rút gọn, namespace khác giữ nguyên; generic có tên typeparam", () => {
    expect(tim("SqlBulkCopy.WriteToServer")!.chuKy).toBe("WriteToServer(System.Data.DataTable)");
    const ctor = ds.find((m) => m.loai === "ctor" && m.cha === "SqlBulkCopy")!;
    expect(ctor.chuKy).toBe("SqlBulkCopy(String, Microsoft.Data.SqlClient.SqlBulkCopyOptions)");
    expect(tim("SqlBulkCopy.BatchSize")).toMatchObject({ loai: "property", chuKy: "BatchSize" });
    expect(tim("Enumerable.Where")!.chuKy).toBe("Where<TSource>(System.Collections.Generic.IEnumerable<TSource>, Func<TSource,Boolean>)");
  });

  it("KHÔNG đưa cài đặt giao diện tường minh vào bề mặt API", () => {
    expect(ds.some((m) => m.ten.includes("#") || m.chuKy.includes("#"))).toBe(false);
  });
});

const JAVA = `/*
 * Copyright (c) Oracle
 */
package java.net.http;

import java.util.Optional;

/**
 * An HTTP Client.
 *
 * <p> More text.
 * @since 11
 */
public abstract class HttpClient implements AutoCloseable {

    /** Creates an HttpClient. */
    protected HttpClient() {}

    /**
     * Returns a new {@code HttpClient} with default settings.
     * @return a new HttpClient
     */
    public static HttpClient newHttpClient() {
        String s = "}{ not a brace";
        char c = '}';
        return newBuilder().build();
    }

    private static void hidden() { }

    /** Internal default timeout. */
    static final int PACKAGE_PRIVATE = 1;

    /** Maximum redirects. */
    public static final int MAX = 5, OTHER = 6;

    /**
     * A builder of HTTP Clients.
     */
    public interface Builder {
        /** Sets the version. @param v the version */
        Builder version(HttpClient.Version v);

        /** Builds. */
        public HttpClient build();
    }

    /**
     * The HTTP protocol version.
     */
    public enum Version {
        /** HTTP version 1.1 */
        HTTP_1_1,
        /** HTTP version 2 */
        HTTP_2
    }

    /**
     * Old method.
     * @deprecated use newHttpClient
     */
    @Deprecated(since = "17", forRemoval = true)
    public void old() { }

    /** Sends. */
    public abstract <T> HttpResponse<T> send(HttpRequest req, HttpResponse.BodyHandler<T> handler)
        throws java.io.IOException, InterruptedException;
}

class PackagePrivate {
    /** nope */
    public void x() {}
}
`;

describe("mucTuJava", () => {
  const ds: Muc[] = mucTuJava(JAVA, { tep: "java.net.http/java/net/http/HttpClient.java" });
  const ten = ds.map((m) => m.ten);
  const tim = (t: string) => ds.find((m) => m.ten === t);

  it("lớp public + javadoc câu đầu; thành viên public/protected; KHÔNG private/package-private/lớp không public", () => {
    expect(tim("HttpClient")).toMatchObject({ nn: "java", loai: "class", ns: "java.net.http", tomTat: "An HTTP Client." });
    expect(tim("HttpClient.newHttpClient")).toMatchObject({ loai: "method", cha: "HttpClient" });
    expect(tim("HttpClient.newHttpClient")!.tomTat).toBe("Returns a new HttpClient with default settings.");
    expect(tim("HttpClient.newHttpClient")!.chuKy).toBe("public static HttpClient newHttpClient()");
    expect(ten).not.toContain("HttpClient.hidden");
    expect(ten).not.toContain("HttpClient.PACKAGE_PRIVATE");
    expect(ten.some((t) => t.startsWith("PackagePrivate"))).toBe(false);
    expect(ds.find((m) => m.loai === "ctor")).toMatchObject({ cha: "HttpClient", chuKy: "protected HttpClient()" });
  });

  it("chuỗi/ký tự chứa ngoặc nhọn trong thân không làm lệch độ sâu", () => {
    expect(tim("HttpClient.MAX")).toMatchObject({ loai: "field", cha: "HttpClient", chuKy: "public static final int MAX" });
    expect(tim("HttpClient.send")!.chuKy).toContain("send(HttpRequest req, HttpResponse.BodyHandler<T> handler)");
  });

  it("giao diện lồng: thành viên không ghi public vẫn là public; enum: hằng có javadoc", () => {
    expect(tim("HttpClient.Builder")).toMatchObject({ loai: "interface", cha: "HttpClient" });
    expect(tim("HttpClient.Builder.version")).toMatchObject({ loai: "method", cha: "HttpClient.Builder" });
    expect(tim("HttpClient.Builder.build")).toBeTruthy();
    expect(tim("HttpClient.Version.HTTP_1_1")).toMatchObject({ loai: "enum-constant", tomTat: "HTTP version 1.1" });
    expect(tim("HttpClient.Version.HTTP_2")).toBeTruthy();
    const v = tim("HttpClient.Version")!;
    expect(tim("HttpClient.Version.HTTP_2")!._thuoc).toBe(v._nhom);
  });

  it("@Deprecated / @deprecated ⇒ loiThoi", () => {
    expect(tim("HttpClient.old")!.loiThoi).toBe(true);
    expect(tim("HttpClient.newHttpClient")!.loiThoi).toBeFalsy();
  });

  it("goiXuatJava: chỉ exports KHÔNG giới hạn", () => {
    const mi = `module java.base {\n exports java.lang;\n exports java.util.concurrent;\n exports jdk.internal.misc to java.desktop, jdk.unsupported;\n}`;
    expect([...goiXuatJava(mi)].sort()).toEqual(["java.lang", "java.util.concurrent"]);
  });
});

describe("mucTuTs", () => {
  it("module: CHỈ khai báo export; thành viên interface; JSDoc + @deprecated", () => {
    const src = `
import type { X } from "./x";
/** Options for connect. */
export interface ClientOptions {
  /** Keepalive seconds. */
  keepalive?: number;
  /** @deprecated use keepalive */
  old?: boolean;
  connect(url: string): Promise<void>;
}
interface Hidden { a: number }
/** Creates a table. */
export declare function pgTable<T>(name: string, cols: T): Table<T>;
export declare const VERSION: string;
declare function noiBo(): void;
export { noiBo as congKhai };
`;
    const ds: Muc[] = mucTuTs(ts, src, { tep: "pg-core/table.d.ts", module: "drizzle-orm/pg-core" });
    const ten = ds.map((m) => m.ten).sort();
    expect(ten).toEqual(["ClientOptions", "ClientOptions.connect", "ClientOptions.keepalive", "ClientOptions.old", "VERSION", "congKhai", "pgTable"]);
    const f = ds.find((m) => m.ten === "pgTable")!;
    expect(f).toMatchObject({ nn: "typescript", loai: "function", ns: "drizzle-orm/pg-core", tomTat: "Creates a table." });
    expect(f.chuKy).toBe("export declare function pgTable<T>(name: string, cols: T): Table<T>;");
    expect(ds.find((m) => m.ten === "ClientOptions.old")!.loiThoi).toBe(true);
    expect(ds.find((m) => m.ten === "ClientOptions")!.chuKy).toBe("export interface ClientOptions");
  });

  it("tệp toàn cục (lib) + `declare module \"fs\"` + `export =` namespace", () => {
    const lib = `interface Array<T> {\n  /** Returns the index. */\n  indexOf(searchElement: T, fromIndex?: number): number;\n}\ndeclare var Array: ArrayConstructor;`;
    const a: Muc[] = mucTuTs(ts, lib, { tep: "lib.es5.d.ts", module: "" });
    expect(a.find((m) => m.ten === "Array.indexOf")).toMatchObject({ ns: "", loai: "method", tomTat: "Returns the index." });

    const node = `declare module "fs" {\n  /** Reads a file. */\n  export function readFileSync(path: string): Buffer;\n}`;
    const n: Muc[] = mucTuTs(ts, node, { tep: "fs.d.ts", module: "" });
    expect(n.find((m) => m.ten === "readFileSync")).toMatchObject({ ns: "fs", loai: "function" });

    const react = `export = React;\nexport as namespace React;\ndeclare namespace React {\n  /** State hook. */\n  function useState<S>(s: S): [S, (v: S) => void];\n}`;
    const r: Muc[] = mucTuTs(ts, react, { tep: "index.d.ts", module: "react" });
    expect(r.find((m) => m.ten === "useState")).toMatchObject({ ns: "react", loai: "function", tomTat: "State hook." });
  });
});

describe("khoaCua + vietChiMuc", () => {
  it("khoá = tên NGẮN chữ thường; hàm dựng không có khoá riêng; tên không ASCII bị bỏ", () => {
    expect(khoaCua({ ten: "SqlBulkCopyOptions.KeepIdentity", loai: "field" })).toBe("keepidentity");
    expect(khoaCua({ ten: "SqlBulkCopy", loai: "ctor" })).toBeNull();
    expect(khoaCua({ ten: "Đ", loai: "function" })).toBeNull();
  });

  it("ghi muc.jsonl + chi-muc.tsv sắp xếp byte + meta; khối thành viên đứng TRƯỚC dòng kiểu, kiểu trỏ tới khối", () => {
    const thuMuc = fs.mkdtempSync(path.join(os.tmpdir(), "api-ref-"));
    const ds: Muc[] = mucTuXmlDotnet(XML, { tep: "Microsoft.Data.SqlClient.xml" });
    const tk = vietChiMuc(thuMuc, [{ id: "sqlclient", nn: "csharp", nhan: "Microsoft.Data.SqlClient 5.2.2", muc: ds }], { taoLuc: "x" });
    expect(tk.soMuc).toBe(ds.length);
    const tsv = fs.readFileSync(path.join(thuMuc, "chi-muc.tsv"), "utf8").trimEnd().split("\n");
    const khoa = tsv.map((d) => d.split("\t")[0]);
    expect([...khoa].sort()).toEqual(khoa);
    expect(new Set(khoa).size).toBe(khoa.length);
    const buf = fs.readFileSync(path.join(thuMuc, "muc.jsonl"));
    const dongKhoa = tsv.find((d) => d.startsWith("sqlbulkcopyoptions\t"))!;
    const [o, l] = dongKhoa.split("\t")[1].split(",")[0].split(".").map((x) => parseInt(x, 36));
    const kieu = JSON.parse(buf.subarray(o, o + l).toString("utf8"));
    expect(kieu).toMatchObject({ ten: "SqlBulkCopyOptions", nguon: 0, tep: "Microsoft.Data.SqlClient.xml" });
    expect(kieu._nhom).toBeUndefined();
    const [to, tl, tn] = kieu.tv;
    expect(tn).toBe(2);
    expect(to + tl).toBeLessThanOrEqual(o);
    const tv = buf.subarray(to, to + tl).toString("utf8").trimEnd().split("\n").map((x) => JSON.parse(x).ten);
    expect(tv).toEqual(["SqlBulkCopyOptions.KeepIdentity", "SqlBulkCopyOptions.CheckConstraints"]);
    const meta = JSON.parse(fs.readFileSync(path.join(thuMuc, "meta.json"), "utf8"));
    expect(meta.nguon[0]).toMatchObject({ id: "sqlclient", nn: "csharp", soMuc: ds.length });
    fs.rmSync(thuMuc, { recursive: true, force: true });
  });
});
