/**
 * Gọi CỬA DUYỆT của máy chủ. Đây là ĐIỂM DUY NHẤT trong extension gọi `confirmAction` — có lưới
 * census (`loi/census.unit.test.ts`) cưỡng chế đúng-một-nơi. Byte do MÁY CHỦ ghi vào hộp cát của
 * nó; extension không chạm đĩa.
 *
 * ⚠ KHÔNG gửi `selectedHunkIds` ở Đợt B (duyệt cả tệp). Schema máy chủ chỉ nhận SỐ ở ô đó và có
 *   census riêng bắt đỏ nếu ai nhét nội dung vào — đừng mở lại lỗ mà HITL sinh ra để đóng.
 *
 * ⚠⚠⚠ MÁY CHỦ TRẢ VỀ (KHÔNG NÉM) KHI TỪ CHỐI — qua HTTP 200 (`aiCopilotActions.ts:664-687`):
 *   token/owner lệch, trạng thái sai, HẾT HẠN TTL (5 phút — rất dễ xảy ra vì người dùng đọc diff
 *   rồi mới bấm), hay đã thực thi trước đó. `goiMutation` chỉ ném khi `!res.ok`, nên các ca trên
 *   đi qua BÌNH THƯỜNG như một lần gọi "thành công". Đọc trường `ok` ở phía gọi là BẮT BUỘC — bỏ
 *   qua nó là lặp lại đúng lớp lỗi "status nói dối" mà Đợt B này được dựng ra để chống (xem Task 6:
 *   vá lỗ tương tự ở phía máy chủ cho cột `status`).
 *
 * ⚠⚠⚠ 2026-08-29 — ĐỌC `ok` LÀ CẦN NHƯNG CHƯA ĐỦ. `ok:true` chỉ nói *"vòng đời HITL đã chạy
 *   xong"*, KHÔNG nói *"byte đã vào đĩa"*. Khi băm neo lệch (`BASE_MISMATCH` — ai đó sửa tệp giữa
 *   lúc thẻ duyệt hiện ra và lúc bấm) hay tệp bẩn (`FILE_DIRTY`), `execute()` TỪ CHỐI ghi ĐÚNG NHƯ
 *   THIẾT KẾ, nhưng `confirmAction` vẫn trả `{ok:true, status:"executed", result:<ToolResult mang
 *   note>}` (`aiCopilotActions.ts:940`). Sự thật nằm ở `note` của `ToolResult` (ở đây là
 *   `KetQuaDuyet.result`) — đọc bằng ĐÚNG vị từ dùng chung `shared/aiCodingLoop.daBiTuChoiGhi`, đã
 *   cắn CLI (`aiCodingCli/cli.ts`, 2026-08-23) và WEB (`AICodingWorkspace.tsx`) trước khi tới đây.
 *   **KHÔNG viết lại phép kiểm `note` ở extension** — "hai bản sao của một vị từ an toàn là cách
 *   chắc chắn nhất để chúng trôi khỏi nhau, và bản lỏng hơn bao giờ cũng là bản đang chạy" (docblock
 *   `shared/aiCodingLoop.ts:339-343`). Extension là nơi gọi THỨ TƯ của cùng một hàm, không phải một
 *   bản cài đặt thứ hai. Re-export ở đây để `bangChat.ts` có ĐÚNG MỘT nơi nhập trong extension.
 */
import { boBoiSuperjson } from "../loi/trpc";
import { kiemTraServerUrl } from "../loi/dangNhap";
import { daBiTuChoiGhi, maTuChoiGhi } from "../../../shared/aiCodingLoop";

export { daBiTuChoiGhi, maTuChoiGhi };

/** Kết quả cửa duyệt của máy chủ. ⚠ Máy chủ TRẢ VỀ (không ném) khi từ chối: hết hạn, token lệch,
 *  trạng thái sai — tất cả qua HTTP 200. Đọc `ok` là BẮT BUỘC, nếu không giao diện sẽ nói dối. */
export interface KetQuaDuyet {
  ok: boolean;
  status?: string;
  message?: string;
  result?: unknown;
}

