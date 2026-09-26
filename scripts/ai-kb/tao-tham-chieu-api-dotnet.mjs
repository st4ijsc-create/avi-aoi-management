#!/usr/bin/env node
/**
 * R2 (kế hoạch AI Local 2026-09-22 §4) — dựng TÀI LIỆU THAM CHIẾU API .NET có cấu trúc cho corpus Studio
 * `csharp-dotnet`, từ tệp XML doc CÓ SẴN trên máy (không mạng):
 *   · `%ProgramFiles%/dotnet/packs/Microsoft.NETCore.App.Ref/<ver>/ref/net<ver>/System.Data.Common.xml`
 *   · `~/.nuget/packages/microsoft.data.sqlclient/<ver>/lib/net8.0/Microsoft.Data.SqlClient.xml`
 *
 * Mỗi KIỂU ⇒ một tệp `<Namespace.Type>.md`; mỗi THÀNH VIÊN ⇒ một mục `## Type.Member(ThamSo)` mang chữ
 * ký đầy đủ + tóm tắt + tham số + trả về + ngoại lệ. Dòng đầu `<!-- kb:chunk=ky-hieu -->` bảo
 * `kbIngestService` cắt THEO KÝ HIỆU (mỗi `##` một đoạn, kèm tên kiểu) thay vì 1.800 ký tự trơn — để
 * một đoạn truy hồi là một ký hiệu nguyên vẹn, không phải nửa bảng của hai phương thức.
 *
 * Phương thức mở rộng (vd `DataReaderExtensions.GetInt32(DbDataReader, String)`) ghi RÕ "mở rộng cho
 * DbDataReader — cần `using System.Data;`": đo 2026-09-23 trên net10.0, `reader.GetInt32("Ten")` biên
 * dịch ĐƯỢC khi có `using System.Data;` và ra CS1503 khi thiếu — thông tin mà tóm tắt XML không nói.
 *
 *   node scripts/ai-kb/tao-tham-chieu-api-dotnet.mjs [thuMucRa]     # mặc định tmp/api-ref/dotnet
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const RA = path.resolve(process.argv[2] ?? "tmp/api-ref/dotnet");

function timXmlNet() {
  const goc = path.join(process.env.ProgramFiles ?? "C:/Program Files", "dotnet", "packs", "Microsoft.NETCore.App.Ref");
  const ver = fs.readdirSync(goc).filter((v) => /^\d+\.\d+\.\d+$/.test(v)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
  const ref = path.join(goc, ver, "ref");
  const tf = fs.readdirSync(ref).find((d) => d.startsWith("net"));
  return { tep: path.join(ref, tf, "System.Data.Common.xml"), nhan: `.NET ${ver} (${tf})` };
}
function timXmlSqlClient() {
  const goc = path.join(os.homedir(), ".nuget", "packages", "microsoft.data.sqlclient");
  const ver = fs.readdirSync(goc).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
  return { tep: path.join(goc, ver, "lib", "net8.0", "Microsoft.Data.SqlClient.xml"), nhan: `Microsoft.Data.SqlClient ${ver}` };
}

/** Các kiểu đưa vào — tầng ADO.NET mà đơn hàng C# + SQL Server thực sự chạm. */
const KIEU = {
  net: [
    "System.Data.DataReaderExtensions", "System.Data.IDataRecord", "System.Data.IDataReader", "System.Data.Common.DbDataReader",
    "System.Data.Common.DbCommand", "System.Data.Common.DbConnection", "System.Data.DataTable", "System.Data.DataRow",
    "System.Data.DataRowExtensions", "System.Data.CommandType", "System.Data.ConnectionState", "System.Data.IsolationLevel",
    "System.Data.SqlDbType", "System.Data.DbType", "System.Data.ParameterDirection", "System.Data.CommandBehavior",
  ],
  sql: [
    "Microsoft.Data.SqlClient.SqlConnection", "Microsoft.Data.SqlClient.SqlCommand", "Microsoft.Data.SqlClient.SqlDataReader",
    "Microsoft.Data.SqlClient.SqlParameter", "Microsoft.Data.SqlClient.SqlParameterCollection", "Microsoft.Data.SqlClient.SqlTransaction",
    "Microsoft.Data.SqlClient.SqlBulkCopy", "Microsoft.Data.SqlClient.SqlException", "Microsoft.Data.SqlClient.SqlConnectionStringBuilder",
    "Microsoft.Data.SqlClient.SqlDataAdapter",
  ],
};

