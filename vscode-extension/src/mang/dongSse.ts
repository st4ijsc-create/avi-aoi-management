/**
 * Vòng đọc SSE. Tách làm hai để đo được: `docLuongSse` nhận sẵn một stream (lưới dựng stream giả,
 * không cần mạng), `moDongSse` chỉ lo `fetch` + cookie.
 */
import { tachKhungSse } from "../loi/khungSse";
import { LoiHttp, moTaLoiHttp } from "../loi/loiHttp";

export async function docLuongSse(
  luong: ReadableStream<Uint8Array>,
  nhan: (sk: Record<string, unknown>) => void,
): Promise<{ hong: string[] }> {
  const doc = luong.getReader();
  const giaiMa = new TextDecoder();
  let dem = "";
  const hong: string[] = [];

  try {
    for (;;) {
      const { done, value } = await doc.read();
      if (done) break;
      const r = tachKhungSse(dem, giaiMa.decode(value, { stream: true }));
      dem = r.du;
      hong.push(...r.hong);
      for (const sk of r.suKien) nhan(sk);
    }
  } finally {
    // Trả khoá DÙ CÓ NÉM. `nhan` là callback của lớp trên (bảng chat) — nó ném thì luồng vẫn
    // đang khoá và kết nối phía dưới không được giải phóng. `finally` là chỗ DUY NHẤT bảo đảm
    // điều đó, vì đường thoát bằng ngoại lệ không đi qua `return`.
    doc.releaseLock();
  }
  return { hong };
}

export async function moDongSse(dv: {
  serverUrl: string;
  cookie: string;
  than: unknown;
  nhan: (sk: Record<string, unknown>) => void;
  tinHieu?: AbortSignal;
}): Promise<{ hong: string[] }> {
  const res = await fetch(`${dv.serverUrl.replace(/\/+$/, "")}/api/ai/local-kb/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      cookie: `app_session_id=${dv.cookie}`,
    },
    body: JSON.stringify(dv.than),
    signal: dv.tinHieu,
  });
  if (!res.ok) {
    // 401 và 403 KHÔNG PHẢI cùng một chuyện (server/routes/_xacThucRest.ts): 403 có thể là
    // MUST_CHANGE_PASSWORD/ACCOUNT_DISABLED, mà "đăng nhập lại" không cứu được — đăng nhập xong,
    // lượt kế lại 403 y hệt, một vòng lặp không lối ra. Đọc thân JSON (có thể vắng/không phải
    // JSON) rồi giao `moTaLoiHttp` (THUẦN, có lưới) quyết định câu — không tự bịa ở đây.
    let than: unknown = null;
    try {
      than = await res.json();
    } catch {
      than = null;
    }
    throw new LoiHttp(res.status, moTaLoiHttp(res.status, than));
  }
  if (!res.body) throw new Error("Máy chủ không trả luồng dữ liệu.");
  return docLuongSse(res.body, dv.nhan);
}
