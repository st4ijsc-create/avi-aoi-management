/** Gọi truy vấn tRPC qua HTTP GET (mount `/api/trpc`, transformer superjson). */
import { boBoiSuperjson } from "../loi/trpc";

export async function goiTruyVanTrpc(
  serverUrl: string,
  cookie: string,
  ten: string,
  dauVao?: unknown,
): Promise<unknown> {
  const goc = serverUrl.replace(/\/+$/, "");
  const q = dauVao === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: dauVao }))}`;
  const res = await fetch(`${goc}/api/trpc/${ten}${q}`, {
    headers: { cookie: `app_session_id=${cookie}`, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`tRPC ${ten} trả ${res.status}`);
  return boBoiSuperjson(await res.json());
}

/** Gọi thủ tục tRPC dạng MUTATION (HTTP POST, superjson). Lỗi HTTP/đáp ứng lỗi ⇒ ném (không trả giá trị giả). */
export async function goiThayDoiTrpc(serverUrl: string, cookie: string, ten: string, dauVao: unknown): Promise<unknown> {
  const goc = serverUrl.replace(/\/+$/, "");
  const res = await fetch(`${goc}/api/trpc/${ten}`, {
    method: "POST",
    headers: { cookie: `app_session_id=${cookie}`, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ json: dauVao }),
  });
  if (!res.ok) throw new Error(`tRPC ${ten} trả ${res.status}`);
  const kq = boBoiSuperjson(await res.json());
  if (kq === null) throw new Error(`tRPC ${ten} trả đáp ứng lỗi`);
  return kq;
}