const giaiMa = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tenNgan = (cref) => cref.replace(/^[TMPFE]:/, "").replace(/`+\d+/g, "").split("(")[0];

/** XML doc → văn bản đọc được: cref/xref thành `Ten`, bỏ thẻ định dạng, gọn khoảng trắng. */
function lamPhang(x) {
  return giaiMa(
    x
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<see\s+cref="([^"]+)"\s*\/>/g, (_, c) => `\`${tenNgan(c)}\``)
      .replace(/<see\s+langword="([^"]+)"\s*\/>/g, "`$1`")
      .replace(/<paramref\s+name="([^"]+)"\s*\/>/g, "`$1`")
      .replace(/<typeparamref\s+name="([^"]+)"\s*\/>/g, "`$1`")
      .replace(/<xref:([^>]+)>/g, (_, c) => `\`${decodeURIComponent(c).replace(/%2A|\*$/g, "").replace(/\?.*$/, "")}\``)
      .replace(/<\/?(para|c|code|format|remarks|list|item|description|term|b|i)[^>]*>/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    // Tiêu đề markdown NHÚNG trong remarks ("## Remarks", "## Examples") hạ xuống chữ thường: để nguyên thì
    // chunkTheoKyHieu tách chúng thành "ký hiệu" mồ côi không mang tên thành viên (đo: 335 mục như thế).
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .trim();
}

function the(noi, ten) {
  const m = noi.match(new RegExp(`<${ten}(?:\\s[^>]*)?>([\\s\\S]*?)</${ten}>`));
  return m ? lamPhang(m[1]) : "";
}

/** "M:NS.Type.Method(System.Int32,System.String)" ⇒ { kieu, thanhVien, thamSo[] }. */
function tachTen(ten) {
  const loai = ten[0];
  const than = ten.slice(2);
  const i = than.indexOf("(");
  const truoc = i >= 0 ? than.slice(0, i) : than;
  const thamSoDay = i >= 0 ? than.slice(i + 1, -1).split(/,(?![^{]*})/).map((t) => t.replace(/`+\d+/g, "").replace(/\{/g, "<").replace(/\}/g, ">")) : [];
  const thamSo = thamSoDay.map((t) => t.split(".").pop());
  const cham = truoc.lastIndexOf(".");
  return { loai, kieu: loai === "T" ? truoc : truoc.slice(0, cham), thanhVien: loai === "T" ? "" : truoc.slice(cham + 1).replace(/``\d+/, "<T>"), thamSo, thamSoDay };
}

function docXml(tep) {
  const xml = fs.readFileSync(tep, "utf8");
  const ds = [];
  for (const m of xml.matchAll(/<member name="([^"]+)">([\s\S]*?)<\/member>/g)) ds.push({ ten: giaiMa(m[1]), noi: m[2] });
  return ds;
}

function viet(nguon, danhSachKieu) {
  const thanhVien = docXml(nguon.tep);
  let soTep = 0;
  let soMuc = 0;
  for (const kieu of danhSachKieu) {
    const cua = thanhVien.filter((m) => tachTen(m.ten).kieu === kieu);
    if (cua.length === 0) {
      console.warn(`  ⚠ không thấy kiểu ${kieu} trong ${path.basename(nguon.tep)}`);
      continue;
    }
    const tenKieu = kieu.split(".").pop();
    const moRong = /Extensions$/.test(tenKieu);
    const dau = cua.find((m) => m.ten.startsWith("T:"));
    const nsKieu = kieu.slice(0, kieu.lastIndexOf("."));
    // Dòng `# …` đi kèm MỌI đoạn (chunkTheoKyHieu) ⇒ không gian tên có mặt ở từng ký hiệu truy hồi được.
    const dong = ["<!-- kb:chunk=ky-hieu -->", `# ${kieu} — cần \`using ${nsKieu};\``, "", `Nguồn: tài liệu XML chính thức — ${nguon.nhan}.`];
    if (dau) dong.push("", the(dau.noi, "summary"));
    for (const m of cua.filter((x) => !x.ten.startsWith("T:"))) {
      const t = tachTen(m.ten);
      const ky = t.loai === "M" ? `${tenKieu}.${t.thanhVien}(${t.thamSo.join(", ")})` : `${tenKieu}.${t.thanhVien}`;
      const loaiTen = { M: t.thanhVien === "#ctor" ? "hàm dựng" : "phương thức", P: "thuộc tính", F: "trường", E: "sự kiện" }[t.loai] ?? t.loai;
      dong.push("", `## ${ky.replace("#ctor", tenKieu)}`, "", `${loaiTen} của \`${kieu}\` — ký hiệu đầy đủ \`${m.ten}\`.`);
      if (moRong && t.loai === "M" && t.thamSo.length > 0) {
        const ns = kieu.slice(0, kieu.lastIndexOf("."));
        dong.push(`Phương thức MỞ RỘNG cho \`${t.thamSo[0]}\` — gọi dạng \`doiTuong.${t.thanhVien}(${t.thamSo.slice(1).join(", ")})\`, cần \`using ${ns};\` (thiếu using ⇒ trình biên dịch chỉ thấy các overload gốc của \`${t.thamSo[0]}\`).`);
      }
      // Kiểu tham số ở KHÔNG GIAN TÊN KHÁC (vd `SqlParameter(String, SqlDbType)` ⇒ SqlDbType ở System.Data):
      // đo 2026-09-23, D1 trượt vì `SqlDbType` CS0103 — model dùng đúng kiểu nhưng thiếu `using`.
      const ngoai = [...new Set((t.thamSoDay ?? []).map((x) => x.replace(/[<>\[\]@*&].*$/, "")).filter((x) => x.includes(".") && !x.startsWith("System.") ? true : /^System\.(Data|Data\.Common)\./.test(x)))]
        .map((x) => [x.split(".").pop(), x.slice(0, x.lastIndexOf("."))])
        .filter(([, ns]) => ns !== nsKieu);
      if (ngoai.length) dong.push(`Kiểu trong chữ ký: ${ngoai.map(([k, ns]) => `\`${k}\` (\`using ${ns};\`)`).join(", ")}.`);
      const tom = the(m.noi, "summary");
      if (tom) dong.push("", tom);
      for (const p of m.noi.matchAll(/<param name="([^"]+)">([\s\S]*?)<\/param>/g)) dong.push(`- Tham số \`${p[1]}\`: ${lamPhang(p[2])}`);
      const tra = the(m.noi, "returns");
      if (tra) dong.push(`- Trả về: ${tra}`);
      const gt = the(m.noi, "value");
      if (gt) dong.push(`- Giá trị: ${gt}`);
      for (const e of m.noi.matchAll(/<exception cref="([^"]+)">([\s\S]*?)<\/exception>/g)) dong.push(`- Ngoại lệ \`${tenNgan(e[1])}\`: ${lamPhang(e[2])}`);
      const ghi = the(m.noi, "remarks");
      if (ghi) dong.push("", ghi.slice(0, 700));
      soMuc++;
    }
    fs.writeFileSync(path.join(RA, `${kieu}.md`), dong.join("\n") + "\n");
    soTep++;
  }
  console.log(`${nguon.nhan}: ${soTep} tệp, ${soMuc} ký hiệu`);
}

