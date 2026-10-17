/**
 * ★★★ Đợt 3c (2026-10-17) — PROXY XEM TRƯỚC trên CỔNG RIÊNG (origin tách khỏi ứng dụng chính).
 *
 * Đo trên socket THẬT (máy chủ ngược dòng giả ghi lại mọi thứ nó nhận):
 *   §1 không phiên ⇒ 401, ngược dòng nhận 0 yêu cầu · vé một lần · vé hết hạn.
 *   §2 cookie phiên ỨNG DỤNG CHÍNH (`app_session_id`) KHÔNG BAO GIỜ tới ứng dụng xem trước; cookie của chính ứng
 *      dụng xem trước đi qua KHÔNG GIAN TÊN riêng (`__aipv_u_`), kể cả chiều Set-Cookie đi ra.
 *   §3 người khác / dự án không chạy ⇒ 404 · cổng ngoài dải ⇒ 403 — ngược dòng nhận 0 yêu cầu.
 *   §4 WebSocket (HMR) qua `upgrade`: không phiên ⇒ 401; có phiên ⇒ 101 và vẫn không mang cookie ứng dụng.
 *   §5 chuyển hướng sau khi đổi vé chỉ về đường TƯƠNG ĐỐI cùng origin (không open-redirect).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import {
  DUONG_VAO,
  KhoVeXemTruoc,
  TEN_COOKIE_PHIEN,
  doiSetCookieRa,
  locCookieChoUngDung,
  taoMayChuXemTruoc,
  type NguonUngDungXemTruoc,
} from "./proxyXemTruoc";

interface Nhan {
  url: string;
  cookie: string | undefined;
  host: string | undefined;
}
const nhan: Nhan[] = [];
const nhanWs: Nhan[] = [];
let nguocDong: http.Server;
let congNguoc = 0;
let proxy: http.Server;
let congProxy = 0;
let gio = 1_000_000;
const socketMo = new Set<net.Socket>();
const kho = new KhoVeXemTruoc(() => gio);
const chay = new Map<string, { cong: number; chuSoHuu: number }>();
const daCham: string[] = [];
const nguon: NguonUngDungXemTruoc = {
  congCuaDuAn: (id) => chay.get(id)?.cong ?? null,
  chuSoHuu: (id) => chay.get(id)?.chuSoHuu ?? null,
  cham: (id) => daCham.push(id),
};

function goi(duong: string, cookie?: string, method = "GET"): Promise<{ ma: number; headers: http.IncomingHttpHeaders; than: string }> {
  return new Promise((giai, tuChoi) => {
    const r = http.request({ host: "127.0.0.1", port: congProxy, path: duong, method, headers: cookie ? { cookie } : {} }, (res) => {
      let than = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (than += c));
      res.on("end", () => giai({ ma: res.statusCode ?? 0, headers: res.headers, than }));
    });
    r.on("error", tuChoi);
    r.end();
  });
}

async function vaoPhien(userId: number, projectId: string): Promise<string> {
  const ve = kho.capVe(userId, projectId);
  const r = await goi(`${DUONG_VAO}?t=${encodeURIComponent(ve)}`);
  expect(r.ma).toBe(302);
  const sc = ([] as string[]).concat(r.headers["set-cookie"] ?? []);
  const c = sc.find((s) => s.startsWith(`${TEN_COOKIE_PHIEN}=`));
  expect(c, "phải cấp cookie phiên xem trước").toBeTruthy();
  return c!.split(";")[0]!;
}

beforeAll(async () => {
  nguocDong = http.createServer((req, res) => {
    nhan.push({ url: req.url ?? "", cookie: req.headers.cookie, host: req.headers.host });
    res.setHeader("Set-Cookie", ["sid=abc; Path=/; Domain=localhost; HttpOnly", "app_session_id=GHIDE; Path=/"]);
    res.end(`OK ${req.url}`);
  });
  nguocDong.on("upgrade", (req, socket) => {
    nhanWs.push({ url: req.url ?? "", cookie: req.headers.cookie, host: req.headers.host });
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    socket.on("data", (d) => socket.write(d));
  });
  // Socket đã nâng cấp (WS) rời khỏi sổ của `http.Server` ⇒ tự theo dõi để đóng hẳn lúc dọn.
  for (const m of [nguocDong]) m.on("connection", (so) => socketMo.add(so));
  await new Promise<void>((g) => nguocDong.listen(0, "127.0.0.1", () => g()));
  congNguoc = (nguocDong.address() as AddressInfo).port;
  proxy = taoMayChuXemTruoc({ kho, nguon, dai: { tu: congNguoc, den: congNguoc } });
  proxy.on("connection", (so) => socketMo.add(so));
  await new Promise<void>((g) => proxy.listen(0, "127.0.0.1", () => g()));
  congProxy = (proxy.address() as AddressInfo).port;
});

afterAll(async () => {
  // Agent mặc định của Node ≥ 19 giữ kết nối keep-alive ⇒ đóng hẳn để `close` không chờ vô hạn.
  proxy.closeAllConnections();
  nguocDong.closeAllConnections();
  for (const so of socketMo) so.destroy();
  await new Promise<void>((g) => proxy.close(() => g()));
  await new Promise<void>((g) => nguocDong.close(() => g()));
});

beforeEach(() => {
  nhan.length = 0;
  nhanWs.length = 0;
  daCham.length = 0;
  chay.clear();
  chay.set("du-an-a", { cong: congNguoc, chuSoHuu: 7 });
});

describe("§1 — không phiên ⇒ 401; vé dùng MỘT lần, có hạn", () => {
  it("★★★ không cookie ⇒ 401, ngược dòng nhận 0 yêu cầu", async () => {
    const r = await goi("/");
    expect(r.ma).toBe(401);
    expect(nhan.length).toBe(0);
  });

  it("★★★ cookie phiên ỨNG DỤNG CHÍNH không phải chìa khoá của proxy ⇒ vẫn 401", async () => {
    const r = await goi("/", "app_session_id=PHIEN-THAT-CUA-APP");
    expect(r.ma).toBe(401);
    expect(nhan.length).toBe(0);
  });

  it("★★★ vé hợp lệ ⇒ 302 + cookie RIÊNG HttpOnly SameSite=Lax; dùng lại vé ⇒ 401", async () => {
    const ve = kho.capVe(7, "du-an-a");
    const r1 = await goi(`${DUONG_VAO}?t=${ve}`);
    expect(r1.ma).toBe(302);
    const sc = ([] as string[]).concat(r1.headers["set-cookie"] ?? []).join("\n");
    expect(sc).toContain(`${TEN_COOKIE_PHIEN}=`);
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=Lax/i);
    const r2 = await goi(`${DUONG_VAO}?t=${ve}`);
    expect(r2.ma).toBe(401);
  });

  it("★★ vé quá 60 s ⇒ 401", async () => {
    const ve = kho.capVe(7, "du-an-a");
    gio += 61_000;
    expect((await goi(`${DUONG_VAO}?t=${ve}`)).ma).toBe(401);
  });

  it("★★ vé rác ⇒ 401", async () => {
    expect((await goi(`${DUONG_VAO}?t=khong-phai-ve`)).ma).toBe(401);
  });
});

describe("§2 — cookie phiên ứng dụng KHÔNG đi tới ứng dụng xem trước", () => {
  it("★★★ chỉ cookie không-gian-tên `__aipv_u_` đi qua (bỏ tiền tố); app_session_id + cookie phiên proxy BỊ GỠ", async () => {
    const phien = await vaoPhien(7, "du-an-a");
    const r = await goi("/trang?x=1", `app_session_id=BI-MAT-APP; ${phien}; __aipv_u_theme=dark; other=1`);
    expect(r.ma).toBe(200);
    expect(r.than).toBe("OK /trang?x=1");
    expect(nhan.length).toBe(1);
    expect(nhan[0]!.cookie ?? "").toBe("theme=dark");
    expect(nhan[0]!.cookie ?? "").not.toContain("BI-MAT-APP");
    expect(nhan[0]!.cookie ?? "").not.toContain(TEN_COOKIE_PHIEN);
    expect(nhan[0]!.host).toBe(`localhost:${congNguoc}`);
    expect(daCham).toContain("du-an-a");
  });

  it("★★★ Set-Cookie ĐI RA bị đặt vào không gian tên — ứng dụng xem trước KHÔNG ghi đè được app_session_id", async () => {
    const phien = await vaoPhien(7, "du-an-a");
    const r = await goi("/", phien);
    const sc = ([] as string[]).concat(r.headers["set-cookie"] ?? []);
    expect(sc.some((s) => s.startsWith("__aipv_u_sid=abc"))).toBe(true);
    expect(sc.some((s) => /^app_session_id=/i.test(s)), "không cookie nào mang tên ứng dụng chính rời proxy").toBe(false);
    expect(sc.join("\n")).not.toMatch(/Domain=/i);
  });

  it("★ hàm thuần: lọc vào / đổi ra", () => {
    expect(locCookieChoUngDung(`app_session_id=x; ${TEN_COOKIE_PHIEN}=y; __aipv_u_a=1; __aipv_u_b=2`)).toBe("a=1; b=2");
    expect(locCookieChoUngDung("app_session_id=x")).toBeNull();
    expect(doiSetCookieRa(["a=1; Path=/; Domain=.x.com; Secure"])).toEqual(["__aipv_u_a=1; Path=/; Secure"]);
    expect(doiSetCookieRa(["__Host-a=1; Path=/"])).toEqual([], "tiền tố __Host-/__Secure- không đổi tên được ⇒ bỏ");
  });
});

describe("§3 — chủ sở hữu, trạng thái chạy, dải cổng", () => {
  it("★★★ phiên của NGƯỜI KHÁC (không phải người chạy ứng dụng) ⇒ 404, ngược dòng nhận 0", async () => {
    const phien = await vaoPhien(8, "du-an-a");
    expect((await goi("/", phien)).ma).toBe(404);
    expect(nhan.length).toBe(0);
  });

  it("★★ dự án KHÔNG chạy ⇒ 404", async () => {
    const phien = await vaoPhien(7, "du-an-a");
    chay.delete("du-an-a");
    expect((await goi("/", phien)).ma).toBe(404);
    expect(nhan.length).toBe(0);
  });

  it("★★★ cổng NGOÀI dải đã cấp (vd 5434 CSDL) ⇒ 403, không kết nối đi đâu", async () => {
    const phien = await vaoPhien(7, "du-an-a");
    chay.set("du-an-a", { cong: 5434, chuSoHuu: 7 });
    const r = await goi("/", phien);
    expect(r.ma).toBe(403);
    expect(nhan.length).toBe(0);
  });
});

describe("§4 — WebSocket (HMR) qua upgrade", () => {
  function nangCap(cookie?: string): Promise<string> {
    return new Promise((giai, tuChoi) => {
      const s = net.connect(congProxy, "127.0.0.1", () => {
        s.write(
          "GET /@vite/client-ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n" +
            (cookie ? `Cookie: ${cookie}\r\n` : "") +
            "\r\n",
        );
      });
      let buf = "";
      s.on("data", (d) => {
        buf += d.toString("utf8");
        if (buf.includes("\r\n\r\n")) {
          s.destroy();
          giai(buf);
        }
      });
      s.on("error", tuChoi);
      s.on("close", () => giai(buf));
    });
  }

  it("★★★ không phiên ⇒ 401, ngược dòng không thấy upgrade nào", async () => {
    const r = await nangCap("app_session_id=x");
    expect(r).toMatch(/^HTTP\/1\.1 401/);
    expect(nhanWs.length).toBe(0);
  });

  it("★★★ có phiên ⇒ 101 từ ngược dòng, cookie ứng dụng bị gỡ", async () => {
    const phien = await vaoPhien(7, "du-an-a");
    const r = await nangCap(`app_session_id=BI-MAT; ${phien}`);
    expect(r).toMatch(/^HTTP\/1\.1 101/);
    expect(nhanWs.length).toBe(1);
    expect(nhanWs[0]!.cookie ?? "").not.toContain("BI-MAT");
    expect(nhanWs[0]!.cookie ?? "").not.toContain(TEN_COOKIE_PHIEN);
  });
});

describe("§5 — không open-redirect sau khi đổi vé", () => {
  it.each([
    ["/trang/con", "/trang/con"],
    ["//evil.example/x", "/"],
    ["https://evil.example/", "/"],
    ["/\\evil.example", "/"],
  ])("★★ p=%s ⇒ Location %s", async (p, mong) => {
    const ve = kho.capVe(7, "du-an-a");
    const r = await goi(`${DUONG_VAO}?t=${ve}&p=${encodeURIComponent(p)}`);
    expect(r.ma).toBe(302);
    expect(r.headers.location).toBe(mong);
  });
});
