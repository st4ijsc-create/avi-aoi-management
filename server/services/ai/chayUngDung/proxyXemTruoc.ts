/**
 * ★★★ Đợt 3c (2026-10-17) — **PROXY XEM TRƯỚC TRÊN MỘT CỔNG RIÊNG** — điểm an ninh then chốt của đợt.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VẤN ĐỀ: XEM TRƯỚC = CHẠY SCRIPT DO AI SINH TRONG TRÌNH DUYỆT CỦA NGƯỜI DÙNG ĐÃ ĐĂNG NHẬP
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Nếu trang xem trước được phục vụ CÙNG ORIGIN với ứng dụng chính (`/api/ai/preview/...` proxy thẳng trên :3000),
 * thì một dòng `fetch("/api/trpc/...", {credentials:"include"})` trong mã AI sinh ra chạy với PHIÊN của người
 * dùng — và đọc được kết quả (same-origin, không CORS nào chặn): đọc dữ liệu, gọi mutation, kể cả các bề mặt điều
 * khiển máy. `iframe sandbox` cùng origin + `allow-scripts allow-same-origin` thì tự gỡ được sandbox. ⇒ KHÔNG chấp
 * nhận được trên một hệ MES có điều khiển thiết bị.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THIẾT KẾ ĐÃ CHỌN — BA LỚP, MỖI LỚP CÓ LƯỚI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   1. **ORIGIN RIÊNG**: proxy là một `http.Server` khác, nghe `AI_PREVIEW_PROXY_PORT` (khác cổng ứng dụng ⇒ khác
 *      origin). Script xem trước không chạm được DOM/localStorage của ứng dụng; lời gọi tới :3000 là CROSS-ORIGIN
 *      ⇒ CORS của :3000 không phản chiếu origin xem trước (`laOriginXemTruoc` chặn cả nhánh dev "phản chiếu mọi
 *      origin") ⇒ không ĐỌC được phản hồi nào. `AI_PREVIEW_PUBLIC_ORIGIN` cho phép đặt hẳn một HOST khác (vd IP
 *      riêng) ⇒ khác cả SITE ⇒ cookie SameSite=Lax của ứng dụng không được gửi kèm ⇒ đóng luôn CSRF "same-site".
 *   2. **KHÔNG CHIA COOKIE PHIÊN ỨNG DỤNG**: proxy KHÔNG dùng `app_session_id` để xác thực (cookie không tách theo
 *      cổng nên trình duyệt VẪN gửi nó tới đây — proxy GỠ nó, không chuyển tiếp). Xác thực bằng VÉ MỘT LẦN (60 s)
 *      do tuyến `/api/ai/preview/:projectId` của ứng dụng cấp SAU khi kiểm phiên + chủ sở hữu, đổi ở `DUONG_VAO`
 *      lấy cookie RIÊNG `__aipv_phien` (HttpOnly, SameSite=Lax, 30 phút, giá trị ngẫu nhiên 256 bit).
 *      Cookie đi vào ứng dụng xem trước chỉ là cookie trong KHÔNG GIAN TÊN `__aipv_u_` (bỏ tiền tố); Set-Cookie đi
 *      ra bị đổi tên vào không gian ấy + bỏ `Domain` ⇒ ứng dụng xem trước không ghi đè được `app_session_id`.
 *   3. **CHỈ CHUYỂN TỚI CỔNG ĐÃ CẤP**: mỗi yêu cầu tra lại trình quản lý: dự án còn chạy · người giữ phiên ĐÚNG là
 *      người đã chạy ứng dụng · cổng nằm TRONG dải (`trongDai`) — ngoài dải ⇒ 403 trước khi mở một socket nào
 *      (proxy không bao giờ thành đường tới :5434/:8091/:3000).
 *   ★ `iframe sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"`: `allow-same-origin`
 *     là CẦN (để cookie riêng của proxy đi kèm tài nguyên con) và AN TOÀN ở đây vì origin của khung ≠ origin cha —
 *     cảnh báo "allow-scripts + allow-same-origin gỡ được sandbox" chỉ đúng khi khung CÙNG origin với cha. Khởi động
 *     TỪ CHỐI nếu cổng proxy trùng cổng ứng dụng hoặc rơi vào dải xem trước (`index.ts`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * GIỚI HẠN KHAI THẲNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   • Cùng HOST khác cổng = cùng SITE: một form POST `text/plain` từ trang xem trước tới :3000 vẫn mang cookie Lax
 *     (CSRF mù — không đọc được phản hồi). Đóng hẳn bằng `AI_PREVIEW_PUBLIC_ORIGIN` khác host, hoặc
 *     `SEC_ORIGIN_CHECK_MODE=enforce` (origin-check sẵn có chặn origin khác host:port ở prod).
 *   • Một trình duyệt xem MỘT dự án tại một thời điểm qua cổng proxy (cookie phiên là một ô); mở dự án thứ hai sẽ
 *     chuyển phiên sang dự án ấy.
 *   • Proxy KHÔNG viết lại HTML/URL tuyệt đối: ứng dụng phải dùng đường tương đối hoặc gốc `/` (Vite/CRA mặc định ổn).
 */
