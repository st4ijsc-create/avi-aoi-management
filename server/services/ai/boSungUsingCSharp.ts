/**
 * R2 phần B (kế hoạch AI Local 2026-09-22 §4; chủ dự án chọn "sau sinh, tất định" 2026-09-23) — BỔ SUNG
 * `using` còn thiếu vào khối C# model vừa sinh, theo chỉ mục tham chiếu API chính thức.
 *
 * VÌ SAO (đo): lỗi C# lặp lại của các đơn hàng C# + SQL Server là THIẾU `using System.Data;` — model dùng
 * đúng API mà quên không gian tên: `reader.GetInt32("Ten")` ⇒ CS1503 (phương thức MỞ RỘNG
 * `DataReaderExtensions`), `SqlDbType` ⇒ CS0103 (`duanMoe-C`, `duan-r2b-truoc-3`). Truy hồi theo câu hỏi
 * KHÔNG chạm được thông tin này (đo: 0/12 đoạn System.Data cho đơn D1) vì nó chỉ lộ ra trong MÃ.
 *
 * CƠ CHẾ — không gọi model, không đoán:
 *   • chỉ mục `knowledge/api-ref/dotnet-using.json` do `scripts/ai-kb/tao-tham-chieu-api-dotnet.mjs`
 *     sinh từ tệp XML doc chính thức (kiểu → không gian tên; phương thức mở rộng → không gian tên +
 *     kiểu tham số thứ hai);
 *   • bỏ chú thích + chuỗi trước khi quét (tên trong chuỗi SQL không phải lượt dùng kiểu);
 *   • một KIỂU được tính là "dùng" khi đứng độc lập (không sau dấu `.` — `cmd.CommandType` là thuộc
 *     tính, `CommandType.Text` là kiểu) và mã không tự khai kiểu cùng tên;
 *   • phương thức mở rộng chỉ được tính khi dạng gọi KHÁC overload gốc: `.GetInt32("…")` (đối số
 *     đầu là CHUỖI — overload gốc nhận số) hay `.Field<T>(` (DataRow không có Field gốc);
 *   • đã có `using <ns>;` (hoặc `global using`) ⇒ không đụng; các kiểu SqlClient coi `System.Data.SqlClient`
 *     là tương đương `Microsoft.Data.SqlClient` (mã cũ dùng gói cũ vẫn hợp lệ — khuôn cs-template có cả hai).
 * Chèn ngay sau dòng `using` cuối ở đầu khối (hoặc đầu khối nếu chưa có). KHÔNG sửa gì khác.
 */

export interface ChiMucUsing {
  kieu: Record<string, string[]>;
  moRong: Record<string, { ns: string; doiTuong: string[]; thamSo2: string[] }>;
}

export interface UsingThem {
  ns: string;
  /** Các định danh khiến `using` này cần — để câu thông báo nói ĐÚNG lý do. */
  vi: string[];
}

const TUONG_DUONG: Record<string, string[]> = {
  "Microsoft.Data.SqlClient": ["System.Data.SqlClient"],
};

/** Bỏ chú thích `//` `/* *\/` và chuỗi (thường, verbatim `@"…"`, nội suy `$"…"`, ký tự `'x'`) — giữ độ dài
 * không quan trọng, chỉ cần không còn định danh giả. Chuỗi thay bằng `""` để dạng `.GetInt32("…")` còn
 * nhận ra được. */
export function boChuThichVaChuoi(ma: string): string {
  return ma.replace(
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|\$?@"(?:[^"]|"")*"|@?\$?"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])'/g,
    (m) => (m.startsWith("/") ? " " : m.startsWith("'") ? "' '" : '""'),
  );
}

function daImport(ma: string, ns: string): boolean {
  const ds = [ns, ...(TUONG_DUONG[ns] ?? [])];
  return ds.some((n) => new RegExp(`^\\s*(?:global\\s+)?using\\s+${n.replace(/\./g, "\\.")}\\s*;`, "m").test(ma));
}

/**
 * `ten` ở vị trí `i` có phải một lượt dùng KIỂU: `new T(`, `T.ThanhVien` (enum/tĩnh), `T x =/;/,/)/(`
 * (khai biến · tham số · kiểu trả về), `<T>` / `<T,` (đối số generic), `(T)` (ép kiểu), `typeof(T)`.
 */
