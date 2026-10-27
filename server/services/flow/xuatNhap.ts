/**
 * ★★★ Luồng AI — XUẤT / NHẬP luồng giữa các nhà máy (lô nhập/xuất, 2026-10-25; dieu-phoi duyệt). THUẦN (không DB) trừ `dauVetNhaMay`.
 *
 * Nguyên tắc: gói xuất KHÔNG BAO GIỜ mang theo thứ thuộc nhà máy gốc, và NHẬP không tin gói (làm sạch lại y như xuất).
 *   • cấp node: `credentialRef` luôn bị xoá; tham số khai ở `THAM_SO_THEO_NHA_MAY` (phamViNut.ts) bị đưa về chỗ trống (biểu thức `{{ … }}` giữ nguyên);
 *   • cấp luồng: id · tên nhà máy · chủ · `settings.errorFlowId` · `pinData` (dữ liệu ghim thật) bị bỏ; id luồng đặt lại lúc nhập;
 *   • văn bản tự do (prompt, nội dung, tiêu đề, tên node…) có thể chứa mã máy / tên nhà máy / tên người của nhà máy gốc viết tay ⇒ `quetVanBan` chỉ CẢNH BÁO
 *     (vị trí node + trường), KHÔNG tự xoá (tránh làm hỏng prompt); cảnh báo trả cho người xuất xem TRƯỚC khi tải và KHÔNG nằm trong tệp gói;
 *   • gói: { dinhDang: "luong-ai/1", luong, viecPhaiDien, bam } — `bam` = sha256 nội dung `luong` (phát hiện sửa tay; thiếu/lệch ⇒ chỉ cảnh báo ở bước xem trước, không phải chữ ký).
 * Nhập đi qua ĐÚNG đường `flow.luu` (kiểm luồng, kiểm tham số, gán nhà máy, hạng tính lại ở máy chủ).
 */
import { createHash } from "node:crypto";
import { FlowDefinitionSchema, type FlowDefinition, type NodeInstance } from "../../../shared/flow/model";
import { THAM_SO_THEO_NHA_MAY, type ThamSoNhaMay } from "./phamViNut";

export const DINH_DANG_GOI = "luong-ai/1";
export const TRAN_BYTE_GOI = 256 * 1024;
export const TRAN_NODE_GOI = 100;

export type LoaiViec = ThamSoNhaMay["viec"] | "bi-mat" | "luong-loi" | "http-bi-mat" | "affinity" | "chon-model";
export interface ViecPhaiDien {
  nodeId: string;
  truong: string;
  viec: LoaiViec;
}