/**
 * R2 phần B — CHỈ MỤC "kiểu/phương thức mở rộng → không gian tên" cho bộ bổ sung `using` sau sinh mã
 * (`server/services/ai/boSungUsingCSharp.ts`). Lấy TOÀN BỘ kiểu công khai của các không gian tên ADO.NET
 * trong hai tệp XML (không chỉ danh sách KIEU ở trên) — một kiểu thiếu trong chỉ mục là một `using`
 * không bao giờ được bổ sung. Tệp nhỏ, tất định, commit vào repo: `knowledge/api-ref/dotnet-using.json`.
 */
function chiMucUsing(nguonDs) {
  const NS = /^(System\.Data|System\.Data\.Common|System\.Data\.SqlTypes|Microsoft\.Data\.SqlClient)$/;
  const kieu = {};
  const moRong = {};
  for (const nguon of nguonDs) {
    for (const m of docXml(nguon.tep)) {
      const t = tachTen(m.ten);
      if (t.loai === "T") {
        const ns = t.kieu.slice(0, t.kieu.lastIndexOf("."));
        const ten = t.kieu.slice(t.kieu.lastIndexOf(".") + 1);
        if (!NS.test(ns) || ten.includes("+")) continue;
        (kieu[ten] ??= []).includes(ns) || kieu[ten].push(ns);
      } else if (t.loai === "M" && /Extensions$/.test(t.kieu) && (t.thamSoDay?.length ?? 0) >= 2) {
        const ns = t.kieu.slice(0, t.kieu.lastIndexOf("."));
        if (!NS.test(ns)) continue;
        const tenPt = t.thanhVien.replace(/<T>$/, "");
        const muc = (moRong[tenPt] ??= { ns, doiTuong: [], thamSo2: [] });
        const dt = t.thamSo[0];
        if (!muc.doiTuong.includes(dt)) muc.doiTuong.push(dt);
        const ts2 = t.thamSo[1];
        if (!muc.thamSo2.includes(ts2)) muc.thamSo2.push(ts2);
      }
    }
  }
  return { nguon: nguonDs.map((n) => n.nhan), kieu, moRong };
}

fs.mkdirSync(RA, { recursive: true });
const NGUON_NET = timXmlNet();
const NGUON_SQL = timXmlSqlClient();
viet(NGUON_NET, KIEU.net);
viet(NGUON_SQL, KIEU.sql);
const CHI_MUC = path.resolve("knowledge/api-ref/dotnet-using.json");
fs.mkdirSync(path.dirname(CHI_MUC), { recursive: true });
const cm = chiMucUsing([NGUON_NET, NGUON_SQL]);
fs.writeFileSync(CHI_MUC, JSON.stringify(cm, null, 1) + "\n");
console.log(`→ ${RA}\n→ ${CHI_MUC}: ${Object.keys(cm.kieu).length} kiểu, ${Object.keys(cm.moRong).length} phương thức mở rộng`);
