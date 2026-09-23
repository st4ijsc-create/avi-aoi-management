/**
 * ★★★ BỘ ĐO **DỰ ÁN THẬT** — ba đơn hàng kiểu người dùng thật đặt, không phải bài tập.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO CẦN BỘ ĐO THỨ BA
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `tasks-hard.json` đo *"một hàm thuần có chạy không"*; `agentic.mjs` đo *"sửa lỗi có xanh không"*.
 * Cả hai đều KHÔNG trả lời câu mà chủ dự án hỏi: **"đưa nó một đơn hàng thật — app quản lý học
 * sinh, app bán hàng tạp hoá, website công ty — nó có làm ra thứ DÙNG ĐƯỢC không?"**
 *
 * Ba đơn hàng (do chủ dự án đặt, 2026-09-22):
 *   D1  C# + SQL   — quản lý học sinh trường cấp 2
 *   D2  C# + SQL   — bán hàng + kho cho tiệm tạp hoá
 *   D3  PostgreSQL + React/Node — website giới thiệu Công ty TNHH ST4I (tự động hoá)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ĐO CÁI GÌ — VÀ VÌ SAO KHÔNG ĐO "TRÔNG CÓ VẺ ĐÚNG"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Một bản phác hoành tráng mà không biên dịch nổi thì vô dụng. Nên mọi cổng ở đây đều do MÁY chạy:
 *
 *   • `soKhoiMa`     — đếm khối mã thật sự sinh ra (0 khối = trả lời suông ⇒ trượt thẳng);
 *   • `sqlPhanTich`  — mọi khối SQL được PostgreSQL THẬT phân tích (`PREPARE`/`EXPLAIN` trong một
 *                      giao dịch rồi `ROLLBACK` — KHÔNG đụng lược đồ thật);
 *   • `csBienDich`   — mọi khối C# được `dotnet build` THẬT;
 *   • `jsPhanTich`   — mọi khối JS/TS được `node --check` (CommonJS) hoặc bóc kiểu (TS/JSX);
 *   • `coBang`/`coCot` — lược đồ có nêu đúng thực thể nghiệp vụ mà đơn hàng đòi không.
 *
 * ⚠ Đây là phép đo **TÍNH ĐÚNG CỦA HIỆN VẬT**, không phải phép đo "đẹp/xấu". Nó không nói dự án có
 *   chạy được end-to-end — nó nói *"những gì model vừa đưa cho bạn có biên dịch/phân tích được không"*.
 *   Ranh giới đó phải nói ra, vì vượt nó là hứa quá.
 */
import fs from "node:fs";
import { execSync } from "node:child_process";
import { ck } from "./cookie.mjs";

/**
 * ★★★ PHẢI LÀ POSTGRES **CỤC BỘ**, VÀ ĐÂY KHÔNG PHẢI CHUYỆN TIỆN TAY.
 *
 * Bản đầu của tệp này đọc `DATABASE_URL` từ `.env` — và `.env` của repo trỏ tới một instance
 * **Supabase TỪ XA**. Tức bộ chấm bài đã chạy `CREATE TABLE` do một model sinh ra lên một cơ sở
 * dữ liệu không nằm trên máy này. Lượt ấy nằm trong giao dịch và đã `ROLLBACK`, lại còn bị chặn
 * bởi quyền (`permission denied for schema public`), nên không một byte nào của DB kia đổi — nhưng
 * "không gây hại" là một KẾT QUẢ MAY MẮN, không phải một thiết kế. Một bộ đo chấm mã do máy sinh
 * ra thì phải chạy trên một cái đích **dùng xong vứt đi được**.
 *
 * ⇒ Ghim cứng Postgres cục bộ và mỗi khối SQL chạy trong một LƯỢC ĐỒ TẠM riêng, xoá ngay sau đó.
 */
const PG_CUC_BO = "postgres://aoi:aoi@127.0.0.1:5434/aoi_management";

const ROOT = "D:/SOURCES/avi-aoi-management";
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const CK = ck(arg("--cookie", `${ROOT}/tmp/audit-ai/ck.txt`));
const LABEL = arg("--label", "duan");
const ONLY = arg("--only", null);
const WORK = `${ROOT}/tmp/duan-work/${LABEL}`;

