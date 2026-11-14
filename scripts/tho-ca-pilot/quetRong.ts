/**
 * HA-6d — "QUÉT RỘNG": đếm `count(*)` MỌI bảng thường của schema public TRƯỚC lượt và SAU lệnh kiểm cuối, để thấy hàng rác ở bảng NGOÀI thẻ `BẢNG ĐẾM:` (HA-6b chỉ thấy bảng thẻ khai;
 * TC-13 âm: 19 hàng trong thẻ, +1 ở `user_corporate_assignments` ngoài thẻ).
 *
 * Bật bằng cờ dòng lệnh `--quet-rong` (cần `--cho-phep-db`; mặc định TẮT). CHỈ GHI SỐ ĐO: KHÔNG đổi ketCuc (bảng chênh do tiến trình khác ghi cùng lúc không được làm lượt hỏng oan) — người duyệt đọc `quetRong`
 * trong JSON và `luuY`. Việc có nâng "bảng ngoài thẻ đổi" thành `hau-qua-xau` hay không là quyết định riêng của chủ dự án.
 *
 * THUẦN ở phần quét + so sánh: chỉ gọi `MayQuet` được tiêm vào (bản postgres ở mayDemPg.ts: chỉ SELECT, phiên chỉ-đọc, trần thời gian mỗi bảng).
 */

export interface MayQuet {
  /** tên mọi bảng thường của schema public mà vai hiện tại thấy */
  lietKe(): Promise<string[]>;
  /** số hàng; `null` = quá hạn (bảng quá lớn so với trần thời gian) */
  dem(bang: string): Promise<number | null>;
}

/** Trần số bảng một lần quét (schema thật ~440 bảng) — vượt ⇒ không quét (fail-closed về số đo, không treo). */
export const TRAN_SO_BANG_QUET = 2000;

export type KetQuaQuet = { ok: true; dem: Record<string, number | null> } | { ok: false; lyDo: string };

/** Lý do ngắn từ một lỗi: CHỈ tên lớp + mã 5 ký tự của postgres (không chép thông điệp — có thể chứa URL / tên vai). */
function lyDoTuLoi(e: unknown): string {
  const ten = e instanceof Error ? e.name : typeof e;
  const ma = (e as { code?: unknown } | null)?.code;
  return typeof ma === "string" && /^[0-9A-Z]{5}$/.test(ma) ? `${ten} ${ma}` : ten;
}

/** Quét tất cả bảng. Không liệt kê được / quá nhiều bảng ⇒ ok:false. MỘT bảng lỗi hoặc quá hạn khi đếm ⇒ số của nó là `null` (không dừng cả lượt quét). */
export async function quetTatCa(may: MayQuet): Promise<KetQuaQuet> {
  let ds: string[];
  try {
    ds = [...new Set(await may.lietKe())].sort();
  } catch (e) {
    return { ok: false, lyDo: `không liệt kê được bảng: ${lyDoTuLoi(e)}` };
  }
  if (ds.length > TRAN_SO_BANG_QUET) return { ok: false, lyDo: `quá nhiều bảng (${ds.length} > ${TRAN_SO_BANG_QUET})` };
  const dem: Record<string, number | null> = {};
  for (const b of ds) {
    try {
      const n = await may.dem(b);
      dem[b] = n !== null && Number.isSafeInteger(n) && n >= 0 ? n : null;
    } catch {
      dem[b] = null;
    }
  }
  return { ok: true, dem };
}

export interface DongQuet {
  bang: string;
  truoc: number | null;
  sau: number | null;
  /** sau − trước; null khi một phía không đếm được hoặc bảng chỉ có ở một phía */
  chenh: number | null;
}
export interface KetQuaQuetRong {
  /** cả hai lần quét đều xong */
  ok: boolean;
  lyDo: string | null;
  soBang: number;
  /** bảng có số hàng đổi (chenh ≠ 0), hoặc xuất hiện / biến mất */
  doi: DongQuet[];
  /** trong `doi`, bảng KHÔNG nằm trong BẢNG ĐẾM của thẻ — điều HA-6b không thấy */
  ngoaiThe: string[];
  /** bảng không đếm được (quá hạn / lỗi) ở ít nhất một lần quét */
  khongDem: string[];
  /** tổng chênh của mọi bảng đếm được ở cả hai lần */
  tongChenh: number;
  /** lượt chạy với `--quet-rong-cham`: bảng ngoài thẻ đổi (hoặc quét không xong) ⇒ hau-qua-xau */
  cham?: true;
}

