import { afterEach, describe, expect, it } from "vitest";
import { datFetchLuong, hostChoPhep, kiemUrl } from "./tichHop";
import { layNut, type NguCanhChay } from "../dangKyNut";
import "./index";

const ngu = (main: { json: Record<string, unknown> }[]): NguCanhChay => ({
  runId: "r", flowId: "f", nodeId: "n", lan: 1, idempotencyKey: "r:n:1", inputs: { main }, nodes: {}, env: {}, run: { id: "r", flowId: "f", batDau: "x" },
});

describe("node HTTP (Đợt 8.1)", () => {
  const giu = process.env.AI_FLOW_HTTP_HOST_CHO_PHEP;
  afterEach(() => {
    if (giu === undefined) delete process.env.AI_FLOW_HTTP_HOST_CHO_PHEP;
    else process.env.AI_FLOW_HTTP_HOST_CHO_PHEP = giu;
  });

  it("danh sách trắng host: rỗng ⇒ từ chối mọi host; giao thức lạ / tài khoản trong URL bị chặn", () => {
    expect(() => kiemUrl("https://a.vn/x", hostChoPhep({}))).toThrow(/không có trong/);
    const ds = hostChoPhep({ AI_FLOW_HTTP_HOST_CHO_PHEP: "erp.noi-bo.local, A.VN" });
    expect(kiemUrl("https://a.vn/x", ds).hostname).toBe("a.vn");
    expect(() => kiemUrl("file:///etc/passwd", ds)).toThrow(/http/);
    expect(() => kiemUrl("https://u:p@a.vn/", ds)).toThrow(/tài khoản/);
    expect(() => kiemUrl("https://a.vn.evil.com/", ds)).toThrow(/không có trong/);
  });

  it("http-gui: gửi Idempotency-Key, không theo chuyển hướng, chặn tiêu đề Authorization; non-2xx ⇒ lỗi", async () => {
    process.env.AI_FLOW_HTTP_HOST_CHO_PHEP = "erp.local";
    const goi: { url: string; init: RequestInit }[] = [];
    const cu = datFetchLuong((async (url: URL, init: RequestInit) => {
      goi.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: 1 }), { status: 201, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch);
    try {
      const ra = (await layNut("tich-hop.http-gui")!.chay({ url: "http://erp.local/phieu/{{ $json.ma }}", than: { ma: "{{ $json.ma }}" } }, ngu([{ json: { ma: "P1" } }]))) as { main: { json: Record<string, unknown> }[] };
      expect(goi[0].url).toBe("http://erp.local/phieu/P1");
      expect(goi[0].init.method).toBe("POST");
      expect(goi[0].init.redirect).toBe("manual");
      expect((goi[0].init.headers as Record<string, string>)["Idempotency-Key"]).toBe("r:n:1");
      expect(goi[0].init.body).toBe('{"ma":"P1"}');
      expect(ra.main[0].json.phanHoi).toEqual({ trangThai: 201, duLieu: { ok: 1 } });
      await expect(layNut("tich-hop.http-gui")!.chay({ url: "http://erp.local/x", tieuDe: { Authorization: "Bearer x" } }, ngu([{ json: {} }]))).rejects.toThrow(/credential/);
      datFetchLuong((async () => new Response("loi", { status: 500 })) as unknown as typeof fetch);
      await expect(layNut("tich-hop.http-doc")!.chay({ url: "http://erp.local/x" }, ngu([{ json: {} }]))).rejects.toThrow(/HTTP 500/);
    } finally {
      datFetchLuong(cu);
    }
  });

  it("khai báo hạng: http-doc là doc/idempotent, http-gui là ngoai-ghi/atMostOnce", () => {
    expect(layNut("tich-hop.http-doc")).toMatchObject({ tacDungPhu: "doc", lapLai: "idempotent" });
    expect(layNut("tich-hop.http-gui")).toMatchObject({ tacDungPhu: "ngoai-ghi", lapLai: "atMostOnce" });
  });
});