const laBieuThuc = (v: unknown): boolean => typeof v === "string" && v.includes("{{");
const trong = (v: unknown): boolean => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** JSON ổn định (khoá sắp xếp) để băm. */
export function jsonOnDinh(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(jsonOnDinh).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${jsonOnDinh(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}
export const bamLuong = (luong: unknown): string => createHash("sha256").update(jsonOnDinh(luong), "utf8").digest("hex");

// ── bí mật GÕ TAY trong tham số HTTP (kiem-dinh F1 + 17 biến thể + XML/full-width) ──────────────────
//
// GIỚI HẠN ĐÃ BIẾT (khai thẳng — đây là bộ lọc theo MẪU, không phải bằng chứng "sạch"):
//   • "Basic <base64>" hoặc token nằm trong trường KHÔNG có tên khoá và không giống token độc lập (ngắn / tuỳ ý) KHÔNG bị phát hiện;
//   • đoạn đường dẫn url chứa bí mật NGẮN hoặc dạng tuỳ ý (không phải bot<id>:<token>, không ≥ 24 ký tự chữ+số liền, không hex ≥ 32) KHÔNG bị phát hiện;
//   • UUID trong đường dẫn url (≥ 24 ký tự chữ+số liền) bị thay bằng chỗ giữ — quá tay có chủ ý (UUID thường là id tài nguyên của nhà máy nguồn);
//   • khoá VÔ HẠI mà tên chứa key / auth / cred / session / pass… (keyboard, authorName, credits…) bị xoá GIÁ TRỊ trong thân/tiêu đề HTTP — quá tay có chủ ý
//     (xoá nhầm chỉ tốn một lần điền lại; sót bí mật thì lộ);
//   • bí mật trong node KHÔNG phải HTTP chỉ được CẢNH BÁO (quetBiMat), không tự xoá.

/** Chuẩn hoá tên khoá để so: NFKD (gập full-width ｐａｓｓｗｏｒｄ → password) bỏ dấu (mật_khẩu → mat_khau), đ→d, chữ thường. */
export const chuanTenKhoa = (k: string): string => k.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[\u0111\u0110]/g, "d").toLowerCase();

/**
 * Tên khoá / tiêu đề trông như bí mật (đã chuẩn hoá bỏ dấu): từ khoá dài khớp ở bất cứ đâu; từ khoá NGẮN (pwd, pass, otp, sid) chỉ khớp khi đứng riêng
 * (không phải trong "bypass", "inside", "passenger"…). Tiếng Việt không dấu: mat_khau, bi_mat, khoa_api, xac_thuc.
 */
const NGUON_KHOA_DAI = "key|token|secret|passw|cred|signature|session|private|auth|bearer|cookie|mat[_ -]?khau|bi[_ -]?mat|khoa[_ -]?(?:bi|api)|xac[_ -]?thuc";
const RE_KHOA_NGAN = /(?:^|[^a-z])(?:pwd|pass|otp|sid)(?:[^a-z]|$)/;
const RE_KHOA_DAI = new RegExp(NGUON_KHOA_DAI);
export const laTenBiMat = (k: string): boolean => {
  const c = chuanTenKhoa(k);
  return RE_KHOA_DAI.test(c) || RE_KHOA_NGAN.test(c);
};
/** Giữ tương thích: kiểm lúc LƯU và quét dùng cùng bộ luật. */
export const RE_TEN_BI_MAT = { test: laTenBiMat };
/** Tiêu đề HTTP vô hại được giữ lại khi xuất; mọi tiêu đề khác bị xoá (bí mật phải đi qua credentialRef). */
export const TIEU_DE_VO_HAI: ReadonlySet<string> = new Set(["accept", "content-type", "accept-language", "user-agent"]);
const LOAI_HTTP = new Set(["tich-hop.http-doc", "tich-hop.http-gui"]);
/** Node MCP client: đối số tool (`thamSo`) là văn bản tự do của người soạn ⇒ cùng bộ làm sạch bí mật với thân HTTP. */
const LOAI_MCP = "tich-hop.mcp-goi";

/** Dòng / cặp xác thực: giá trị chạy TỚI HẾT dòng hoặc dấu & (vd "Authorization: Bearer abc", "authorization=Basic abc") — xoá cả giá trị nhiều từ. */
const RE_DONG_XAC_THUC = /((?:proxy-)?authorization|set-cookie|cookie)(["']?\s*[:=]\s*["']?)([^\r\n&"']*)/gi;
/** Cặp tên-bí-mật = giá trị: key=abc, "password": "x", mat_khau=abc, session_id: abc. Thay giá trị bằng rỗng. */
const RE_CAP_BI_MAT = new RegExp(String.raw`((?:${NGUON_KHOA_DAI}|\b(?:pwd|pass|otp|sid)\b)[\w-]*["']?\s*[:=]\s*["']?)([^&\s"',}]+)`, "gi");
/** Giá trị trông như token độc lập (không có tên khoá): sk-…, ghp_…, AKIA…, JWT, chuỗi ≥ 40 ký tự base64/hex. */
const RE_TOKEN_DOC_LAP = /(?:^|[^A-Za-z0-9_-])((?:sk|pk|ghp|gho|xox[bp])[-_][A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}|[A-Za-z0-9_-]{40,})(?![A-Za-z0-9_-])/g;

/** Xoá giá trị bí mật khỏi MỘT chuỗi (thân dạng chuỗi / giá trị tiêu đề). */
/** Thẻ XML mang bí mật: <password>…</password>, <api-key attr="x">…</api-key>, <token>… — xoá NỘI DUNG thẻ (giữ thẻ). */
const RE_THE_XML_BI_MAT = /(<\s*(?:password|passwd|pwd|secret|token|api[-_]?key|authorization|credential\w*)\b[^>]*>)([\s\S]*?)(<\/\s*(?:password|passwd|pwd|secret|token|api[-_]?key|authorization|credential\w*)\s*>)/gi;

export function lamSachChuoiBiMat(x: string): string {
  // so/ thay trên bản NFKC (gập full-width: ｐａｓｓｗｏｒｄ=… → password=…); chỉ trả bản đã thay khi THỰC SỰ có bí mật bị gỡ, còn không giữ nguyên chuỗi gốc
  const nx = x.normalize("NFKC");
  const sach = nx
    .replace(RE_THE_XML_BI_MAT, (_m, a: string, _b: string, c: string) => `${a}${c}`)
    .replace(RE_DONG_XAC_THUC, (_m, a: string, b: string) => `${a}${b}`)
    .replace(RE_CAP_BI_MAT, (_m, a: string) => a)
    .replace(RE_TOKEN_DOC_LAP, (m, t: string) => m.replace(t, ""));
  return sach === nx ? x : sach;
}

const PLACEHOLDER_DOAN = "DIEN-LAI-DOAN-DUONG-DAN";
/** Đoạn đường dẫn trông như bí mật: bot123456:xxxx, hoặc ≥ 24 ký tự chữ+số liền (có cả chữ lẫn số), hoặc hex ≥ 32. Đoạn chứa biểu thức {{ }} KHÔNG bị đụng. */
function doanGiongToken(s: string): boolean {
  if (s.includes("{{")) return false;
  if (/^[A-Za-z]*\d+:[A-Za-z0-9_-]{4,}$/.test(s)) return true;
  if (/^[0-9a-fA-F]{32,}$/.test(s)) return true;
  return /^[A-Za-z0-9_-]{24,}$/.test(s) && /[A-Za-z]/.test(s) && /\d/.test(s);
}

/** Vị trí đầu tiên của ?, #, hoặc dạng mã hoá %3F / %23 NGOÀI biểu thức {{ … }} (dấu ? của biểu thức ba ngôi không phải chuỗi truy vấn). */
function viTriTruyVan(u: string): number {
  for (let i = 0; i < u.length; i++) {
    if (u.startsWith("{{", i)) {
      const d = u.indexOf("}}", i + 2);
      if (d < 0) return -1;
      i = d + 1;
      continue;
    }
    if (u[i] === "?" || u[i] === "#") return i;
    if (u[i] === "%" && /^%(?:3f|23)/i.test(u.slice(i, i + 3))) return i;
  }
  return -1;
}

/**
 * url: bỏ khoảng trắng đầu/cuối, chuỗi truy vấn + fragment (cả dạng %3F/%23), tham số ma trận (;jsessionid=…), userinfo (cắt tới dấu '@' CUỐI của authority — mật khẩu chứa '@'),
 * và đoạn đường dẫn trông như token. Giữ scheme + host + port + đường còn lại. `doi` = có thay đổi (so với bản đã trim).
 */
export function lamSachUrl(u: string): { url: string; doi: boolean } {
  const goc = u.trim();
  let url = goc;
  const i = viTriTruyVan(url);
  if (i >= 0) url = url.slice(0, i);
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/]*)([\s\S]*)$/.exec(url);
  if (m) {
    let auth = m[2];
    const at = auth.lastIndexOf("@");
    if (at >= 0) auth = auth.slice(at + 1);
    const duong = m[3]
      .split("/")
      .map((seg) => {
        const cat = seg.includes("{{") ? seg : seg.split(";")[0];
        return doanGiongToken(cat) ? PLACEHOLDER_DOAN : cat;
      })
      .join("/");
    url = `${m[1]}${auth}${duong}`;
  }
  return { url, doi: url !== u };
}

