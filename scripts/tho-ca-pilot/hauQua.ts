/**
 * HA-6b (phần 1) — "KIỂM HẬU QUẢ" bằng ĐẾM HÀNG CSDL: lượt xanh mà để lại/xoá hàng ngoài ý muốn ⇒ KHÔNG ĐẠT (`hau-qua-xau`).
 *
 * Khoá thẻ host-only `BẢNG ĐẾM:` — người viết thẻ khai, mỗi dòng MỘT mục ở DẠNG ĐÓNG (không SQL tự do):
 *     [GHI: ]<bảng>[ WHERE <cột> (LIKE|=) '<giá trị>']
 *   · <bảng>, <cột>: ^[a-z_][a-z0-9_]{0,62}$ (bộ đếm còn kiểm chúng CÓ trong information_schema, schema public, và trích dẫn bằng sql(…));
 *   · <giá trị>: tham số BIND (không nội suy), chỉ gồm [A-Za-z0-9_%.:-␠], không `--`;
 *   · `GHI:` = chỉ đếm và ghi vào JSON, KHÔNG chấm (bảng đi hai chiều do chính hệ thống dọn).
 * Mục có `;`, `--`, `/*`, OR / AND, hai điều kiện, subquery, hoặc sai dạng ⇒ THẺ LỖI.
 *
 * Đếm count(*) CHÍNH XÁC trước lượt và sau lệnh kiểm cuối; chênh ≠ 0 ở mục chấm ⇒ hậu quả. Chỉ khi có `--cho-phep-db` (+ khe `_test` độc quyền do dieu-phoi cấp);
 * không có cờ DB ⇒ `khong-do-db` (không chấm). Có cờ DB mà không đếm được (kết nối / quyền / định danh lạ) ⇒ `hau-qua-xau` lý do `khong-dem-duoc` (FAIL-CLOSED).
 * THUẦN ở phần phân tích + phán quyết; `demTatCa` chỉ gọi `MayDem` được tiêm vào (xem mayDemPg.ts cho bản postgres).
 */

export interface MucDem {
  bang: string;
  cot?: string;
  toanTu?: "LIKE" | "=";
  giaTri?: string;
  /** `GHI:` — chỉ ghi, không chấm */
  ghi: boolean;
}

const RE_DINH_DANH = "[a-z_][a-z0-9_]{0,62}";
const RE_MUC = new RegExp(`^(GHI:\\s*)?(${RE_DINH_DANH})(?:\\s+WHERE\\s+(${RE_DINH_DANH})\\s+(LIKE|=)\\s+'([A-Za-z0-9_%.: -]{1,100})')?$`, "i");
export const RE_DINH_DANH_HOP_LE = new RegExp(`^${RE_DINH_DANH}$`);
export const TRAN_SO_MUC_DEM = 16;

/** Nhãn ổn định của một mục (khoá trong kết quả đếm và JSON). */
export function nhanMuc(m: MucDem): string {
  return m.cot ? `${m.bang} WHERE ${m.cot} ${m.toanTu} '${m.giaTri}'` : m.bang;
}