/** Diễn dịch THUẦN đáp ứng đã bóc superjson thành `KetQuaDuyet` — không đoán khi hình dạng lạ. */
export function docKetQuaDuyet(dap: unknown): KetQuaDuyet {
  if (!dap || typeof dap !== "object") {
    return { ok: false, message: "Đáp ứng không hợp lệ từ máy chủ." };
  }
  const o = dap as Record<string, unknown>;
  return {
    ok: o.ok === true,
    status: typeof o.status === "string" ? o.status : undefined,
    message: typeof o.message === "string" ? o.message : undefined,
    result: o.result,
  };
}

/**
 * R1b-1 T10 fix round 1 (I-2) — lỗi HTTP của máy chủ KÈM mã ứng dụng (`data.appCode`) và câu của nó, để `goiDuyet` phân biệt một lượt từ chối
 * ĐÃ BIẾT KẾT CỤC (FORBIDDEN SCADA_AI_LEVEL_TOO_HIGH) với hỏng đường truyền ("không biết"). Thông điệp `Error.message` giữ NGUYÊN như trước.
 */
export class LoiMayChuTuChoi extends Error {
  constructor(
    message: string,
    readonly appCode: string | null,
    readonly thongDiepMayChu: string | null,
  ) {
    super(message);
    this.name = "LoiMayChuTuChoi";
  }
}

/** Bóc `{error:{json:{message, data:{appCode}}}}` của tRPC khi đáp ứng lỗi; hình dạng lạ / không phải JSON ⇒ null cả hai. */
async function docLoiTrpc(res: Response): Promise<{ appCode: string | null; thongDiep: string | null }> {
  try {
    const j = (await res.json()) as { error?: { json?: unknown; message?: unknown; data?: unknown } };
    const e = (j?.error?.json ?? j?.error) as { message?: unknown; data?: { appCode?: unknown } } | undefined;
    return {
      appCode: typeof e?.data?.appCode === "string" ? e.data.appCode : null,
      thongDiep: typeof e?.message === "string" ? e.message : null,
    };
  } catch {
    return { appCode: null, thongDiep: null };
  }
}