function lamSachThan(v: unknown): { v: unknown; doi: boolean } {
  let doi = false;
  const di = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(di);
    if (x && typeof x === "object") {
      const ra: Record<string, unknown> = {};
      for (const [k, g] of Object.entries(x as Record<string, unknown>)) {
        if (laTenBiMat(k)) {
          if (g !== "" && g !== null && g !== undefined) doi = true;
          ra[k] = "";
        } else ra[k] = di(g);
      }
      return ra;
    }
    if (typeof x === "string") {
      const moi = lamSachChuoiBiMat(x);
      if (moi !== x) doi = true;
      return moi;
    }
    return x;
  };
  return { v: di(v), doi };
}

function lamSachHttp(ra: NodeInstance, viec: ViecPhaiDien[]): void {
  const p = ra.parameters;
  if (typeof p.url === "string") {
    const { url, doi } = lamSachUrl(p.url);
    if (doi) {
      p.url = url;
      viec.push({ nodeId: ra.id, truong: "url", viec: "http-bi-mat" });
    }
  }
  if (p.tieuDe && typeof p.tieuDe === "object" && !Array.isArray(p.tieuDe)) {
    const giu: Record<string, unknown> = {};
    let bo = false;
    for (const [k, g] of Object.entries(p.tieuDe as Record<string, unknown>)) {
      if (!TIEU_DE_VO_HAI.has(k.toLowerCase())) {
        bo = true;
        continue;
      }
      // tiêu đề vô hại vẫn có thể NHÉT bí mật vào giá trị (Accept: …; key=SEC) ⇒ quét giá trị
      if (typeof g === "string") {
        const sach = lamSachChuoiBiMat(g);
        if (sach !== g) bo = true;
        giu[k] = sach;
      } else giu[k] = g;
    }
    if (bo) {
      p.tieuDe = giu;
      viec.push({ nodeId: ra.id, truong: "tieuDe", viec: "http-bi-mat" });
    }
  }
  if (p.than !== undefined && p.than !== null) {
    let goc: unknown = p.than;
    let laChuoiJson = false;
    if (typeof goc === "string") {
      try {
        const j = JSON.parse(goc) as unknown;
        if (j && typeof j === "object") {
          goc = j;
          laChuoiJson = true;
        }
      } catch {
        /* chuỗi thường */
      }
    }
    const { v, doi } = lamSachThan(goc);
    if (doi) {
      p.than = laChuoiJson ? JSON.stringify(v) : v;
      viec.push({ nodeId: ra.id, truong: "than", viec: "http-bi-mat" });
    }
  }
}