import http from "node:http";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { trongDai, type DaiCong } from "./capCong";

export const TEN_COOKIE_PHIEN = "__aipv_phien";
export const TIEN_TO_COOKIE_UNG_DUNG = "__aipv_u_";
export const DUONG_VAO = "/__ai_xem_truoc/vao";
export const HAN_VE_MS = 60_000;
export const HAN_PHIEN_MS = 30 * 60_000;
const TRAN_SO_VE = 1000;
const TRAN_SO_PHIEN = 1000;

interface ChuDe {
  userId: number;
  projectId: string;
  het: number;
}

/** Sổ vé một lần + phiên proxy (RAM — khởi động lại máy chủ ⇒ mở lại xem trước là đủ). */
export class KhoVeXemTruoc {
  private readonly ve = new Map<string, ChuDe>();
  private readonly phien = new Map<string, ChuDe>();
  constructor(private readonly bayGio: () => number = Date.now) {}

  private don(m: Map<string, ChuDe>, tran: number): void {
    const t = this.bayGio();
    for (const [k, v] of m) if (v.het <= t) m.delete(k);
    while (m.size > tran) {
      const dau = m.keys().next().value;
      if (dau === undefined) break;
      m.delete(dau);
    }
  }

  capVe(userId: number, projectId: string): string {
    this.don(this.ve, TRAN_SO_VE);
    const v = randomBytes(32).toString("base64url");
    this.ve.set(v, { userId, projectId, het: this.bayGio() + HAN_VE_MS });
    return v;
  }

  /** Đổi vé — DÙNG MỘT LẦN (xoá trước khi kiểm hạn: vé hết hạn cũng không còn dùng lại được). */
  doiVe(v: unknown): { userId: number; projectId: string } | null {
    if (typeof v !== "string" || v.length < 20 || v.length > 100) return null;
    const c = this.ve.get(v);
    this.ve.delete(v);
    if (!c || c.het <= this.bayGio()) return null;
    return { userId: c.userId, projectId: c.projectId };
  }

  taoPhien(userId: number, projectId: string): string {
    this.don(this.phien, TRAN_SO_PHIEN);
    const id = randomBytes(32).toString("base64url");
    this.phien.set(id, { userId, projectId, het: this.bayGio() + HAN_PHIEN_MS });
    return id;
  }

  docPhien(id: unknown): { userId: number; projectId: string } | null {
    if (typeof id !== "string" || id === "") return null;
    const c = this.phien.get(id);
    if (!c) return null;
    if (c.het <= this.bayGio()) {
      this.phien.delete(id);
      return null;
    }
    return { userId: c.userId, projectId: c.projectId };
  }
}

