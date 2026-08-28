/**
 * Vòng đọc SSE. Tách làm hai để đo được: `docLuongSse` nhận sẵn một stream (lưới dựng stream giả,
 * không cần mạng), `moDongSse` chỉ lo `fetch` + cookie.
 */
import { tachKhungSse } from "../loi/khungSse";

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
    // Chỉ 401/403 mới là chuyện phiên đăng nhập. Gán mọi mã lỗi vào "đăng nhập lại" là chỉ sai
    // đường cho người dùng: họ đăng nhập lại, vẫn hỏng, và không ai biết nguyên nhân thật.
    const mat_phien = res.status === 401 || res.status === 403;
    throw new Error(
      mat_phien
        ? `Máy chủ trả ${res.status} — phiên đăng nhập không còn hiệu lực, hãy đăng nhập lại.`
        : `Máy chủ trả ${res.status}.`,
    );
  }
  if (!res.body) throw new Error("Máy chủ không trả luồng dữ liệu.");
  return docLuongSse(res.body, dv.nhan);
}