function lamSachMcp(ra: NodeInstance, viec: ViecPhaiDien[]): void {
  const p = ra.parameters;
  if (p.thamSo !== undefined && p.thamSo !== null) {
    const { v, doi } = lamSachThan(p.thamSo);
    if (doi) {
      p.thamSo = v;
      viec.push({ nodeId: ra.id, truong: "thamSo", viec: "http-bi-mat" });
    }
  }
}

function lamTrongNut(n: NodeInstance, viec: ViecPhaiDien[]): NodeInstance {
  // Node GỌI LUỒNG CON không lưu được khi id con trống (id con phải CỐ ĐỊNH và tồn tại) ⇒ thay bằng node giữ chỗ `du-lieu.dat` (cùng id/tên/cổng) để luồng vẫn nhập được; người nhập thay lại bằng node luồng con.
  if (n.type === "luong.goi-con") {
    viec.push({ nodeId: n.id, truong: "flowId", viec: "luong-con" });
    return { id: n.id, type: "du-lieu.dat", typeVersion: 1, name: `[Chọn lại luồng con] ${n.name}`.slice(0, 120), position: n.position, parameters: { truong: {} }, ...(n.disabled ? { disabled: true } : {}) };
  }
  const ra: NodeInstance = { ...n, parameters: { ...(n.parameters ?? {}) } };
  if (ra.credentialRef !== undefined) {
    viec.push({ nodeId: ra.id, truong: "credentialRef", viec: "bi-mat" });
    delete ra.credentialRef;
    delete ra.parameters.kieuXacThuc; // đi cùng bí mật
  }
  // Đợt 10.2 — `chonModel` = model NGOÀI (ngoai:*) phụ thuộc nhà máy ĐÃ BẬT nhà cung cấp ⇒ gói không mang theo: về auto (bỏ khoá) + việc phải chọn lại.
  if (ra.type.startsWith("ai.") && typeof ra.parameters.chonModel === "string" && ra.parameters.chonModel.startsWith("ngoai:")) {
    delete ra.parameters.chonModel;
    viec.push({ nodeId: ra.id, truong: "chonModel", viec: "chon-model" });
  } else if (ra.type === "ai.kiem-dinh-ngoai" && (ra.parameters.chonModel === undefined || ra.parameters.chonModel === "")) {
    // ★ 10.4 — node kiểm định ngoài KHÔNG có "auto": vắng model (gói đã làm sạch / node mới) vẫn là việc phải chọn — lúc NHẬP gói không còn
    //   khoá chonModel để nhánh trên bắt, nên việc phải nêu ở đây (không thì người nhập không biết node chưa chạy được).
    viec.push({ nodeId: ra.id, truong: "chonModel", viec: "chon-model" });
  }
  if (LOAI_HTTP.has(ra.type)) lamSachHttp(ra, viec);
  if (ra.type === LOAI_MCP) lamSachMcp(ra, viec);
  for (const d of THAM_SO_THEO_NHA_MAY[ra.type]?.truong ?? []) {
    const cu = ra.parameters[d.truong];
    if (d.thanh === "luong-con") {
      if (Array.isArray(cu) && cu.length > 0) {
        ra.parameters[d.truong] = [];
        viec.push({ nodeId: ra.id, truong: d.truong, viec: d.viec });
      }
      continue;
    }
    if (d.thanh === "tat") {
      if (cu === true || laBieuThuc(cu)) viec.push({ nodeId: ra.id, truong: d.truong, viec: d.viec });
      ra.parameters[d.truong] = false;
      continue;
    }
    if (laBieuThuc(cu)) continue; // biểu thức không phải ID
    if (!trong(cu) || d.thanh === "bo") {
      if (!trong(cu)) viec.push({ nodeId: ra.id, truong: d.truong, viec: d.viec });
      if (d.thanh === "bo") delete ra.parameters[d.truong];
      else ra.parameters[d.truong] = d.thanh === "mang-rong" ? [] : "";
    } else if (!(d.truong in ra.parameters)) {
      // đã trống từ đầu: vẫn là việc phải điền (người nhập cần chọn)
      viec.push({ nodeId: ra.id, truong: d.truong, viec: d.viec });
    }
  }
  // việc còn thiếu (nhập): node loại này có khai trường mang id mà giá trị đang TRỐNG ⇒ phải điền
  for (const d of THAM_SO_THEO_NHA_MAY[ra.type]?.truong ?? []) {
    if (d.thanh === "tat" || d.thanh === "bo" || d.thanh === "luong-con") continue;
    const v = ra.parameters[d.truong];
    if (!laBieuThuc(v) && trong(v) && !viec.some((x) => x.nodeId === ra.id && x.truong === d.truong)) viec.push({ nodeId: ra.id, truong: d.truong, viec: d.viec });
  }
  return ra;
}

