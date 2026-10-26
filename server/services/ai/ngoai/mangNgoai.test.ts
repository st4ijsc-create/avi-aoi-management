/**
 * ★ Đợt 10.3 Task 9 — mạng ra ngoài của nhà cung cấp AI ngoài (DNS giả; máy chủ thật trong tiến trình cho chuyển hướng / proxy / trần
 * / TLS). Không gọi API thật nào.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { datPhanGiaiDns } from "../../flow/nut/mangAnToan";
import { datFetchNgoaiChoTest, taoMangNgoai } from "./mangNgoai";
import { LoiNgoai } from "./loi";
import { kiemTenModelDuongDan } from "./nhaCungCap/gemini";

const dns: Record<string, string> = {};
datPhanGiaiDns(async (host) => [{ address: dns[host] ?? "93.184.216.34", family: 4 }]);
afterAll(() => {
  datPhanGiaiDns(null);
  datFetchNgoaiChoTest(null);
});
afterEach(() => {
  datFetchNgoaiChoTest(null);
  for (const k of Object.keys(dns)) delete dns[k];
  delete process.env.HTTPS_PROXY;
  delete process.env.HTTP_PROXY;
});

const INIT = { method: "POST" as const, headers: { "content-type": "application/json" }, body: "{}" };
const loi = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof LoiNgoai ? `${e.ma}${e.chuaGui ? "/chua-gui" : ""}` : String(e);
  }
};

describe("chính sách URL + DNS (mỗi lần gọi)", () => {
  it("công cộng phải https; userinfo / ftp / file ⇒ từ chối; metadata / link-local LUÔN cấm kể cả đã khai", async () => {
    const mang = taoMangNgoai({ hostNoiBo: new Set(["169.254.169.254:443", "[fe80::1]:443"]) });
    for (const u of ["http://api.openai.com/v1/x", "https://user:p@x.com/v1", "ftp://x.com/a", "file:///etc/passwd", "https://169.254.169.254/latest", "https://[fe80::1]/v1"]) {
      expect(await loi(mang.goiJson(u, INIT)), u).toBe("NGOAI_URL_KHONG_HOP_LE/chua-gui");
    }
  });

  it("chuẩn hoá host (hoa + dấu chấm cuối); host phân giải ra địa chỉ nội bộ chưa khai ⇒ từ chối; nội bộ đã khai ⇒ cho", async () => {
    const nhan: string[] = [];
    datFetchNgoaiChoTest(async (url) => (nhan.push(url), { status: 200, json: {} }));
    const mang = taoMangNgoai({ hostNoiBo: new Set(["llm.local:8000"]) });
    await mang.goiJson("https://API.OpenAI.COM./v1/chat/completions", INIT);
    expect(nhan[0]).toBe("https://api.openai.com/v1/chat/completions");
    dns["tram-xau.example"] = "10.0.0.5";
    expect(await loi(mang.goiJson("https://tram-xau.example/v1", INIT))).toBe("NGOAI_URL_KHONG_HOP_LE/chua-gui");
    dns["llm.local"] = "10.0.0.6";
    await mang.goiJson("http://llm.local:8000/v1/chat/completions", INIT);
    expect(nhan[1]).toBe("http://llm.local:8000/v1/chat/completions");
  });

  it("endpoint đổi DNS giữa hai lần gọi (công cộng → 10.0.0.9 chưa khai) ⇒ lần 2 bị chặn", async () => {
    datFetchNgoaiChoTest(async () => ({ status: 200, json: {} }));
    const mang = taoMangNgoai({ hostNoiBo: new Set() });
    dns["llm.nha-may.vn"] = "8.8.4.4";
    expect(await loi(mang.goiJson("https://llm.nha-may.vn/v1", INIT))).toBeNull();
    dns["llm.nha-may.vn"] = "10.0.0.9";
    expect(await loi(mang.goiJson("https://llm.nha-may.vn/v1", INIT))).toBe("NGOAI_URL_KHONG_HOP_LE/chua-gui");
  });

  it("tên model trong đường dẫn Gemini", () => {
    for (const m of ["../v1/x", "a?b", "a#b", "a%2fb", "a/b", ""]) expect(() => kiemTenModelDuongDan(m), m).toThrow(LoiNgoai);
    expect(kiemTenModelDuongDan("gemini-2.5-pro")).toBe("gemini-2.5-pro");
  });

  it("không tệp nào của cổng ngoài tắt kiểm chứng chỉ TLS", () => {
    const thuMuc = path.resolve(__dirname);
    const tep = [thuMuc, path.join(thuMuc, "nhaCungCap")].flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => path.join(d, f)));
    expect(tep.length).toBeGreaterThan(8);
    const cam = ["reject" + "Unauthorized", "NODE_TLS_" + "REJECT_UNAUTHORIZED"];
    for (const t of tep) for (const c of cam) expect(fs.readFileSync(t, "utf8"), `${t} chứa ${c}`).not.toContain(c);
  });
});

describe("máy chủ thật trong tiến trình (localhost đã khai)", () => {
  const moMayChu = async (xu: http.RequestListener) => {
    const s = http.createServer(xu);
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    return { s, cong: (s.address() as AddressInfo).port };
  };
  dns.localhost = "127.0.0.1";

  it("302 ⇒ lỗi (không theo); HTTPS_PROXY trong env bị BỎ QUA (vẫn tới máy chủ); thân 5 MB ⇒ lỗi trần", async () => {
    let soYeuCau = 0;
    const { s, cong } = await moMayChu((req, res) => {
      soYeuCau++;
      if (req.url?.startsWith("/chuyen")) {
        res.writeHead(302, { location: "http://169.254.169.254/" });
        res.end();
      } else if (req.url?.startsWith("/to")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("x".repeat(5 * 1024 * 1024));
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":true}');
      }
    });
    try {
      dns.localhost = "127.0.0.1";
      process.env.HTTPS_PROXY = "http://127.0.0.1:9";
      process.env.HTTP_PROXY = "http://127.0.0.1:9";
      const mang = taoMangNgoai({ hostNoiBo: new Set([`localhost:${cong}`]) });
      expect(await mang.goiJson(`http://localhost:${cong}/ok`, INIT)).toEqual({ status: 200, json: { ok: true } });
      expect(await loi(mang.goiJson(`http://localhost:${cong}/chuyen`, INIT))).toBe("NGOAI_NHA_CUNG_CAP_LOI");
      expect(await loi(mang.goiJson(`http://localhost:${cong}/to`, INIT))).toBe("NGOAI_NHA_CUNG_CAP_LOI");
      expect(soYeuCau).toBe(3);
    } finally {
      s.close();
    }
  });

  let coOpenssl = true;
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
  } catch {
    coOpenssl = false;
  }
  it.skipIf(!coOpenssl)("TLS: tự ký / hết hạn / sai tên ⇒ từ chối, CHƯA GỬI (không bao giờ tắt kiểm chứng chỉ)", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "tls-ngoai-"));
    // cấu hình openssl tối thiểu riêng (OPENSSL_CONF của máy có thể trỏ tệp không tồn tại)
    fs.writeFileSync(path.join(d, "o.cnf"), "[req]\ndistinguished_name=dn\n[dn]\n");
    const env = { ...process.env, OPENSSL_CONF: path.join(d, "o.cnf") };
    const tao = (ten: string, cn: string, them: string[]) => {
      execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(d, `${ten}.key`), "-out", path.join(d, `${ten}.crt`), "-subj", `/CN=${cn}`, "-addext", `subjectAltName=DNS:${cn}`, ...them], { stdio: "ignore", env });
      return { key: fs.readFileSync(path.join(d, `${ten}.key`)), cert: fs.readFileSync(path.join(d, `${ten}.crt`)) };
    };
    const bo = [
      tao("tu-ky", "localhost", ["-days", "1"]),
      tao("het-han", "localhost", ["-not_before", "20200101000000Z", "-not_after", "20200102000000Z"]),
      tao("sai-ten", "khac.local", ["-days", "1"]),
    ];
    try {
      for (const tls of bo) {
        let toi = 0;
        const s = https.createServer(tls, (_q, r) => {
          toi++;
          r.end("{}");
        });
        await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
        const cong = (s.address() as AddressInfo).port;
        try {
          dns.localhost = "127.0.0.1";
          const mang = taoMangNgoai({ hostNoiBo: new Set([`localhost:${cong}`]) });
          expect(await loi(mang.goiJson(`https://localhost:${cong}/v1`, INIT))).toBe("NGOAI_NHA_CUNG_CAP_LOI/chua-gui");
          expect(toi).toBe(0);
        } finally {
          s.close();
        }
      }
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
});