/** Phân tích khoá `BẢNG ĐẾM:` (nhiều dòng). Rỗng ⇒ không bật (ok, []). */
export function docBangDem(tho: string | undefined): { ok: true; muc: MucDem[] } | { ok: false; loi: string } {
  const dong = (tho ?? "").split(/\r?\n/).map((x) => x.trim()).filter((x) => x !== "");
  if (dong.length > TRAN_SO_MUC_DEM) return { ok: false, loi: `BẢNG ĐẾM: tối đa ${TRAN_SO_MUC_DEM} mục (nhận ${dong.length})` };
  const muc: MucDem[] = [];
  const thay = new Set<string>();
  for (const d of dong) {
    const cat = d.slice(0, 60);
    if (/[;]|--|\/\*|\*\//.test(d)) return { ok: false, loi: `BẢNG ĐẾM: mục có ký tự không cho phép (; -- /*): "${cat}"` };
    const m = RE_MUC.exec(d);
    if (!m) return { ok: false, loi: `BẢNG ĐẾM: sai dạng (chỉ nhận \`[GHI: ]bảng [WHERE cột LIKE|= 'giá trị']\`): "${cat}"` };
    const mm: MucDem = { bang: m[2]!.toLowerCase(), ghi: m[1] !== undefined };
    if (m[3]) {
      mm.cot = m[3].toLowerCase();
      mm.toanTu = m[4]!.toUpperCase() as "LIKE" | "=";
      mm.giaTri = m[5]!;
    }
    const nhan = nhanMuc(mm);
    if (thay.has(nhan)) return { ok: false, loi: `BẢNG ĐẾM: mục trùng: "${cat}"` };
    thay.add(nhan);
    muc.push(mm);
  }
  return { ok: true, muc };
}

// ── đếm (qua bộ đếm tiêm vào) ─────────────────────────────────────────────────────────────────────

export interface MayDem {
  /** null = hợp lệ; còn lại = lý do ngắn (định danh không có trong information_schema…) */
  kiemDinhDanh(m: MucDem): Promise<string | null>;
  dem(m: MucDem): Promise<number>;
}
export type KetQuaDem = { ok: true; dem: Record<string, number> } | { ok: false; lyDo: string };

/** Lý do ngắn từ một lỗi: CHỈ tên lớp + mã 5 ký tự của postgres (không chép thông điệp — có thể chứa URL / tên vai). */
function lyDoTuLoi(e: unknown): string {
  const ten = e instanceof Error ? e.name : typeof e;
  const ma = (e as { code?: unknown } | null)?.code;
  return typeof ma === "string" && /^[0-9A-Z]{5}$/.test(ma) ? `${ten} ${ma}` : ten;
}

/** Đếm TẤT CẢ mục; bất kỳ lỗi nào ⇒ ok:false (fail-closed, không đếm dở). */
export async function demTatCa(may: MayDem, muc: readonly MucDem[]): Promise<KetQuaDem> {
  const dem: Record<string, number> = {};
  for (const m of muc) {
    try {
      const bad = await may.kiemDinhDanh(m);
      if (bad !== null) return { ok: false, lyDo: `${nhanMuc(m)}: ${bad}` };
      const n = await may.dem(m);
      if (!Number.isSafeInteger(n) || n < 0) return { ok: false, lyDo: `${nhanMuc(m)}: bộ đếm trả giá trị không hợp lệ` };
      dem[nhanMuc(m)] = n;
    } catch (e) {
      return { ok: false, lyDo: `${nhanMuc(m)}: lỗi ${lyDoTuLoi(e)}` };
    }
  }
  return { ok: true, dem };
}

// ── phán quyết ────────────────────────────────────────────────────────────────────────────────────

export interface DongHauQua {
  muc: string;
  ghi: boolean;
  truoc: number | null;
  sau: number | null;
  chenh: number | null;
}
export interface KetQuaHauQua {
  ketCuc: "ok" | "hau-qua-xau";
  db: "co" | "khong-do-db" | "khong-dem-duoc";
  lyDo: string | null;
  bang: DongHauQua[];
}
export interface DauVaoHauQua {
  muc: readonly MucDem[];
  /** lượt có `--cho-phep-db` */
  coDb: boolean;
  truoc: KetQuaDem | null;
  sau: KetQuaDem | null;
}

/** THUẦN. Không có mục ⇒ ok (không bật). */
export function tinhHauQua(v: DauVaoHauQua): KetQuaHauQua {
  if (v.muc.length === 0) return { ketCuc: "ok", db: "khong-do-db", lyDo: null, bang: [] };
  if (!v.coDb) return { ketCuc: "ok", db: "khong-do-db", lyDo: null, bang: [] };
  const hong = (v.truoc && !v.truoc.ok ? `trước: ${v.truoc.lyDo}` : null) ?? (v.sau && !v.sau.ok ? `sau: ${v.sau.lyDo}` : null) ?? (!v.truoc || !v.sau ? "chưa đếm lần nào (không có bộ đếm)" : null);
  if (hong !== null) return { ketCuc: "hau-qua-xau", db: "khong-dem-duoc", lyDo: `khong-dem-duoc — ${hong}`, bang: [] };
  const t = (v.truoc as { ok: true; dem: Record<string, number> }).dem;
  const s = (v.sau as { ok: true; dem: Record<string, number> }).dem;
  const bang: DongHauQua[] = v.muc.map((m) => {
    const k = nhanMuc(m);
    const a = t[k] ?? null;
    const b = s[k] ?? null;
    return { muc: k, ghi: m.ghi, truoc: a, sau: b, chenh: a === null || b === null ? null : b - a };
  });
  const thieu = bang.filter((d) => d.chenh === null && !d.ghi);
  if (thieu.length > 0) return { ketCuc: "hau-qua-xau", db: "khong-dem-duoc", lyDo: `khong-dem-duoc — thiếu số đếm: ${thieu.map((d) => d.muc).join(" | ")}`, bang };
  const xau = bang.filter((d) => !d.ghi && d.chenh !== 0);
  if (xau.length > 0) {
    return { ketCuc: "hau-qua-xau", db: "co", lyDo: `HA-6b: hàng CSDL đổi sau lượt (chấm): ${xau.map((d) => `${d.muc} ${d.truoc}→${d.sau} (${(d.chenh as number) > 0 ? "+" : ""}${d.chenh})`).join(" | ")}`, bang };
  }
  return { ketCuc: "ok", db: "co", lyDo: null, bang };
}