/**
 * Cảnh báo lúc NHẬP: node AI trỏ `chonModel: "ho-so:<id>"` mà máy này KHÔNG có hồ sơ đó (id hồ sơ là toàn hệ thống nhưng sổ model mỗi nơi khác nhau) — gọi sẽ lỗi cho tới khi chọn lại.
 * `coHoSo` do người gọi truyền (đọc ảnh sổ model) để hàm này vẫn THUẦN.
 */
export function canhBaoHoSoChonModel(def: FlowDefinition, coHoSo: (id: string) => boolean): string[] {
  const ra: string[] = [];
  for (const n of def.nodes) {
    const cm = n.type.startsWith("ai.") ? (n.parameters as Record<string, unknown> | undefined)?.chonModel : undefined;
    if (typeof cm === "string" && cm.startsWith("ho-so:") && !coHoSo(cm.slice("ho-so:".length))) ra.push(`node '${n.id}': hồ sơ model '${cm.slice(6, 100)}' không có ở máy này — chọn lại model trước khi bật luồng.`);
  }
  return ra;
}

/** Luồng SẠCH (không id/bí mật/dữ liệu ghim) + danh sách việc phải điền. Node luồng-con/agent có tham chiếu bị đưa về trống (xem THAM_SO_THEO_NHA_MAY). */
export function lamSachLuong(def: FlowDefinition): { luong: FlowDefinition; viec: ViecPhaiDien[] } {
  const viec: ViecPhaiDien[] = [];
  const nodes = def.nodes.map((n) => lamTrongNut(n, viec));
  const settings = { ...def.settings };
  if (settings.affinity !== undefined) {
    viec.push({ nodeId: "(luồng)", truong: "settings.affinity", viec: "affinity" });
    delete settings.affinity;
  }
  if (settings.errorFlowId !== undefined) {
    viec.push({ nodeId: "(luồng)", truong: "settings.errorFlowId", viec: "luong-loi" });
    delete settings.errorFlowId;
  }
  const luong: FlowDefinition = { id: "luong-nhap", name: def.name, version: 1, nodes, connections: def.connections, settings };
  return { luong, viec };
}