const DU_AN = [
  {
    id: "D1",
    ten: "Quản lý học sinh cấp 2 (C# + SQL)",
    q: "Viết cho tôi phần cốt lõi của một app quản lý học sinh cho trường cấp 2, dùng C# và SQL Server. Cần: (1) một khối SQL tạo bảng cho học sinh, lớp, giáo viên, môn học và điểm — có khoá chính, khoá ngoại và ràng buộc điểm 0..10; (2) một lớp C# `HocSinhRepository` với các phương thức ThemHocSinh, LayTheoLop, TinhDiemTrungBinh dùng ADO.NET tham số hoá (KHÔNG nối chuỗi SQL). Trả mã trong các khối ```sql và ```csharp riêng.",
    lang: ["sql", "cs"], phuongNgu: "tsql",
    bangCan: ["hoc_sinh|HocSinh|students?", "lop|Lop|class", "giao_vien|GiaoVien|teacher", "mon_hoc|MonHoc|subject", "diem|Diem|score|grade"],
    cotCan: ["primary key", "foreign key|references", "check"],
  },
  {
    id: "D2",
    ten: "Bán hàng + kho tiệm tạp hoá (C# + SQL)",
    q: "Viết phần cốt lõi của một app bán hàng và quản lý kho đơn giản cho tiệm tạp hoá, dùng C# và SQL Server. Cần: (1) khối SQL tạo bảng hàng hoá, nhà cung cấp, phiếu nhập, hoá đơn bán và chi tiết hoá đơn — có khoá ngoại và ràng buộc số lượng không âm; (2) lớp C# `BanHangService` với BanHang(maHang, soLuong) phải TRỪ TỒN KHO và TỪ CHỐI khi không đủ hàng, dùng giao dịch. Trả mã trong các khối ```sql và ```csharp riêng.",
    lang: ["sql", "cs"], phuongNgu: "tsql",
    bangCan: ["hang_hoa|HangHoa|product", "nha_cung_cap|NhaCungCap|supplier", "phieu_nhap|PhieuNhap|receipt|import", "hoa_don|HoaDon|invoice|order", "chi_tiet|ChiTiet|detail|item"],
    cotCan: ["foreign key|references", "check"],
  },
  {
    id: "D3",
    ten: "Website công ty ST4I (PostgreSQL + React/Node)",
    q: "Viết phần cốt lõi của một website giới thiệu công ty cho Công ty TNHH ST4I — một công ty làm máy tự động hoá. Dùng PostgreSQL + Node.js (Express) + React. Cần: (1) khối SQL PostgreSQL tạo bảng cho sản phẩm máy, dự án tiêu biểu, tin tức và liên hệ khách hàng; (2) một file Node.js Express khai các route GET /api/san-pham, GET /api/du-an và POST /api/lien-he có kiểm tra đầu vào; (3) một component React hiển thị danh sách sản phẩm. Trả mã trong các khối ```sql, ```javascript và ```jsx riêng.",
    lang: ["sql", "js"], phuongNgu: "pg",
    bangCan: ["san_pham|SanPham|product", "du_an|DuAn|project", "tin_tuc|TinTuc|news|post", "lien_he|LienHe|contact"],
    // ⚠ KHÔNG đòi khoá ngoại ở đây: sản phẩm · dự án · tin tức · liên hệ là BỐN thực thể độc lập
    //   trong một website giới thiệu. Bản đầu có đòi, và nó ghi "thiếu ràng buộc" cho một lược đồ
    //   đúng — tức một kỳ vọng của NGƯỜI ĐO bị tính thành lỗi của bài.
    cotCan: ["primary key"],
  },
].filter((d) => !ONLY || ONLY.split(",").includes(d.id));

