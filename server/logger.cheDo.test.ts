/**
 * ★★★ Chẩn đoán 2026-10-23 — logger dev KHÔNG ĐƯỢC dựng worker_thread (transport `pino-pretty` ⇒ thread-stream Worker ⇒ heap corruption lúc boot dev;
 * đo: dev+worker chết 12/30 dưới bộ khuếch đại, dev+pino-pretty ĐỒNG BỘ 0/30, production 0/80). Xem docs/superpowers/audits/2026-10-23-server-dev-chet-im-lang.md.
 *
 * Ca khoá: (1) chọn chế độ theo env; (2) logger dev THẬT là stream đồng bộ — không phải ThreadStream; (3) đầu ra vẫn có định dạng (màu, giờ, tin nhắn, trường);
 * (4) ĐỐI CHỨNG DƯƠNG: `LOG_PRETTY_WORKER=1` quay về transport worker (ThreadStream) — nếu ca này không còn đỏ-khi-đảo thì (2) không chứng minh được gì;
 * (5) census: cấm `transport:` với pino-pretty trong server/** ngoài nhánh thoát có tên `LOG_PRETTY_WORKER`.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import pino from "pino";
import { PRETTY_DONG_BO, chonCheDoLogger, taoLogger } from "./logger";

const streamCua = (l: pino.Logger): { constructor: { name: string } } => (l as unknown as Record<symbol, { constructor: { name: string } }>)[pino.symbols.streamSym];

describe("logger — chế độ theo môi trường", () => {
  it("production ⇒ json; LOG_JSON ⇒ json; dev ⇒ pretty đồng bộ; LOG_PRETTY_WORKER=1 ⇒ worker (chỉ dev)", () => {
    expect(chonCheDoLogger({ NODE_ENV: "production" })).toBe("json");
    expect(chonCheDoLogger({ NODE_ENV: "production", LOG_PRETTY_WORKER: "1" }), "production KHÔNG BAO GIỜ dùng worker").toBe("json");
    expect(chonCheDoLogger({ NODE_ENV: "development", LOG_JSON: "1" })).toBe("json");
    expect(chonCheDoLogger({ NODE_ENV: "development", LOG_JSON: "true" })).toBe("json");
    expect(chonCheDoLogger({ NODE_ENV: "development" })).toBe("pretty-dong-bo");
    expect(chonCheDoLogger({ NODE_ENV: "test" })).toBe("pretty-dong-bo");
    expect(chonCheDoLogger({})).toBe("pretty-dong-bo");
    expect(chonCheDoLogger({ NODE_ENV: "development", LOG_PRETTY_WORKER: "1" })).toBe("pretty-worker");
    expect(chonCheDoLogger({ NODE_ENV: "development", LOG_PRETTY_WORKER: "0" }), "chỉ '1' mới bật worker").toBe("pretty-dong-bo");
  });
});

describe("logger dev — KHÔNG worker, vẫn có định dạng", () => {
  it("★★★ stream của logger dev KHÔNG phải ThreadStream (không dựng worker_thread)", () => {
    const l = taoLogger({ NODE_ENV: "development" }, new PassThrough());
    expect(streamCua(l).constructor.name).not.toBe("ThreadStream");
  });

  it("★ tuỳ chọn stream đồng bộ: sync=true + định dạng cũ (colorize, translateTime, ignore)", () => {
    expect(PRETTY_DONG_BO).toEqual({ colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname", sync: true });
  });

  it("★★ đầu ra pretty: màu ANSI + giờ HH:MM:SS + mức + tin nhắn + trường; không có pid/hostname", async () => {
    const dich = new PassThrough();
    const chunks: string[] = [];
    dich.on("data", (c) => chunks.push(String(c)));
    const l = taoLogger({ NODE_ENV: "development" }, dich);
    l.info({ a: 1 }, "thu dinh dang logger");
    await new Promise((r) => setTimeout(r, 50));
    const ra = chunks.join("");
    expect(ra).toContain("thu dinh dang logger");
    expect(ra).toContain("INFO");
    expect(ra, "colorize").toMatch(/\u001b\[/);
    expect(ra, "translateTime SYS:HH:MM:ss").toMatch(/\d\d:\d\d:\d\d/);
    const trang = ra.replace(/[[0-9;]*m/g, "");
    expect(trang).toMatch(/a: 1/);
    expect(trang).not.toMatch(/pid|hostname/);
  });

  it("★ đối chứng dương: LOG_PRETTY_WORKER=1 ⇒ ThreadStream (chứng minh phép thử phân biệt được hai chế độ)", async () => {
    const l = taoLogger({ NODE_ENV: "development", LOG_PRETTY_WORKER: "1" });
    const st = streamCua(l) as unknown as { constructor: { name: string }; end?: () => void; unref?: () => void };
    expect(st.constructor.name).toBe("ThreadStream");
    try { st.end?.(); } catch { /* dọn worker của ca đối chứng */ }
  });

  it("production/JSON ⇒ dòng JSON thuần có level+msg (không pretty)", async () => {
    const dich = new PassThrough();
    const chunks: string[] = [];
    dich.on("data", (c) => chunks.push(String(c)));
    const l = taoLogger({ NODE_ENV: "production" }, dich);
    l.info({ b: 2 }, "dong json");
    await new Promise((r) => setTimeout(r, 30));
    const o = JSON.parse(chunks.join("").trim().split("\n")[0]);
    expect(o).toMatchObject({ msg: "dong json", b: 2 });
  });
});

describe("census — cấm transport pino-pretty (worker) ngoài nhánh thoát", () => {
  const SERVER = join(dirname(fileURLToPath(import.meta.url)));
  function moiTep(d: string, ra: string[] = []): string[] {
    for (const t of readdirSync(d)) {
      const p = join(d, t);
      if (statSync(p).isDirectory()) {
        if (t !== "node_modules") moiTep(p, ra);
      } else if (/\.tsx?$/.test(t) && !/\.test\.tsx?$/.test(t)) ra.push(p);
    }
    return ra;
  }
  const boCmt = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const tep = moiTep(SERVER).map((p) => ({ p: p.slice(SERVER.length + 1).split("\\").join("/"), nd: boCmt(readFileSync(p, "utf8")) }));

  it("cầu chì: thấy logger.ts (không đo trên tập rỗng)", () => {
    expect(tep.some((x) => x.p === "logger.ts")).toBe(true);
    expect(tep.length).toBeGreaterThan(500);
  });

  it("★★★ mọi `target: \"pino-pretty\"` chỉ nằm trong nhánh `pretty-worker` của taoLogger (cổng LOG_PRETTY_WORKER)", () => {
    const vi = tep.filter(({ nd }) => /target\s*:\s*["']pino-pretty["']/.test(nd)).map((x) => x.p);
    expect(vi, "chỉ logger.ts được phép").toEqual(["logger.ts"]);
    const lg = tep.find((x) => x.p === "logger.ts")!.nd;
    const i = lg.indexOf('target: "pino-pretty"');
    const khoi = lg.slice(Math.max(0, lg.lastIndexOf("if (", i)), i);
    expect(khoi, "transport pino-pretty phải nằm DƯỚI điều kiện cheDo === 'pretty-worker'").toMatch(/cheDo === "pretty-worker"/);
    expect((lg.match(/target\s*:\s*["']pino-pretty["']/g) ?? []).length, "đúng MỘT chỗ").toBe(1);
  });
});