/** Điều proxy cần biết từ trình quản lý — tiêm được để lưới không cần tiến trình thật. */
export interface NguonUngDungXemTruoc {
  congCuaDuAn(projectId: string): number | null;
  chuSoHuu(projectId: string): number | null;
  cham(projectId: string): void;
}

function tachCookie(h: string | undefined): Array<[string, string]> {
  if (!h) return [];
  const ra: Array<[string, string]> = [];
  for (const phan of h.split(";")) {
    const i = phan.indexOf("=");
    if (i <= 0) continue;
    ra.push([phan.slice(0, i).trim(), phan.slice(i + 1).trim()]);
  }
  return ra;
}

/** ★ Cookie ĐI VÀO ứng dụng xem trước: CHỈ không gian tên `__aipv_u_` (bỏ tiền tố). Mọi cookie khác bị gỡ. */
export function locCookieChoUngDung(h: string | undefined): string | null {
  const ra = tachCookie(h)
    .filter(([k]) => k.startsWith(TIEN_TO_COOKIE_UNG_DUNG) && k.length > TIEN_TO_COOKIE_UNG_DUNG.length)
    .map(([k, v]) => `${k.slice(TIEN_TO_COOKIE_UNG_DUNG.length)}=${v}`);
  return ra.length > 0 ? ra.join("; ") : null;
}

/** ★ Set-Cookie ĐI RA: đổi tên vào không gian `__aipv_u_`, bỏ `Domain`. `__Host-`/`__Secure-` ⇒ bỏ hẳn. */
export function doiSetCookieRa(sc: string[] | string | undefined): string[] {
  const ds = sc === undefined ? [] : Array.isArray(sc) ? sc : [sc];
  const ra: string[] = [];
  for (const s of ds) {
    const phan = s.split(";");
    const dau = phan[0] ?? "";
    const i = dau.indexOf("=");
    if (i <= 0) continue;
    const ten = dau.slice(0, i).trim();
    if (/^__(host|secure)-/i.test(ten)) continue;
    const thuocTinh = phan.slice(1).map((p) => p.trim()).filter((p) => p !== "" && !/^domain\s*=/i.test(p));
    ra.push([`${TIEN_TO_COOKIE_UNG_DUNG}${ten}=${dau.slice(i + 1).trim()}`, ...thuocTinh].join("; "));
  }
  return ra;
}

const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-connection", "te", "trailer", "upgrade", "proxy-authorization", "proxy-authenticate"]);

function headerVao(req: http.IncomingMessage, cong: number, giuNangCap: boolean): http.OutgoingHttpHeaders {
  const ra: http.OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (k === "cookie" || k === "host" || k === "forwarded" || k.startsWith("x-forwarded-")) continue;
    if (!giuNangCap && HOP_BY_HOP.has(k)) continue;
    if (giuNangCap && (k === "proxy-connection" || k === "proxy-authorization")) continue;
    ra[k] = v;
  }
  // `localhost` — máy chủ dev (Vite ≥ 6 `allowedHosts`) chỉ nhận host loopback mặc định.
  ra.host = `localhost:${cong}`;
  const ck = locCookieChoUngDung(req.headers.cookie);
  if (ck) ra.cookie = ck;
  return ra;
}

type KetQuaXacThuc = { ok: true; projectId: string; cong: number } | { ok: false; ma: 401 | 403 | 404; ly: string };

function xacThuc(req: http.IncomingMessage, kho: KhoVeXemTruoc, nguon: NguonUngDungXemTruoc, dai: DaiCong): KetQuaXacThuc {
  const id = tachCookie(req.headers.cookie).find(([k]) => k === TEN_COOKIE_PHIEN)?.[1];
  const p = kho.docPhien(id);
  if (!p) return { ok: false, ma: 401, ly: "PREVIEW_NO_SESSION" };
  const chu = nguon.chuSoHuu(p.projectId);
  const cong = nguon.congCuaDuAn(p.projectId);
  // ⚠ Người khác / không chạy ⇒ CÙNG 404: không tiết lộ dự án nào đang chạy cho ai không phải chủ.
  if (cong === null || chu === null || chu !== p.userId) return { ok: false, ma: 404, ly: "PREVIEW_NOT_RUNNING" };
  if (!trongDai(cong, dai)) return { ok: false, ma: 403, ly: "PREVIEW_PORT_OUT_OF_RANGE" };
  return { ok: true, projectId: p.projectId, cong };
}