// ─────────────────────────────────────────────────────────── TÁCH KHỐI MÃ THEO NGÔN NGỮ
const khoiTheoNgonNgu = (text) => {
  const ra = { sql: [], cs: [], js: [] };
  for (const m of text.matchAll(/```([a-zA-Z#+]*)\s*\n([\s\S]*?)```/g)) {
    const the = (m[1] || "").toLowerCase();
    const ma = m[2];
    if (the === "sql") ra.sql.push(ma);
    else if (the === "csharp" || the === "cs" || the === "c#") ra.cs.push(ma);
    else if (["javascript", "js", "jsx", "typescript", "ts", "tsx"].includes(the)) ra.js.push(ma);
    else if (/\bCREATE\s+TABLE\b/i.test(ma)) ra.sql.push(ma);
    else if (/\b(public|namespace|using System)\b/.test(ma)) ra.cs.push(ma);
    else if (/\b(require\(|import |export |const |function )\b/.test(ma)) ra.js.push(ma);
  }
  return ra;
};

// ─────────────────────────────────────────────────────────── BA BỘ KIỂM THẬT
const sh = (cmd, cwd, timeout = 240000) => {
  try { return { ok: true, out: execSync(cmd, { cwd, timeout, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }) }; }
  catch (e) { return { ok: false, out: `${e.stdout || ""}\n${e.stderr || ""}`.slice(-900) }; }
};

/**
 * SQL: PostgreSQL THẬT phân tích trong một giao dịch rồi ROLLBACK.
 * ⚠ Đơn hàng D1/D2 nói "SQL Server" nên phương ngữ có thể lệch — ca đó được ghi là `phuongNgu`
 *   chứ KHÔNG ghi là "sai", vì người đặt hàng đã nói rõ họ dùng SQL Server.
 */
/**
 * ★★★ G11 (2026-09-22) — CHAM BAI THEO DUNG PHUONG NGU DON HANG YEU CAU.
 * Ban dau moi khoi SQL deu bi PostgreSQL cham. D1/D2 yeu cau **SQL Server**, nen `IDENTITY(1,1)`
 * bi bao "syntax error" va suyt duoc ghi thanh loi cua model — trong khi bo phan tich T-SQL chinh
 * hang cua Microsoft (ScriptDom, chay offline) noi **OK**. Mot thuoc do sai phuong ngu khong do
 * duoc gi ngoai chinh no.
 */
const TSQL_DLL = `${ROOT}/scripts/ai-eval/codegen-chay-duoc/tsql-check/bin/Debug/net8.0/tsqlcheck.dll`;
const kiemTsql = (ma, dir) => {
  fs.mkdirSync(dir, { recursive: true });
  const f = `${dir}/s.sql`;
  fs.writeFileSync(f, ma);
  const r = sh(`dotnet "${TSQL_DLL}" "${f}"`, dir, 120000);
  return { ok: r.ok, loi: r.ok ? null : String(r.out).trim().slice(0, 300) };
};

const kiemSqlPg = async (ma) => {
  const { default: postgres } = await import("postgres");
  const sql = postgres(PG_CUC_BO, { ssl: false, max: 1, onnotice: () => {} }); // NOTICE "drop cascades" là tiếng ồn, không phải lỗi
  const luoc = `bench_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  try {
    await sql.unsafe(`CREATE SCHEMA "${luoc}"`);
    await sql.unsafe(`SET search_path TO "${luoc}"`);
    await sql.unsafe(ma);
    return { ok: true, loi: null };
  } catch (e) {
    return { ok: false, loi: String(e?.message ?? e).slice(0, 300) };
  } finally {
    try { await sql.unsafe(`DROP SCHEMA IF EXISTS "${luoc}" CASCADE`); } catch {}
    await sql.end();
  }
};

const kiemCs = (ma, dir) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(`${ROOT}/scripts/ai-eval/codegen-chay-duoc/cs-template/p.csproj`, `${dir}/p.csproj`);
  fs.writeFileSync(`${dir}/Sol.cs`, ma);
  // Đơn hàng không đòi Main; thêm một Main rỗng để `dotnet build` có điểm vào.
  fs.writeFileSync(`${dir}/Program.cs`, "public static class __T { public static int Main(){ return 0; } }");
  const r = sh("dotnet build p.csproj -v q --nologo", dir);
  return { ok: r.ok, loi: r.ok ? null : r.out.slice(-400) };
};

const kiemJs = (ma, dir, i) => {
  fs.mkdirSync(dir, { recursive: true });
  const laTsx = /<[A-Za-z][\s\S]*?>/.test(ma) || /:\s*(string|number|boolean|React\.)/.test(ma);
  const f = `${dir}/m${i}.${laTsx ? "tsx" : "mjs"}`;
  fs.writeFileSync(f, ma);
  const r = laTsx
    ? sh(`node --experimental-strip-types --input-type=module -e "0"`, dir) // node không parse JSX ⇒ xem dưới
    : sh(`node --check m${i}.mjs`, dir, 60000);
  if (!laTsx) return { ok: r.ok, loi: r.ok ? null : r.out.slice(-300) };
  // JSX: node KHÔNG parse được ⇒ dùng esbuild (đã có trong repo) làm bộ phân tích cú pháp.
  const e = sh(`npx esbuild "${f}" --outfile="${dir}/out${i}.js" --log-level=error`, ROOT, 120000);
  return { ok: e.ok, loi: e.ok ? null : e.out.slice(-300), quaEsbuild: true };
};

// ─────────────────────────────────────────────────────────── HỎI
/**
 * ★★★ CỔNG "KHÔNG ĐO ĐƯỢC" — đo được, và suýt thành bốn phát hiện giả.
 *
 * Chạy D2 bốn lượt liên tiếp: 715 · 208 · 175 · 144 ms, đáp **rỗng**, 0 khối mã. Nếu chấm thẳng
 * thì đó là "model trượt 4/4". Hỏi lại đúng câu ấy sau một nhịp: **5,8 s, sql 1/1, cs 1/1, đủ 5/5
 * thực thể**. Tức bốn lượt kia là một đợt BỊ BÓP TỐC ĐỘ, và con số duy nhất chúng đo được là tốc
 * độ gõ của tôi.
 *
 * ⇒ Một lượt vừa NHANH BẤT THƯỜNG vừa KHÔNG CÓ KHỐI MÃ thì không phải một kết cục — nó là một
 *   phép đo hỏng. Thử lại một lần; còn hỏng thì ghi `khongDoDuoc` và **không tính vào mẫu số**.
 *   Vứt một phép đo hỏng thì mất một điểm dữ liệu; giữ nó thì bịa ra một khuyết tật không có thật.
 */
const NGUONG_NHANH_BAT_THUONG_MS = 1500;
const doMotLuot = async (q) => {
  const g = await hoi(q);
  const soKhoi = [...String(g.text || "").matchAll(/```/g)].length;
  return { ...g, nghiBopTocDo: g.ms < NGUONG_NHANH_BAT_THUONG_MS && soKhoi === 0 };
};

