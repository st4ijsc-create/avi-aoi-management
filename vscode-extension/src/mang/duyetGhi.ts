/**
 * Gọi CỬA DUYỆT của máy chủ. Đây là ĐIỂM DUY NHẤT trong extension gọi `confirmAction` — có lưới
 * census (`loi/census.unit.test.ts`) cưỡng chế đúng-một-nơi. Byte do MÁY CHỦ ghi vào hộp cát của
 * nó; extension không chạm đĩa.
 *
 * ⚠ KHÔNG gửi `selectedHunkIds` ở Đợt B (duyệt cả tệp). Schema máy chủ chỉ nhận SỐ ở ô đó và có
 *   census riêng bắt đỏ nếu ai nhét nội dung vào — đừng mở lại lỗ mà HITL sinh ra để đóng.
 */
import { boBoiSuperjson } from "../loi/trpc";

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
): Promise<unknown> {
  return goiMutation(serverUrl, cookie, "aiCopilot.confirmAction", { actionId, token, lang: "vi" });
}

export async function goiHuy(serverUrl: string, cookie: string, actionId: string): Promise<unknown> {
  return goiMutation(serverUrl, cookie, "aiCopilot.cancelAction", { actionId });
}