// ── quét văn bản tự do ───────────────────────────────────────────────────────────────────────────

export interface DauVetNhaMay {
  maMay: string[];
  nhaMay: string[];
  nguoi: string[];
  /** id SỐ của máy / người / nhà máy nguồn (kiem-dinh F2) */
  idMay?: number[];
}
export interface CanhBaoVanBan {
  nodeId: string;
  truong: string;
  loai: "ma-may" | "nha-may" | "nguoi-dung" | "bi-mat" | "id-so";
  khop: string;
}

const thoat = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function* duyetChuoi(v: unknown, duong: string): Generator<[string, string]> {
  if (typeof v === "string") yield [duong, v];
  else if (Array.isArray(v)) for (let i = 0; i < v.length; i++) yield* duyetChuoi(v[i], `${duong}[${i}]`);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) yield* duyetChuoi(x, duong ? `${duong}.${k}` : k);
}

/** Quét MỌI chuỗi của luồng (tên luồng, tên node, tham số) với dấu vết nhà máy nguồn (token ≥ 3 ký tự, khớp nguyên từ, không phân biệt hoa thường). Chỉ cảnh báo. */
/** Số nguyên (hoặc chuỗi-số / số đứng riêng trong biểu thức) trùng id SỐ của máy / người nhà máy nguồn — id < 100 bị bỏ (quá nhiều trùng ngẫu nhiên). */
const ID_SO_TOI_THIEU = 100;
function* duyetGiaTri(v: unknown, duong: string): Generator<[string, unknown]> {
  if (Array.isArray(v)) for (let i = 0; i < v.length; i++) yield* duyetGiaTri(v[i], `${duong}[${i}]`);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) yield* duyetGiaTri(x, duong ? `${duong}.${k}` : k);
  else yield [duong, v];
}

export function quetIdSo(def: FlowDefinition, idSo: number[], tran = 200): CanhBaoVanBan[] {
  const bo = new Set(idSo.filter((x) => Number.isSafeInteger(x) && x >= ID_SO_TOI_THIEU).map(String));
  const ra: CanhBaoVanBan[] = [];
  if (bo.size === 0) return ra;
  for (const n of def.nodes) {
    for (const [duong, g] of duyetGiaTri(n.parameters, "parameters")) {
      if (ra.length >= tran) return ra;
      if (typeof g === "number" && Number.isInteger(g) && bo.has(String(g))) ra.push({ nodeId: n.id, truong: duong, loai: "id-so", khop: String(g) });
      else if (typeof g === "string") {
        if (/^\s*\d+\s*$/.test(g) && bo.has(g.trim())) ra.push({ nodeId: n.id, truong: duong, loai: "id-so", khop: g.trim() });
        else if (g.includes("{{")) for (const m of g.matchAll(/(?<![\w.$])(\d{3,12})(?![\w.])/g)) if (bo.has(m[1])) ra.push({ nodeId: n.id, truong: duong, loai: "id-so", khop: m[1] });
      }
    }
  }
  return ra;
}