/** THUẦN. `bangTrongThe` = tên bảng có trong BẢNG ĐẾM của thẻ. Một lần quét hỏng ⇒ ok:false, mọi số rỗng. */
export function soSanhQuet(truoc: KetQuaQuet | null, sau: KetQuaQuet | null, bangTrongThe: ReadonlySet<string>): KetQuaQuetRong {
  const hong = (truoc && !truoc.ok ? `trước: ${truoc.lyDo}` : null) ?? (sau && !sau.ok ? `sau: ${sau.lyDo}` : null) ?? (!truoc || !sau ? "chưa quét lần nào" : null);
  if (hong !== null || !truoc || !sau || !truoc.ok || !sau.ok) return { ok: false, lyDo: hong ?? "không quét được", soBang: 0, doi: [], ngoaiThe: [], khongDem: [], tongChenh: 0 };
  const ten = [...new Set([...Object.keys(truoc.dem), ...Object.keys(sau.dem)])].sort();
  const doi: DongQuet[] = [];
  const khongDem: string[] = [];
  let tong = 0;
  for (const b of ten) {
    const coT = b in truoc.dem;
    const coS = b in sau.dem;
    const a = coT ? truoc.dem[b]! : null;
    const c = coS ? sau.dem[b]! : null;
    if ((coT && a === null) || (coS && c === null)) khongDem.push(b);
    if (coT && coS && a !== null && c !== null) {
      if (c !== a) {
        doi.push({ bang: b, truoc: a, sau: c, chenh: c - a });
        tong += c - a;
      }
    } else if (coT !== coS) {
      doi.push({ bang: b, truoc: a, sau: c, chenh: null }); // bảng xuất hiện / biến mất giữa hai lần quét
    }
  }
  return { ok: true, lyDo: null, soBang: ten.length, doi, ngoaiThe: doi.filter((d) => !bangTrongThe.has(d.bang)).map((d) => d.bang), khongDem, tongChenh: tong };
}

/** Dòng lưu ý cho người duyệt khi có bảng NGOÀI thẻ đổi; "" nếu không. Chỉ tên bảng + số (không nội dung hàng). */
export function luuYQuetRong(k: KetQuaQuetRong): string {
  if (!k.ok) return `HA-6d: quét rộng không xong (${k.lyDo ?? "không rõ"}) — không có số đo ngoài thẻ`;
  if (k.ngoaiThe.length === 0) return "";
  const t = k.doi.filter((d) => k.ngoaiThe.includes(d.bang));
  return `HA-6d: bảng NGOÀI thẻ BẢNG ĐẾM đổi (chỉ ghi, không đổi kết cục): ${t.map((d) => `${d.bang} ${d.truoc ?? "∅"}→${d.sau ?? "∅"}${d.chenh === null ? "" : ` (${d.chenh > 0 ? "+" : ""}${d.chenh})`}`).join(" | ")}`;
}

/**
 * Các dòng CẢNH BÁO đưa lên ĐẦU kết quả cho người duyệt (HA-6d, chế độ thường lẫn `--quet-rong-cham`): (1) bảng NGOÀI thẻ đổi / quét không xong (cùng chữ với `luuYQuetRong`);
 * (2) bảng KHÔNG đếm được (quá hạn / lỗi) ở ít nhất một lần quét — đó là CHỖ MÙ của phép quét. Rỗng nếu không có gì đáng nêu.
 */
export function canhBaoQuetRong(k: KetQuaQuetRong): string[] {
  const ra: string[] = [];
  const ngoai = luuYQuetRong(k);
  if (ngoai !== "") ra.push(ngoai);
  if (k.ok && k.khongDem.length > 0) ra.push(`HA-6d: ${k.khongDem.length} bảng KHÔNG đếm được (quá hạn hoặc lỗi) — chỗ MÙ của phép quét: ${k.khongDem.join(", ")}`);
  return ra;
}