async function goiMutation(serverUrl: string, cookie: string, ten: string, dauVao: unknown): Promise<unknown> {
  const res = await fetch(`${serverUrl.replace(/\/+$/, "")}/api/trpc/${ten}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `app_session_id=${cookie}` },
    body: JSON.stringify({ json: dauVao }),
  });
  if (!res.ok) {
    const { appCode, thongDiep } = await docLoiTrpc(res);
    throw new LoiMayChuTuChoi(`tRPC ${ten} trả ${res.status}`, appCode, thongDiep);
  }
  return boBoiSuperjson(await res.json());
}

export async function goiDuyet(
  serverUrl: string,
  cookie: string,
  actionId: string,
  token: string,
): Promise<KetQuaDuyet> {
  try {
    return docKetQuaDuyet(
      await goiMutation(serverUrl, cookie, "aiCopilot.confirmAction", { actionId, token, lang: "vi" }),
    );
  } catch (e) {
    // R1b-1 T10 fix round 1 (I-2) — AI không bao giờ ra lệnh mức ≥ 4: máy chủ từ chối VĨNH VIỄN (FORBIDDEN). Đây là kết cục ĐÃ BIẾT (không
    // chạy gì), không phải "KHÔNG RÕ KẾT CỤC" — trả như một lượt từ chối thường để giao diện hiện đúng câu của máy chủ.
    if (e instanceof LoiMayChuTuChoi && e.appCode === "SCADA_AI_LEVEL_TOO_HIGH") {
      return { ok: false, status: "denied", message: e.thongDiepMayChu ?? "Trợ lý AI không được ra lệnh cho kênh mức tác động từ 4 trở lên." };
    }
    throw e;
  }
}

export async function goiHuy(serverUrl: string, cookie: string, actionId: string): Promise<KetQuaDuyet> {
  return docKetQuaDuyet(await goiMutation(serverUrl, cookie, "aiCopilot.cancelAction", { actionId }));
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ ĐỢT C — SỔ KIỂM TOÁN CHO CHẾ ĐỘ **LOCAL** (byte do EXTENSION ghi, không phải máy chủ)
// ══════════════════════════════════════════════════════════════════════════════════════════════
// Hai hàm dưới đây KHÔNG phải một cửa duyệt thứ hai. Chúng chỉ GHI SỔ: máy chủ không với tới đĩa
// máy dev nên không quan sát được gì — nó chỉ ghi lại đúng những gì extension TỰ KHAI, trước và sau
// khi byte rơi (spec §6.5, cài đặt ở `server/services/aiCopilotActions.ts`).
//
// ⚠ VÌ SAO ĐẶT CHUNG TỆP VỚI CỬA DUYỆT SERVER: `goiMutation` là chỗ DUY NHẤT trong extension dựng
//   một lượt POST tRPC (URL, cookie, bóc superjson, ném khi `!res.ok`). Nhân bản nó sang một tệp
//   thứ hai là đẻ ra một bản sao sẽ trôi khỏi bản này — đúng lớp lỗi mà cả docblock trên đang cảnh
//   báo về `daBiTuChoiGhi`. Đây là lớp VẬN CHUYỂN dùng chung; **quyết định** đi đường nào vẫn tách
//   bạch ở lớp trên: chế độ SERVER chỉ gọi `goiDuyet`/`goiHuy`, chế độ LOCAL chỉ gọi hai hàm dưới
//   (`ui/apBanVa.ts`) — không đường chéo, spec §7.
//
// ⚠⚠ TÊN TRƯỜNG ĐÃ ĐO TRÊN MÃ MÁY CHỦ, KHÔNG ĐOÁN (`server/routers/aiCopilotRouter.ts:137-171`):
//   `batDauApDungOClient` nhận {path, nhanWorkspace, sha256Truoc, sha256Sau, tomTat, soDongThem,
//   soDongBot} và trả {actionId, token}; `chotApDungOClient` nhận {actionId, token, thanhCong,
//   sha256SauThat?, loi?} và trả {ok, status, message?}. Hai băm ở tầng zod bị ràng
//   `/^[0-9a-f]{64}$/i` — gửi nhầm nội dung tệp vào đó bị chặn ngay ở router.

/** Đầu vào của `batDauApDungOClient` — CHỈ băm + siêu dữ liệu, TUYỆT ĐỐI không nội dung tệp. */
export interface DauVaoBatDauApClient {
  /** Đường TƯƠNG ĐỐI trong workspace — máy chủ không cần (và không được nhận) đường tuyệt đối máy dev. */
  path: string;
  nhanWorkspace: string;
  sha256Truoc: string;
  sha256Sau: string;
  tomTat: string;
  soDongThem: number;
  soDongBot: number;
}

export interface KetQuaBatDauApClient {
  actionId: string;
  token: string;
}

/** Diễn dịch THUẦN đáp ứng `batDauApDungOClient` — hình dạng lạ ⇒ hai chuỗi rỗng, KHÔNG đoán. */
export function docKetQuaBatDau(dap: unknown): KetQuaBatDauApClient {
  if (!dap || typeof dap !== "object") return { actionId: "", token: "" };
  const o = dap as Record<string, unknown>;
  return {
    actionId: typeof o.actionId === "string" ? o.actionId : "",
    token: typeof o.token === "string" ? o.token : "",
  };
}

/** GHI TRƯỚC khi byte rơi. Ném khi không nối được máy chủ — phía gọi PHẢI dừng, không ghi. */
export async function goiBatDauApClient(
  serverUrl: string,
  xacThuc: XacThucSo,
  dv: DauVaoBatDauApClient,
): Promise<KetQuaBatDauApClient> {
  if (typeof xacThuc !== "string") {
    // ★ 4B-client: chỉ 200 mới là sổ đã mở; mọi khung lỗi đều ném (`goiRestBearer`) ⇒ phía gọi KHÔNG ghi.
    const { than } = await goiRestBearer(serverUrl, xacThuc.bearer, "/api/ai/client-apply/bat-dau", dv, false);
    return docKetQuaBatDau(than);
  }
  return docKetQuaBatDau(await goiMutation(serverUrl, xacThuc, "aiCopilot.batDauApDungOClient", dv));
}

export interface DauVaoChotApClient {
  actionId: string;
  token: string;
  thanhCong: boolean;
  sha256SauThat?: string;
  loi?: string;
}

/** CHỐT SAU khi byte đã rơi (hoặc đã hỏng). Cùng hình dạng {ok,status,message} như cửa duyệt. */
export async function goiChotApClient(
  serverUrl: string,
  xacThuc: XacThucSo,
  dv: DauVaoChotApClient,
): Promise<KetQuaDuyet> {
  if (typeof xacThuc !== "string") {
    // 200 / 409 / 503-DB_UNAVAILABLE đều mang THÂN DỊCH VỤ `{ok,…}` ⇒ đọc `ok` (không ném) như tRPC cũ trả HTTP 200.
    const { than } = await goiRestBearer(serverUrl, xacThuc.bearer, "/api/ai/client-apply/chot", dv, true);
    return docKetQuaDuyet(than);
  }
  return docKetQuaDuyet(await goiMutation(serverUrl, xacThuc, "aiCopilot.chotApDungOClient", dv));
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ ĐỢT 4B-client (2026-10-17) — CÙNG HAI LƯỢT GHI SỔ, VẬN CHUYỂN QUA REST BEARER (máy chủ 126de672b)
// ══════════════════════════════════════════════════════════════════════════════════════════════
// Lõi agent của extension đăng nhập bằng DEVICE FLOW (token `avgw_…`, phạm vi `chat`/`fim`/`apply`) — không có cookie
// phiên. Hai tuyến `POST /api/ai/client-apply/{bat-dau,chot}` (`server/routes/aiGatewayTokenBearerApi.ts`) gọi ĐÚNG hai
// hàm dịch vụ mà tRPC `aiCopilot.*ApDungOClient` gọi, với ĐÚNG lược đồ — nên đây chỉ là đổi LỚP VẬN CHUYỂN, không phải
// một sổ thứ hai. Đã đo trên mã máy chủ:
//   · thân yêu cầu = JSON THẲNG (không bọc `{json}`); người = CHỦ TOKEN (máy chủ không đọc người từ thân);
//   · thân thành công = NGUYÊN VĂN thân tRPC cũ; `chot` ok:false ⇒ 409 + thân dịch vụ; `chot` DB hỏng ⇒ 503 + thân dịch vụ;
//   · mọi từ chối khác = khung OpenAI `{error:{message,type,code}}` — 401 token · 403 `permission_denied` /
//     `insufficient_scope` · 429 · 400 `invalid_body` · 503 `db_unavailable`/`auth_backend_unavailable`/`server_error`.
// ⚠⚠ FAIL-CLOSED: không mở được sổ ⇒ NÉM ⇒ `apBanVa` KHÔNG ghi byte nào ("thà không ghi còn hơn ghi mà không có vết").
//   Token cũ thiếu `apply` KHÔNG được lùi về cookie hay "ghi tạm không sổ" — quyết định của chủ dự án: không có sổ kiểm
//   toán thì không ghi; thông điệp chỉ ĐÚNG việc phải làm (đăng nhập lại để token mới mang `apply`).

/** Cách xác thực lượt ghi sổ: chuỗi = cookie phiên (khung chat cũ, tRPC) · `{bearer}` = token cá nhân (lõi agent, REST). */
export type XacThucSo = string | { bearer: string };

export type MaLoiSoKiemToan =
  | "CHUA_CO_TOKEN"
  | "THIEU_PHAM_VI_APPLY"
  | "TOKEN_401"
  | "TOKEN_403"
  | "QUA_TRAN"
  | "SO_KIEM_TOAN_TAM_LOI"
  | "LOI_SO";

/** Lỗi của lượt ghi sổ qua REST — `ma` máy đọc để phía gọi (lõi agent) quyết định cách nói với model/người dùng. */
export class LoiSoKiemToan extends Error {
  constructor(
    message: string,
    readonly ma: MaLoiSoKiemToan,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LoiSoKiemToan";
  }
}

const LENH_DANG_NHAP_THIET_BI = '"AI Local: Đăng nhập AI Local (device flow)"';

/** Diễn dịch THUẦN khung lỗi `{error:{code,message}}` của các tuyến REST Bearer ⇒ mã + câu tiếng Việt chỉ việc phải làm. */
export function moTaLoiSoKiemToan(status: number, than: unknown, retryAfter?: string | null): { ma: MaLoiSoKiemToan; thongDiep: string } {
  const e = (than && typeof than === "object" ? (than as { error?: unknown }).error : undefined) as
    | { message?: unknown; code?: unknown }
    | undefined;
  const code = e && typeof e === "object" && typeof e.code === "string" ? e.code : "";
  const msg = e && typeof e === "object" && typeof e.message === "string" ? e.message : "";
  const chiTiet = [code, msg].filter(Boolean).join(": ");
  const kem = chiTiet ? ` — ${chiTiet}` : "";
  if (status === 403 && code === "insufficient_scope") {
    return {
      ma: "THIEU_PHAM_VI_APPLY",
      thongDiep:
        `token hiện tại thiếu phạm vi 'apply' (403${kem}) — token này được cấp trước khi extension xin quyền ghi sổ kiểm toán. ` +
        `Hãy đăng nhập lại để cấp quyền ghi sổ: chạy lệnh ${LENH_DANG_NHAP_THIET_BI}. Không có sổ kiểm toán thì extension KHÔNG áp tệp.`,
    };
  }
  if (status === 401) {
    return {
      ma: "TOKEN_401",
      thongDiep: `token cá nhân bị từ chối (401${kem}): chưa có, hết hạn hoặc đã thu hồi — chạy lệnh ${LENH_DANG_NHAP_THIET_BI} để đăng nhập lại.`,
    };
  }
  if (status === 403) {
    const goiY =
      code === "password_change_required"
        ? "tài khoản phải đổi mật khẩu trên web trước"
        : code === "account_disabled"
          ? "tài khoản đã bị khoá"
          : "tài khoản không còn quyền AI hoặc giấy phép module AI chưa bật";
    return { ma: "TOKEN_403", thongDiep: `máy chủ từ chối ghi sổ (403${kem}): ${goiY}.` };
  }
  if (status === 429) {
    const giay = retryAfter && /^\d+$/.test(retryAfter) ? ` Thử lại sau ~${retryAfter} giây.` : "";
    return { ma: "QUA_TRAN", thongDiep: `máy chủ chặn tạm vì vượt trần lượt ghi sổ/phút của token (429${kem}).${giay}` };
  }
  if (status >= 500) {
    return { ma: "SO_KIEM_TOAN_TAM_LOI", thongDiep: `máy chủ không ghi được sổ kiểm toán lúc này (${status}${kem}).` };
  }
  if (status === 404) {
    return { ma: "LOI_SO", thongDiep: "máy chủ chưa có tuyến /api/ai/client-apply (bản máy chủ cũ hơn 4B-server, hoặc thiếu giấy phép AI)." };
  }
  return { ma: "LOI_SO", thongDiep: `máy chủ trả ${status}${kem} khi ghi sổ kiểm toán.` };
}

/**
 * Một lượt POST Bearer. `thanDichVuHopLe` ⇒ thân mang `ok` boolean (thân dịch vụ của `chot`) được TRẢ VỀ dù mã ≠ 200.
 * Mọi trường hợp khác ngoài 200 ⇒ ném `LoiSoKiemToan`. Token RỖNG ⇒ ném TRƯỚC khi chạm mạng.
 */
async function goiRestBearer(
  serverUrl: string,
  token: string,
  duong: string,
  than: unknown,
  thanDichVuHopLe: boolean,
): Promise<{ status: number; than: unknown }> {
  if (!token) {
    throw new LoiSoKiemToan(`chưa có token cá nhân để ghi sổ kiểm toán — chạy lệnh ${LENH_DANG_NHAP_THIET_BI}.`, "CHUA_CO_TOKEN");
  }
  const kt = kiemTraServerUrl(serverUrl);
  if (!kt.ok) throw new LoiSoKiemToan(kt.lyDo, "LOI_SO");
  const res = await fetch(`${kt.url}${duong}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(than),
  });
  let du: unknown = null;
  try {
    du = await res.json();
  } catch {
    du = null;
  }
  if (res.status === 200) return { status: res.status, than: du };
  if (thanDichVuHopLe && du && typeof du === "object" && typeof (du as { ok?: unknown }).ok === "boolean") {
    return { status: res.status, than: du };
  }
  const m = moTaLoiSoKiemToan(res.status, du, res.headers?.get?.("retry-after"));
  throw new LoiSoKiemToan(m.thongDiep, m.ma, res.status);
}