const hoi = async (q) => {
  const t0 = Date.now();
  const res = await fetch("http://127.0.0.1:3000/api/ai/local-kb/stream", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: CK },
    body: JSON.stringify({ question: q, topK: 5, history: [], userRole: "admin",
      context: { route: "/ai-coding-workspace", uiLanguage: "vi", codingMode: true, projectId: "repo" } }),
  });
  if (!res.ok) return { ms: Date.now() - t0, text: "", err: `HTTP ${res.status}` };
  let text = "", buf = ""; const dec = new TextDecoder(); const evs = [];
  for await (const c of res.body) {
    buf += dec.decode(c, { stream: true });
    let i; while ((i = buf.indexOf("\n\n")) >= 0) {
      const blk = buf.slice(0, i); buf = buf.slice(i + 2);
      const m = blk.match(/^data:\s*([\s\S]*)$/m); if (!m) continue;
      let o; try { o = JSON.parse(m[1]); } catch { continue; }
      if (o.type === "token") text += o.token ?? "";
      // R2 phần B — soi GƯƠNG client (useKbChatStream): `done.answerRevised` ⇒ văn bản đã sửa tất định sau stream
      // (bổ sung `using` C#) THAY văn bản tích luỹ. Thiết bị đo phải thấy đúng thứ người dùng thấy.
      else if (o.type === "done" && o.answerRevised === true && typeof o.answer === "string") { text = o.answer; evs.push("done:revised"); }
      else evs.push(o.type + (o.toolName ? ":" + o.toolName : ""));
    }
  }
  return { ms: Date.now() - t0, text, evs };
};

