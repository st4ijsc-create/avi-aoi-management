/**
 * ★ Đợt 10.3 (dieu-phoi e — SSRF `llm.ts`) — tải ảnh cho model thị giác: máy chủ HTTP THẬT trong tiến trình + DNS giả. Đích nội bộ chưa
 * khai / metadata / chuyển hướng / quá 20 MB / không phải ảnh ⇒ từ chối và máy chủ đích KHÔNG nhận yêu cầu nào (trừ ca phải đọc mới biết).
 * `invokeLLM`: model thị giác TẮT ⇒ KHÔNG gọi mạng; `annotation.analyzeImage` sau MOD_AI (census).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { datPhanGiaiDns } from "../services/flow/nut/mangAnToan";
import { readAppErrorMeta } from "./appError";
import { hostAnhChoPhep, taiAnhQuaMang } from "./taiAnhAnToan";

const dns: Record<string, string> = {};
let nhan = 0;
let sv: http.Server;
let cong = 0;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

beforeAll(async () => {
  datPhanGiaiDns(async (h) => [{ address: dns[h] ?? "93.184.216.34", family: 4 }]);
  sv = http.createServer((q, r) => {
    nhan++;
    if (q.url === "/chuyen") {
      r.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" });
      r.end();
    } else if (q.url === "/html") {
      r.writeHead(200, { "content-type": "text/html" });
      r.end("<html></html>");
    } else if (q.url === "/to") {
      r.writeHead(200, { "content-type": "image/png" });
      r.end(Buffer.alloc(21 * 1024 * 1024));
    } else {
      r.writeHead(200, { "content-type": "image/png" });
      r.end(PNG);
    }
  });
  await new Promise<void>((ok) => sv.listen(0, "127.0.0.1", ok));
  cong = (sv.address() as AddressInfo).port;
});
afterEach(() => {
  delete process.env.AI_IMAGE_HOST_CHO_PHEP;
  for (const k of Object.keys(dns)) delete dns[k];
  nhan = 0;
});
afterAll(() => {
  datPhanGiaiDns(null);
  sv.close();
});

const lyDo = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return (readAppErrorMeta(e) as { appParams?: { reason?: string } } | null)?.appParams?.reason ?? String(e);
  }
};

describe("taiAnhQuaMang", () => {
  it("đích NỘI BỘ chưa khai ⇒ anh-dich-cam, máy chủ không nhận; khai đúng host:cổng ⇒ tải được; khai sai cổng ⇒ vẫn cấm", async () => {
    dns["cam.local"] = "127.0.0.1";
    expect(await lyDo(taiAnhQuaMang(`http://cam.local:${cong}/a.png`))).toBe("anh-dich-cam");
    process.env.AI_IMAGE_HOST_CHO_PHEP = `cam.local:${cong + 1}`;
    expect(await lyDo(taiAnhQuaMang(`http://cam.local:${cong}/a.png`))).toBe("anh-dich-cam");
    expect(nhan).toBe(0);
    process.env.AI_IMAGE_HOST_CHO_PHEP = `CAM.local:${cong}`;
    expect(await taiAnhQuaMang(`http://cam.local:${cong}/a.png`)).toEqual(PNG);
    expect(nhan).toBe(1);
  });

  it("metadata (host khai nhưng phân giải 169.254.169.254, hay IP thẳng) ⇒ LUÔN cấm", async () => {
    dns["meta.local"] = "169.254.169.254";
    process.env.AI_IMAGE_HOST_CHO_PHEP = "meta.local:80,169.254.169.254:80";
    expect(await lyDo(taiAnhQuaMang("http://meta.local/latest/meta-data"))).toBe("anh-dich-cam");
    expect(await lyDo(taiAnhQuaMang("http://169.254.169.254/latest/meta-data"))).toBe("anh-dich-cam");
  });

  it("scheme lạ / userinfo / URL hỏng ⇒ anh-url-sai", async () => {
    for (const u of ["ftp://x.com/a.png", "file:///etc/passwd", "http://u:p@x.com/a.png", "khong-phai-url"]) expect(await lyDo(taiAnhQuaMang(u)), u).toBe("anh-url-sai");
  });

  it("302 ⇒ anh-chuyen-huong (KHÔNG theo); text/html ⇒ anh-khong-phai-anh; > 20 MB ⇒ anh-qua-lon", async () => {
    dns["cam.local"] = "127.0.0.1";
    process.env.AI_IMAGE_HOST_CHO_PHEP = `cam.local:${cong}`;
    expect(await lyDo(taiAnhQuaMang(`http://cam.local:${cong}/chuyen`))).toBe("anh-chuyen-huong");
    expect(await lyDo(taiAnhQuaMang(`http://cam.local:${cong}/html`))).toBe("anh-khong-phai-anh");
    expect(await lyDo(taiAnhQuaMang(`http://cam.local:${cong}/to`))).toBe("anh-qua-lon");
    expect(nhan).toBe(3); // chuyển hướng không được theo (nếu theo: thêm lượt tới 169.254…)
  });

  it("hostAnhChoPhep: chuẩn hoá chữ thường + dấu chấm cuối, bỏ mục sai dạng", () => {
    expect([...hostAnhChoPhep({ AI_IMAGE_HOST_CHO_PHEP: " Cam.LOCAL.:8080 , x , http://a:1, 10.0.0.5:9000" })]).toEqual(["cam.local:8080", "10.0.0.5:9000"]);
  });
});

describe("invokeLLM — model thị giác TẮT ⇒ không gọi mạng", () => {
  it("image_url http trỏ đích nội bộ đã khai: sidecar tắt ⇒ máy chủ đích KHÔNG nhận yêu cầu", async () => {
    vi.resetModules();
    vi.doMock("../services/llamaVisionSidecar", async (goc) => ({ ...(await goc<typeof import("../services/llamaVisionSidecar")>()), isVisionSidecarAvailable: () => false }));
    vi.doMock("../services/aiProviderRouter", async (goc) => ({
      ...(await goc<typeof import("../services/aiProviderRouter")>()),
      describeImage: vi.fn(async () => ({ text: "Vision unavailable", provider: "gguf", model: "none", totalTimeMs: 0, fallbackUsed: true })),
    }));
    try {
      const { datPhanGiaiDns: dat } = await import("../services/flow/nut/mangAnToan");
      dat(async () => [{ address: "127.0.0.1", family: 4 }]);
      process.env.AI_IMAGE_HOST_CHO_PHEP = `cam.local:${cong}`;
      const { invokeLLM } = await import("./llm");
      const kq = await invokeLLM({ messages: [{ role: "user", content: [{ type: "text", text: "x" }, { type: "image_url", image_url: { url: `http://cam.local:${cong}/a.png` } }] }] });
      expect(String(kq.choices[0]?.message.content)).toContain("Vision unavailable");
      expect(nhan).toBe(0);
    } finally {
      vi.doUnmock("../services/llamaVisionSidecar");
      vi.doUnmock("../services/aiProviderRouter");
      vi.resetModules();
    }
  });
});

describe("invokeLLM — model thị giác BẬT ⇒ ảnh http đi QUA rào (không fetch thô)", () => {
  it("đích nội bộ CHƯA khai ⇒ invokeLLM từ chối anh-dich-cam, máy chủ đích không nhận; đã khai ⇒ ảnh tới describeImage", async () => {
    vi.resetModules();
    const moTa = vi.fn(async (r: { image: Buffer }) => ({ text: `anh ${r.image.length} byte`, provider: "gguf", model: "m", totalTimeMs: 0 }));
    vi.doMock("../services/llamaVisionSidecar", async (goc) => ({ ...(await goc<typeof import("../services/llamaVisionSidecar")>()), isVisionSidecarAvailable: () => true }));
    vi.doMock("../services/aiProviderRouter", async (goc) => ({ ...(await goc<typeof import("../services/aiProviderRouter")>()), describeImage: moTa }));
    try {
      const { datPhanGiaiDns: dat } = await import("../services/flow/nut/mangAnToan");
      dat(async () => [{ address: "127.0.0.1", family: 4 }]);
      const { invokeLLM } = await import("./llm");
      const goi = () => invokeLLM({ messages: [{ role: "user", content: [{ type: "text", text: "x" }, { type: "image_url", image_url: { url: `http://cam.local:${cong}/a.png` } }] }] });
      expect(await lyDo(goi())).toBe("anh-dich-cam");
      expect(nhan).toBe(0);
      process.env.AI_IMAGE_HOST_CHO_PHEP = `cam.local:${cong}`;
      const kq = await goi();
      expect(String(kq.choices[0]?.message.content)).toBe(`anh ${PNG.length} byte`);
      expect(nhan).toBe(1);
    } finally {
      vi.doUnmock("../services/llamaVisionSidecar");
      vi.doUnmock("../services/aiProviderRouter");
      vi.resetModules();
    }
  });
});