/** Đường chuyển hướng sau khi đổi vé: CHỈ đường tuyệt-đối-trong-origin (`/x`), không `//host`, không `/\host`. */
export function duongQuayVe(p: unknown): string {
  if (typeof p !== "string" || !p.startsWith("/") || p.startsWith("//") || p.startsWith("/\\") || p.length > 2000) return "/";
  if (/[\r\n]/.test(p)) return "/";
  return p;
}

function traLoi(res: http.ServerResponse, ma: number, ly: string): void {
  res.writeHead(ma, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-ai-preview": ly });
  res.end(`${ma} ${ly}`);
}

export function taoMayChuXemTruoc(o: { kho: KhoVeXemTruoc; nguon: NguonUngDungXemTruoc; dai: DaiCong }): http.Server {
  const { kho, nguon, dai } = o;
  const may = http.createServer((req, res) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://x");
    } catch {
      traLoi(res, 400, "BAD_URL");
      return;
    }
    if (url.pathname === DUONG_VAO) {
      const c = kho.doiVe(url.searchParams.get("t"));
      if (!c) {
        traLoi(res, 401, "PREVIEW_TICKET_INVALID");
        return;
      }
      const id = kho.taoPhien(c.userId, c.projectId);
      res.writeHead(302, {
        location: duongQuayVe(url.searchParams.get("p")),
        "set-cookie": `${TEN_COOKIE_PHIEN}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(HAN_PHIEN_MS / 1000)}`,
        "cache-control": "no-store",
      });
      res.end();
      return;
    }
    const x = xacThuc(req, kho, nguon, dai);
    if (!x.ok) {
      traLoi(res, x.ma, x.ly);
      return;
    }
    nguon.cham(x.projectId);
    const up = http.request(
      { host: "127.0.0.1", port: x.cong, method: req.method, path: req.url, headers: headerVao(req, x.cong, false) },
      (upRes) => {
        const h: http.OutgoingHttpHeaders = {};
        for (const [k, v] of Object.entries(upRes.headers)) {
          if (v === undefined || HOP_BY_HOP.has(k) || k === "transfer-encoding" || k === "set-cookie") continue;
          h[k] = v;
        }
        const sc = doiSetCookieRa(upRes.headers["set-cookie"]);
        if (sc.length > 0) h["set-cookie"] = sc;
        res.writeHead(upRes.statusCode ?? 502, h);
        upRes.pipe(res);
      },
    );
    up.on("error", () => {
      if (!res.headersSent) traLoi(res, 502, "PREVIEW_UPSTREAM_DOWN");
      else res.destroy();
    });
    req.pipe(up);
  });

  may.on("upgrade", (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
    socket.on("error", () => socket.destroy());
    const x = xacThuc(req, kho, nguon, dai);
    if (!x.ok) {
      socket.end(`HTTP/1.1 ${x.ma} ${x.ly}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    nguon.cham(x.projectId);
    const up = net.connect(x.cong, "127.0.0.1", () => {
      let dau = `${req.method ?? "GET"} ${req.url ?? "/"} HTTP/1.1\r\n`;
      for (const [k, v] of Object.entries(headerVao(req, x.cong, true))) {
        if (v === undefined) continue;
        for (const g of Array.isArray(v) ? v : [v]) dau += `${k}: ${String(g).replace(/[\r\n]/g, "")}\r\n`;
      }
      up.write(dau + "\r\n");
      if (head.length > 0) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    up.on("error", () => socket.destroy());
    socket.on("close", () => up.destroy());
  });
  return may;
}