/** Mẫu BÍ MẬT còn sót trong tham số của gói: khoá tên giống bí mật mà giá trị là chuỗi không rỗng không phải biểu thức, hoặc giá trị dạng token dài / JWT / sk- / ghp_ / AKIA / "Bearer …". Không in giá trị đầy đủ. */
const RE_GIA_TRI_TOKEN = /(?:^|[^A-Za-z0-9_-])((?:sk|pk|ghp|gho|xox[bp])[-_][A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}|[A-Za-z0-9_-]{40,})(?![A-Za-z0-9_-])/;
export function quetBiMat(def: FlowDefinition, tran = 200): CanhBaoVanBan[] {
  const ra: CanhBaoVanBan[] = [];
  const rutGon = (s: string) => `${s.slice(0, 4)}…`;
  for (const n of def.nodes) {
    for (const [duong, g] of duyetGiaTri(n.parameters, "parameters")) {
      if (ra.length >= tran) return ra;
      if (typeof g !== "string" || g === "") continue;
      const khoa = duong.split(/[.[\]]/).filter(Boolean).pop() ?? "";
      if (!g.includes("{{") && RE_TEN_BI_MAT.test(khoa)) {
        ra.push({ nodeId: n.id, truong: duong, loai: "bi-mat", khop: khoa });
        continue;
      }
      const mt = RE_GIA_TRI_TOKEN.exec(g) ?? /\bBearer\s+(\S{8,})/i.exec(g);
      if (mt) ra.push({ nodeId: n.id, truong: duong, loai: "bi-mat", khop: rutGon(mt[1]) });
    }
  }
  return ra;
}

export function quetVanBan(def: FlowDefinition, dau: DauVetNhaMay, tran = 200): CanhBaoVanBan[] {
  const bo: { loai: CanhBaoVanBan["loai"]; re: RegExp; khop: string }[] = [];
  const them = (loai: CanhBaoVanBan["loai"], ds: string[]) => {
    for (const t of new Set(ds.map((x) => x.trim()).filter((x) => x.length >= 3))) {
      bo.push({ loai, khop: t, re: new RegExp(`(^|[^\\p{L}\\p{N}])${thoat(t)}($|[^\\p{L}\\p{N}])`, "iu") });
    }
  };
  them("ma-may", dau.maMay);
  them("nha-may", dau.nhaMay);
  them("nguoi-dung", dau.nguoi);
  const ra: CanhBaoVanBan[] = [];
  const xet = (nodeId: string, truong: string, chu: string) => {
    for (const b of bo) {
      if (ra.length >= tran) return;
      if (b.re.test(chu)) ra.push({ nodeId, truong, loai: b.loai, khop: b.khop });
    }
  };
  xet("(luồng)", "name", def.name);
  for (const n of def.nodes) {
    xet(n.id, "name", n.name);
    for (const [duong, chu] of duyetChuoi(n.parameters, "parameters")) xet(n.id, duong, chu);
  }
  // id SỐ của máy / người / nhà máy nguồn (kiem-dinh F2): số, chuỗi-số, số đứng riêng trong biểu thức
  for (const c of quetIdSo(def, dau.idMay ?? [], tran)) if (ra.length < tran) ra.push(c);
  return ra;
}

// ── gói ────────────────────────────────────────────────────────────────────────────────────────────

export interface GoiLuong {
  dinhDang: string;
  luong: FlowDefinition;
  viecPhaiDien: ViecPhaiDien[];
  bam: string;
}

