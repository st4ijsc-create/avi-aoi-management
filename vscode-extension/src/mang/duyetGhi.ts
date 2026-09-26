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

async function goiMutation(serverUrl: string, cookie: string, ten: string, dauVao: unknown): Promise<unknown> {
  const res = await fetch(`${serverUrl.replace(/\/+$/, "")}/api/trpc/${ten}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `app_session_id=${cookie}` },
    body: JSON.stringify({ json: dauVao }),
  });
  if (!res.ok) throw new Error(`tRPC ${ten} trả ${res.status}`);
  return boBoiSuperjson(await res.json());
}

export async function goiDuyet(
  serverUrl: string,
  cookie: string,
  actionId: string,
  token: string,
): Promise<KetQuaDuyet> {
  return docKetQuaDuyet(
    await goiMutation(serverUrl, cookie, "aiCopilot.confirmAction", { actionId, token, lang: "vi" }),
  );
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
  cookie: string,
  dv: DauVaoBatDauApClient,
): Promise<KetQuaBatDauApClient> {
  return docKetQuaBatDau(await goiMutation(serverUrl, cookie, "aiCopilot.batDauApDungOClient", dv));
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
  cookie: string,
  dv: DauVaoChotApClient,
): Promise<KetQuaDuyet> {
  return docKetQuaDuyet(await goiMutation(serverUrl, cookie, "aiCopilot.chotApDungOClient", dv));
}
