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
 */
import { boBoiSuperjson } from "../loi/trpc";

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
