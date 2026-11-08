/** Gọi truy vấn tRPC qua HTTP GET (mount `/api/trpc`, transformer superjson). */
import { boBoiSuperjson } from "../loi/trpc";
import { maLoiTrpc } from "../loi/kiemDinhBong";

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

/**
 * ★ 10.4b-E (0.6.0) — gọi tRPC GIỮ mã lỗi (kiểm định cần phân biệt 409 `NGOAI_DANG_CHAY` / 413 / 429 …): KHÔNG ném với lỗi HTTP —
 * trả `{ ok: false, status, ma }` (`ma` = `appParams.reason` / `message` dạng `NGOAI_*`). Lỗi mạng ⇒ `status: 0`.
 */
export async function goiTrpcChiTiet(
  serverUrl: string,
  cookie: string,
  ten: string,
  dauVao: unknown,
  kieu: "truy-van" | "thay-doi",
): Promise<{ ok: true; du: unknown } | { ok: false; status: number; ma: string | null }> {
  const goc = serverUrl.replace(/\/+$/, "");
  const dau = { cookie: `app_session_id=${cookie}`, accept: "application/json" };
  let res: Response;
  try {
    res =
      kieu === "truy-van"
        ? await fetch(`${goc}/api/trpc/${ten}?input=${encodeURIComponent(JSON.stringify({ json: dauVao }))}`, { headers: dau })
        : await fetch(`${goc}/api/trpc/${ten}`, { method: "POST", headers: { ...dau, "content-type": "application/json" }, body: JSON.stringify({ json: dauVao }) });
  } catch {
    return { ok: false, status: 0, ma: null };
  }
  const than: unknown = await res.json().catch(() => null);
  const kq = res.ok ? boBoiSuperjson(than) : null;
  if (res.ok && kq !== null) return { ok: true, du: kq };
  return { ok: false, status: res.ok ? 502 : res.status, ma: maLoiTrpc(than) };
}
