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