// ─────────────────────────────────────────────────────────── VÒNG
const rows = [];
for (const d of DU_AN) {
  process.stderr.write(`▶ ${d.id} ${d.ten} … `);
  let g = await doMotLuot(d.q);
  if (g.nghiBopTocDo) {
    process.stderr.write(`(${g.ms}ms rỗng — nghi bị bóp tốc độ, hỏi lại) `);
    await new Promise((r) => setTimeout(r, 20000));
    g = await doMotLuot(d.q);
  }
  const k = khoiTheoNgonNgu(g.text || "");
  const dir = `${WORK}/${d.id}`;

  const kq = { sql: [], cs: [], js: [] };
  for (const [i, ma] of k.sql.entries())
    kq.sql.push(d.phuongNgu === "tsql" ? kiemTsql(ma, `${dir}/sql${i}`) : await kiemSqlPg(ma));
  for (const [i, ma] of k.cs.entries()) kq.cs.push(kiemCs(ma, `${dir}/cs${i}`));
  for (const [i, ma] of k.js.entries()) kq.js.push(kiemJs(ma, `${dir}/js`, i));

  const t = (g.text || "").toLowerCase();
  const bangThieu = d.bangCan.filter((b) => !new RegExp(b, "i").test(g.text || ""));
  const cotThieu = (d.cotCan || []).filter((c) => !new RegExp(c, "i").test(t));

  const tongKhoi = k.sql.length + k.cs.length + k.js.length;
  const dat = (arr) => arr.filter((x) => x.ok).length;
  const row = {
    id: d.id, ten: d.ten, ms: g.ms, chars: (g.text || "").length, khongDoDuoc: g.nghiBopTocDo,
    soKhoi: { sql: k.sql.length, cs: k.cs.length, js: k.js.length },
    kiem: { sql: `${dat(kq.sql)}/${kq.sql.length}`, cs: `${dat(kq.cs)}/${kq.cs.length}`, js: `${dat(kq.js)}/${kq.js.length}` },
    bangThieu, cotThieu,
    loi: [...kq.sql, ...kq.cs, ...kq.js].filter((x) => !x.ok).map((x) => x.loi).slice(0, 3),
    vanBan: (g.text || "").slice(0, 30000),
  };
  rows.push(row);
  process.stderr.write(
    `${tongKhoi} khối (sql ${row.kiem.sql} · cs ${row.kiem.cs} · js ${row.kiem.js}) · thiếu bảng ${bangThieu.length}/${d.bangCan.length} · ${g.ms}ms\n`,
  );
}

fs.mkdirSync(`${ROOT}/scripts/ai-eval/codegen-chay-duoc/reports`, { recursive: true });
fs.writeFileSync(`${ROOT}/scripts/ai-eval/codegen-chay-duoc/reports/${LABEL}.json`, JSON.stringify(rows, null, 1));
console.log(`\n══ ${LABEL} ══`);
for (const r of rows) {
  console.log(` ${r.id} ${r.ten}${r.khongDoDuoc ? '  ⚠ KHÔNG ĐO ĐƯỢC (bị bóp tốc độ) — KHÔNG tính' : ''}`);
  console.log(`    khối: sql ${r.soKhoi.sql} · cs ${r.soKhoi.cs} · js ${r.soKhoi.js}`);
  console.log(`    KIỂM: sql ${r.kiem.sql} · cs ${r.kiem.cs} · js ${r.kiem.js}`);
  console.log(`    thực thể thiếu: ${r.bangThieu.length ? r.bangThieu.join(", ") : "—"}`);
  if (r.cotThieu.length) console.log(`    ràng buộc thiếu: ${r.cotThieu.join(", ")}`);
  if (r.loi.length) console.log(`    lỗi đầu: ${String(r.loi[0]).slice(0, 160)}`);
}
