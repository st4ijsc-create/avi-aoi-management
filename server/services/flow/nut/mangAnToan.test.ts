/**
 * ★★★ Đợt 9 (M3 của kiem-dinh) — SSRF / DNS rebinding / thân phản hồi vô hạn của node HTTP (không CSDL, máy chủ HTTP thật ở 127.0.0.1):
 *   • địa chỉ không công cộng bị chặn (loopback · link-local/metadata · private · CGNAT · ULA · v4-mapped · 6to4 …), trừ mục `host:cổng` rõ ràng;
 *   • phân giải DNS ĐÚNG MỘT LẦN, kết nối tới IP đã kiểm (bộ phân giải đổi đáp án lần hai cũng vô ích);
 *   • kết nối ghim thật sự đi tới IP đã kiểm (host giả không phân giải được bằng DNS hệ thống vẫn nối được);
 *   • không theo chuyển hướng; thân đọc dạng luồng và ngắt ở trần kể cả không có Content-Length.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { layNut, type NguCanhChay } from "../dangKyNut";
import "./index";
import { LoiHttpLuong, datPhanGiaiDns, docThanCoTran, fetchGhim, kiemDichDen, laDiaChiNoiBo } from "./mangAnToan";
import { IP_CONG_KHAI_GIA, datFetchLuong, hostChoPhep, kiemUrl } from "./tichHop";

const ngu = (main: { json: Record<string, unknown> }[]): NguCanhChay => ({
  runId: "r", flowId: "f", nodeId: "n", lan: 1, idempotencyKey: "r:n:1", inputs: { main }, nodes: {}, env: {}, run: { id: "r", flowId: "f", batDau: "x" },
});
const ds = (...a: string[]) => new Set(a);

describe("laDiaChiNoiBo", () => {
  it("IPv4/IPv6 không công cộng ⇒ true; công cộng ⇒ false; không phân tích được ⇒ true (đóng)", () => {
    const noiBo = [
      "127.0.0.1", "127.255.255.254", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "169.254.0.1", "100.64.0.1", "0.0.0.0", "224.0.0.1",
      "255.255.255.255", "192.0.2.5", "198.18.0.1",
      "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:a9fe:a9fe", "2002:7f00:0001::1", "2002:0a00:0001::1",
      "2001:db8::1", "64:ff9b::7f00:1", "100::1", "khong-phai-ip", "", "999.1.1.1",
    ];
    for (const ip of noiBo) expect(laDiaChiNoiBo(ip), ip).toBe(true);
    const congKhai = ["8.8.8.8", "93.184.216.34", "172.32.0.1", "172.15.255.255", "100.63.255.255", "100.128.0.1", "11.0.0.1", "1.1.1.1", "2606:4700:4700::1111", "2a00:1450:4001:80b::200e", "::ffff:8.8.8.8", "2002:0808:0808::1"];
    for (const ip of congKhai) expect(laDiaChiNoiBo(ip), ip).toBe(false);
  });
});

describe("kiemDichDen", () => {
  const cu = datPhanGiaiDns(null);
  afterEach(() => void datPhanGiaiDns(null));
  afterAll(() => void datPhanGiaiDns(cu));
  const giai = (m: Record<string, string[]>, dem?: { n: number }) =>
    datPhanGiaiDns(async (h) => {
      if (dem) dem.n++;
      if (!m[h]) throw new Error("ENOTFOUND");
      return m[h].map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    });
  const u = (s: string) => new URL(s);

  it("host phân giải ra địa chỉ CÔNG CỘNG ⇒ qua, trả IP để ghim", async () => {
    giai({ "erp.nha-may.vn": ["93.184.216.34"] });
    expect(await kiemDichDen(u("https://erp.nha-may.vn/x"), ds("erp.nha-may.vn"))).toEqual({ ip: "93.184.216.34", family: 4 });
  });

  it("★ host trỏ vào loopback / private / link-local-metadata / ULA / v4-mapped ⇒ TỪ CHỐI (dù có trong danh sách trắng theo host)", async () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.7", "169.254.169.254", "::1", "fd00::5", "::ffff:127.0.0.1"]) {
      giai({ "noi-bo.nha-may.vn": [ip] });
      await expect(kiemDichDen(u("https://noi-bo.nha-may.vn/x"), ds("noi-bo.nha-may.vn")), ip).rejects.toThrow(/nội bộ/);
    }
  });

  it("★ chống rebinding kiểu trả HAI địa chỉ: một công cộng + một nội bộ ⇒ từ chối", async () => {
    giai({ "a.vn": ["93.184.216.34", "169.254.169.254"] });
    await expect(kiemDichDen(u("https://a.vn/"), ds("a.vn"))).rejects.toThrow(/nội bộ/);
    giai({ "a.vn": ["169.254.169.254", "93.184.216.34"] });
    await expect(kiemDichDen(u("https://a.vn/"), ds("a.vn"))).rejects.toThrow(/nội bộ/);
  });

  it("IP literal: nội bộ bị chặn trừ mục host:cổng; công cộng qua", async () => {
    giai({});
    await expect(kiemDichDen(u("http://169.254.169.254/latest/meta-data"), ds("169.254.169.254"))).rejects.toThrow(/nội bộ/);
    await expect(kiemDichDen(u("http://127.0.0.1:8080/"), ds("127.0.0.1"))).rejects.toThrow(/nội bộ/);
    expect((await kiemDichDen(u("http://127.0.0.1:8080/"), ds("127.0.0.1:8080"))).ip).toBe("127.0.0.1");
    await expect(kiemDichDen(u("http://127.0.0.1:9090/"), ds("127.0.0.1:8080"))).rejects.toThrow(/nội bộ/); // sai cổng
    expect((await kiemDichDen(u("http://8.8.8.8/"), ds("8.8.8.8"))).ip).toBe("8.8.8.8");
  });

  it("mục host:cổng RÕ RÀNG mới cho phép đích nội bộ — đúng host VÀ đúng cổng (mặc định http 80 / https 443)", async () => {
    giai({ "mes.local": ["10.20.30.40"] });
    expect((await kiemDichDen(u("https://mes.local/x"), ds("mes.local:443"))).ip).toBe("10.20.30.40");
    expect((await kiemDichDen(u("http://mes.local/x"), ds("mes.local:80"))).ip).toBe("10.20.30.40");
    await expect(kiemDichDen(u("https://mes.local/x"), ds("mes.local:8443"))).rejects.toThrow(/nội bộ/);
    await expect(kiemDichDen(u("https://mes.local/x"), ds("mes.local"))).rejects.toThrow(/nội bộ/);
    await expect(kiemDichDen(u("https://khac.local/x"), ds("mes.local:443"))).rejects.toThrow(); // host khác: không phân giải được
  });

  it("★ phân giải ĐÚNG MỘT LẦN; không phân giải được ⇒ lỗi rõ", async () => {
    const dem = { n: 0 };
    giai({ "a.vn": ["93.184.216.34"] }, dem);
    await kiemDichDen(u("https://a.vn/"), ds("a.vn"));
    expect(dem.n).toBe(1);
    await expect(kiemDichDen(u("https://khong-co.vn/"), ds("khong-co.vn"))).rejects.toThrow(/không phân giải được/);
  });

  it("kiemUrl nhận mục host:cổng nhưng KHÔNG nhận cổng khác; hậu tố / tiền tố vẫn bị chặn", () => {
    const d = hostChoPhep({ AI_FLOW_HTTP_HOST_CHO_PHEP: "mes.local:8443, A.vn" });
    expect(kiemUrl("https://mes.local:8443/x", d).hostname).toBe("mes.local");
    expect(() => kiemUrl("https://mes.local/x", d)).toThrow(/không có trong/);
    expect(() => kiemUrl("https://mes.local:9000/x", d)).toThrow(/không có trong/);
    expect(kiemUrl("https://a.vn:4443/x", d).hostname).toBe("a.vn"); // mục `host` trơn: mọi cổng, chỉ đích công cộng
    expect(() => kiemUrl("https://sub.a.vn/x", d)).toThrow(/không có trong/);
  });
});

describe("kết nối GHIM + không theo chuyển hướng + thân có trần (máy chủ HTTP thật)", () => {
  let may: http.Server;
  let cong = 0;
  let daGhi = 0;
  let host = "";
  const ketNoi: string[] = [];

  beforeAll(async () => {
    may = http.createServer((req, res) => {
      ketNoi.push(`${req.method} ${req.url} host=${req.headers.host}`);
      if (req.url === "/chuyen-huong") {
        res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data" });
        res.end();
      } else if (req.url === "/vo-han") {
        res.writeHead(200, { "content-type": "text/plain" }); // KHÔNG Content-Length ⇒ chunked
        const chunk = Buffer.alloc(64 * 1024, 97);
        const ghi = () => {
          while (daGhi < 200 * 1024 * 1024 && !res.destroyed) {
            daGhi += chunk.length;
            if (!res.write(chunk)) {
              res.once("drain", ghi);
              return;
            }
          }
        };
        ghi();
      } else if (req.url === "/to") {
        res.writeHead(200, { "content-length": String(5 * 1024 * 1024) });
        res.write(Buffer.alloc(1024, 98));
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: 1, host: req.headers.host }));
      }
    });
    await new Promise<void>((ok) => may.listen(0, "127.0.0.1", ok));
    cong = (may.address() as AddressInfo).port;
    host = `ghim.test`;
  });
  afterAll(() => {
    datPhanGiaiDns(null);
    may.closeAllConnections();
    may.close();
  });

  const choPhep = () => ds(`${host}:${cong}`);
  const dich = async (duongDan = "/") => {
    datPhanGiaiDns(async () => [{ address: "127.0.0.1", family: 4 }]); // 'ghim.test' KHÔNG tồn tại trong DNS hệ thống
    const url = new URL(`http://${host}:${cong}${duongDan}`);
    return { url, d: await kiemDichDen(url, choPhep()) };
  };

  it("★ nối tới IP đã kiểm dù DNS hệ thống KHÔNG biết host (chứng minh lookup bị ghim); Host header theo hostname", async () => {
    const { url, d } = await dich("/x");
    expect(d).toEqual({ ip: "127.0.0.1", family: 4 });
    const r = await fetchGhim(url, { method: "GET", redirect: "manual" }, d);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: 1, host: `${host}:${cong}` });
  });

  it("★ bộ phân giải đổi đáp án SAU lần kiểm cũng vô ích: kết nối vẫn tới IP đã ghim", async () => {
    const { url, d } = await dich("/x");
    datPhanGiaiDns(async () => [{ address: "169.254.169.254", family: 4 }]); // rebinding: đáp án lần hai là metadata
    const r = await fetchGhim(url, { method: "GET" }, d);
    expect(r.status).toBe(200);
  });

  it("không theo chuyển hướng: 3xx trả nguyên (không đi sang host khác)", async () => {
    const { url, d } = await dich("/chuyen-huong");
    const dau = ketNoi.length;
    const r = await fetchGhim(url, { method: "GET", redirect: "manual" }, d);
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toContain("169.254.169.254");
    expect(ketNoi.length).toBe(dau + 1); // đúng MỘT yêu cầu tới máy chủ của ta, không có yêu cầu thứ hai
  });

  it("★ thân vô hạn KHÔNG Content-Length: đọc dạng luồng, ngắt ở trần 1 MB, máy chủ bị ngắt (không đọc cả 200 MB)", async () => {
    const { url, d } = await dich("/vo-han");
    daGhi = 0;
    const r = await fetchGhim(url, { method: "GET" }, d);
    await expect(docThanCoTran(r, 1024 * 1024)).rejects.toThrow(/quá 1048576 byte/);
    await new Promise((ok) => setTimeout(ok, 100));
    expect(daGhi, `máy chủ đã ghi ${daGhi} byte — phải dừng sớm`).toBeLessThan(40 * 1024 * 1024);
  });

  it("Content-Length khai quá trần ⇒ từ chối NGAY, không đọc thân", async () => {
    const { url, d } = await dich("/to");
    const r = await fetchGhim(url, { method: "GET" }, d);
    await expect(docThanCoTran(r, 1024 * 1024)).rejects.toThrow(LoiHttpLuong);
  });

  it("thân nhỏ đọc đủ; Response giả (lưới) cũng đi qua docThanCoTran", async () => {
    expect(await docThanCoTran(new Response("xin chào"), 1024)).toBe("xin chào");
    expect(await docThanCoTran(new Response(null, { status: 204 }), 1024)).toBe("");
    await expect(docThanCoTran(new Response("x".repeat(2000)), 1024)).rejects.toThrow(/quá 1024 byte/);
  });
});

describe("node HTTP đi qua mạng an toàn", () => {
  const giu = process.env.AI_FLOW_HTTP_HOST_CHO_PHEP;
  afterEach(() => {
    if (giu === undefined) delete process.env.AI_FLOW_HTTP_HOST_CHO_PHEP;
    else process.env.AI_FLOW_HTTP_HOST_CHO_PHEP = giu;
    datPhanGiaiDns(null);
  });

  it("host phân giải vào nội bộ ⇒ node ném, HÀM GỬI KHÔNG ĐƯỢC GỌI; mục host:cổng ⇒ gọi với IP đã kiểm; công cộng ⇒ gọi với IP giả", async () => {
    const goi: { url: string; ip?: string }[] = [];
    const cu = datFetchLuong((async (url: URL, _i: RequestInit, d?: { ip: string }) => {
      goi.push({ url: String(url), ip: d?.ip });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as never);
    try {
      process.env.AI_FLOW_HTTP_HOST_CHO_PHEP = "erp.local";
      await layNut("tich-hop.http-doc")!.chay({ url: "http://erp.local/x" }, ngu([{ json: {} }])); // bộ phân giải GIẢ ⇒ công cộng
      expect(goi).toEqual([{ url: "http://erp.local/x", ip: IP_CONG_KHAI_GIA }]);
      goi.length = 0;

      datPhanGiaiDns(async () => [{ address: "169.254.169.254", family: 4 }]);
      await expect(layNut("tich-hop.http-doc")!.chay({ url: "http://erp.local/x" }, ngu([{ json: {} }]))).rejects.toThrow(/nội bộ/);
      expect(goi).toHaveLength(0);

      process.env.AI_FLOW_HTTP_HOST_CHO_PHEP = "erp.local:80";
      await layNut("tich-hop.http-doc")!.chay({ url: "http://erp.local/x" }, ngu([{ json: {} }]));
      expect(goi).toEqual([{ url: "http://erp.local/x", ip: "169.254.169.254" }]);
    } finally {
      datFetchLuong(cu);
    }
  });

  it("phản hồi giả vượt trần ⇒ node ném 'quá … byte'", async () => {
    const cu = datFetchLuong((async () => new Response("y".repeat(1024 * 1024 + 10), { status: 200 })) as never);
    try {
      process.env.AI_FLOW_HTTP_HOST_CHO_PHEP = "erp.local";
      await expect(layNut("tich-hop.http-doc")!.chay({ url: "http://erp.local/x" }, ngu([{ json: {} }]))).rejects.toThrow(/quá 1048576 byte/);
    } finally {
      datFetchLuong(cu);
    }
  });
});