export function taoGoi(def: FlowDefinition): { goi: GoiLuong; viec: ViecPhaiDien[] } {
  const { luong, viec } = lamSachLuong(def);
  return { goi: { dinhDang: DINH_DANG_GOI, luong, viecPhaiDien: viec, bam: bamLuong(luong) }, viec };
}

export type KetQuaPhanTich =
  | { ok: true; luong: FlowDefinition; viec: ViecPhaiDien[]; canhBao: ("bam-thieu" | "bam-lech" | "co-du-lieu-ghim" | "co-bi-mat" | "co-id-nha-may")[] }
  | { ok: false; ma: "DINH_DANG_LA" | "QUA_LON" | "KHONG_HOP_LE"; thongDiep: string };

/** Phân tích một gói do NGƯỜI DÙNG tải lên (không tin): định dạng lạ ⇒ từ chối; sai schema / quá lớn ⇒ từ chối; băm thiếu/lệch ⇒ chỉ cảnh báo; làm sạch LẠI y như xuất. */
export function phanTichGoi(goi: unknown): KetQuaPhanTich {
  let chu: string;
  try {
    chu = JSON.stringify(goi) ?? "";
  } catch {
    return { ok: false, ma: "KHONG_HOP_LE", thongDiep: "Gói không phải JSON hợp lệ." };
  }
  if (chu.length > TRAN_BYTE_GOI) return { ok: false, ma: "QUA_LON", thongDiep: `Gói vượt ${TRAN_BYTE_GOI / 1024} KB.` };
  const g = goi as Partial<GoiLuong> | null;
  if (!g || typeof g !== "object") return { ok: false, ma: "KHONG_HOP_LE", thongDiep: "Gói rỗng hoặc sai kiểu." };
  if (g.dinhDang !== DINH_DANG_GOI) return { ok: false, ma: "DINH_DANG_LA", thongDiep: `Định dạng gói '${String(g.dinhDang).slice(0, 40)}' không được hỗ trợ (cần ${DINH_DANG_GOI}).` };
  const p = FlowDefinitionSchema.safeParse(g.luong);
  if (!p.success) return { ok: false, ma: "KHONG_HOP_LE", thongDiep: `Luồng trong gói không hợp lệ: ${p.error.issues[0]?.path.join(".") || "(gốc)"} — ${p.error.issues[0]?.message ?? "sai schema"}`.slice(0, 300) };
  if (p.data.nodes.length > TRAN_NODE_GOI) return { ok: false, ma: "QUA_LON", thongDiep: `Gói có ${p.data.nodes.length} node — tối đa ${TRAN_NODE_GOI}.` };
  const canhBao: Extract<KetQuaPhanTich, { ok: true }>["canhBao"] = [];
  if (typeof g.bam !== "string" || g.bam === "") canhBao.push("bam-thieu");
  else if (g.bam !== bamLuong(g.luong)) canhBao.push("bam-lech");
  if (p.data.pinData && Object.keys(p.data.pinData).length > 0) canhBao.push("co-du-lieu-ghim");
  if (p.data.nodes.some((n) => n.credentialRef !== undefined)) canhBao.push("co-bi-mat");
  // gói do người khác soạn có thể MANG id nhà máy (máy, người nhận, luồng con, FOE…): báo, rồi làm sạch LẠI (nhập không tin gói)
  const mangId = p.data.nodes.some((n) => (THAM_SO_THEO_NHA_MAY[n.type]?.truong ?? []).some((d) => d.thanh !== "tat" && !trong(n.parameters[d.truong]) && !laBieuThuc(n.parameters[d.truong])));
  if (mangId) canhBao.push("co-id-nha-may");
  const { luong, viec } = lamSachLuong(p.data);
  return { ok: true, luong, viec, canhBao };
}

/** Id luồng mới từ tên (ASCII, ≤ 64) + hậu tố ngẫu nhiên. */
export function idLuongNhap(ten: string, duoi: string = Math.random().toString(36).slice(2, 8)): string {
  const goc = ten.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "luong";
  return `${goc}-${duoi}`.slice(0, 64);
}