function laViTriKieu(ma: string, i: number, ten: string): boolean {
  const truoc = ma.slice(Math.max(0, i - 12), i);
  const sau = ma.slice(i + ten.length, i + ten.length + 80);
  if (/\bnew\s+$/.test(truoc)) return true;
  if (/^\s*\.\s*[A-Z]\w*/.test(sau)) return true;
  if (/^(?:\s*<[^<>;]*>)?(?:\s*\[\s*\])?\??\s+@?[A-Za-z_]\w*\s*(?:=|;|,|\)|\(|\bin\b)/.test(sau)) return true;
  if (/[<,]\s*$/.test(truoc) && /^\s*[>,]/.test(sau)) return true;
  if (/\(\s*$/.test(truoc) && /^\s*\)\s*[\w(@]/.test(sau)) return true;
  if (/typeof\s*\(\s*$/.test(truoc)) return true;
  return false;
}

export function phanTichThieuUsing(ma: string, chiMuc: ChiMucUsing): UsingThem[] {
  const sach = boChuThichVaChuoi(ma);
  const khaiRieng = new Set([...sach.matchAll(/\b(?:class|struct|enum|interface|record)\s+([A-Za-z_]\w*)/g)].map((m) => m[1]));
  const can = new Map<string, Set<string>>();
  const ghi = (ns: string, ten: string) => {
    if (!can.has(ns)) can.set(ns, new Set());
    can.get(ns)!.add(ten);
  };
  for (const m of sach.matchAll(/(?<![.\w])([A-Z][A-Za-z0-9_]*)\b/g)) {
    const ten = m[1];
    const dsNs = chiMuc.kieu[ten];
    if (!dsNs || khaiRieng.has(ten)) continue;
    // Một tên thuộc NHIỀU không gian tên ⇒ đoán sẽ sai một nửa ⇒ không đụng.
    if (dsNs.length !== 1) continue;
    // Chỉ tính khi đứng ở VỊ TRÍ KIỂU — chỉ mục có những tên chung chung (`Rule`, `Constraint`,
    // `SortOrder`): `public string Rule { get; set; }` là TÊN THUỘC TÍNH, không phải lượt dùng kiểu.
    if (!laViTriKieu(sach, m.index!, ten)) continue;
    ghi(dsNs[0], ten);
  }
  for (const [ten, mr] of Object.entries(chiMuc.moRong)) {
    const goiChuoi = mr.thamSo2.includes("String") && new RegExp(`\\.${ten}\\s*\\(\\s*""`).test(sach);
    const goiGeneric = new RegExp(`\\.${ten}\\s*<`).test(sach) && /DataRow/.test(mr.doiTuong.join(","));
    if (goiChuoi || goiGeneric) ghi(mr.ns, `${ten}(${goiChuoi ? '"…"' : "<T>"})`);
  }
  const ra: UsingThem[] = [];
  for (const [ns, vi] of can) if (!daImport(ma, ns)) ra.push({ ns, vi: [...vi].sort() });
  return ra.sort((a, b) => a.ns.localeCompare(b.ns));
}

/** Chèn `using` sau dòng `using` cuối của phần đầu tệp (trước `namespace`/khai báo đầu tiên). */
export function chenUsing(ma: string, dsNs: readonly string[]): string {
  if (dsNs.length === 0) return ma;
  const eol = ma.includes("\r\n") ? "\r\n" : "\n";
  const dong = ma.split(/\r?\n/);
  let cuoi = -1;
  for (let i = 0; i < dong.length; i++) {
    const d = dong[i].trim();
    if (/^(?:global\s+)?using\s+[\w.]+\s*;/.test(d)) cuoi = i;
    else if (d === "" || d.startsWith("//") || d.startsWith("#")) continue;
    else break;
  }
  const them = dsNs.map((n) => `using ${n};`);
  dong.splice(cuoi + 1, 0, ...them);
  return dong.join(eol);
}

export interface KetQuaBoSung {
  text: string;
  them: UsingThem[];
}

/** Xử lý mọi khối ```csharp / ```cs / ```c# trong một câu trả lời; khối khác giữ nguyên từng byte. */
export function boSungUsingTrongVanBan(vanBan: string, chiMuc: ChiMucUsing): KetQuaBoSung {
  const them: UsingThem[] = [];
  const text = vanBan.replace(/```(csharp|cs|c#)([ \t]*\r?\n)([\s\S]*?)```/gi, (toan, the: string, xuong: string, ma: string) => {
    const thieu = phanTichThieuUsing(ma, chiMuc);
    if (thieu.length === 0) return toan;
    them.push(...thieu);
    return "```" + the + xuong + chenUsing(ma, thieu.map((t) => t.ns)) + "```";
  });
  return { text, them };
}

type NgonNgu = "vi" | "en" | "zh";
/** Câu NÓI RÕ đã sửa gì (chủ dự án: "thêm và nói rõ"). */
export function thongBaoBoSung(them: readonly UsingThem[], lang: NgonNgu): string {
  if (them.length === 0) return "";
  const ds = them.map((t) => `\`using ${t.ns};\` (${t.vi.map((v) => `\`${v}\``).join(", ")})`).join("; ");
  if (lang === "en") return `\n\n> ⚙ Added missing ${ds} to the C# code above, per the official API reference (namespace index built from the library's XML docs).`;
  if (lang === "zh") return `\n\n> ⚙ 已按官方 API 参考（由库的 XML 文档生成的命名空间索引）为上面的 C# 代码补上缺失的 ${ds}。`;
  return `\n\n> ⚙ Đã bổ sung ${ds} còn thiếu vào mã C# ở trên, theo tham chiếu API chính thức (chỉ mục không gian tên dựng từ tài liệu XML của thư viện).`;
}
