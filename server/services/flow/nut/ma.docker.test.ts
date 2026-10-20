/**
 * ★★ Đợt 8.2 Task 3 — node `du-lieu.ma` + `lib/chayMaCachLy.ts` với DOCKER THẬT (ảnh ghim `ANH_MA`). Ảnh/Docker vắng ⇒ phần
 * cần Docker BỎ QUA có thông báo (phần cờ + chuẩn hoá vẫn chạy). Lưới: biến đổi item · fetch / require('net') / net qua
 * process ⇒ lỗi · ghi tệp ⇒ lỗi · vòng lặp vô hạn ⇒ hết giờ ≤ 12 s và container bị xoá · rác > 1 MB (log hoặc kết quả) ⇒
 * lỗi · `process.env` rỗng · chuỗi kiểu shell trong mã KHÔNG bao giờ tới shell · ảnh thiếu ⇒ lỗi `thieu-anh`.
 */
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { layNut, type NguCanhChay } from "../dangKyNut";
import { ANH_MA, ANH_MA_DIGEST, chayMaCachLy, coAnhMa, coDocker, KICH_BAN_CHAY } from "../lib/chayMaCachLy";
import { chuanHoaItem } from "./ma";
import "./index";

const CO_ANH = await coAnhMa().catch(() => false);
if (!CO_ANH) console.warn(`[ma.docker.test] BỎ QUA phần Docker: ảnh ${ANH_MA} chưa có (docker load -i node-24-alpine.tar — xem server/services/flow/lib/README-chay-ma.md).`);

const ngu = (main: { json: Record<string, unknown> }[]): NguCanhChay => ({
  runId: "r", flowId: "f", nodeId: "n", lan: 1, idempotencyKey: "r:n:1", inputs: { main }, nodes: {}, env: { BI: "khong-duoc-lot" }, run: { id: "r", flowId: "f", batDau: "x" },
});
const loiCua = (p: Promise<unknown>) => p.then(() => null, (e: { loai?: string; message: string }) => e);

describe("du-lieu.ma — cờ + khai báo (không cần Docker)", () => {
  it("cờ docker đúng hàng rào kế hoạch; ảnh ghim digest; mã người dùng KHÔNG nằm trên dòng lệnh", () => {
    const a = coDocker("ten-thu");
    const s = a.join(" ");
    for (const c of ["--rm", "--pull never", "--network none", "--read-only", "--memory 256m", "--memory-swap 256m", "--pids-limit 64", "--cpus 1", "--cap-drop ALL", "--security-opt no-new-privileges", "--user 65534:65534", "--log-driver none"]) {
      expect(s).toContain(c);
    }
    expect(a).not.toContain("-v");
    expect(a).not.toContain("--volume");
    expect(a).not.toContain("--privileged");
    expect(a.some((x) => x.startsWith("-e") && x !== "-e")).toBe(false);
    expect(ANH_MA).toBe(`node@${ANH_MA_DIGEST}`);
    expect(ANH_MA_DIGEST).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(a[a.length - 1]).toBe(KICH_BAN_CHAY);
    expect(a.slice(a.indexOf(ANH_MA))).toEqual([ANH_MA, "node", "--permission", "--max-old-space-size=160", "-e", KICH_BAN_CHAY]);
  });

  it("khai báo: thuan / idempotent / không nhận bí mật; chuẩn hoá kết quả", () => {
    expect(layNut("du-lieu.ma")).toMatchObject({ tacDungPhu: "thuan", lapLai: "idempotent" });
    expect(layNut("du-lieu.ma")!.nhanBiMat).toBeFalsy();
    expect(chuanHoaItem([{ json: { a: 1 } }, { b: 2 }])).toEqual([{ json: { a: 1 } }, { json: { b: 2 } }]);
    expect(chuanHoaItem(null)).toEqual([]);
    expect(() => chuanHoaItem([1])).toThrow(/đối tượng/);
  });
});

describe.skipIf(!CO_ANH)("du-lieu.ma — Docker thật", () => {
  it("biến đổi item đúng qua node", async () => {
    const ra = (await layNut("du-lieu.ma")!.chay({ ma: "return items.map((i) => ({ json: { ...i.json, gap: i.json.x * 2 } }))" }, ngu([{ json: { x: 2 } }, { json: { x: 5 } }]))) as { main: unknown[] };
    expect(ra.main).toEqual([{ json: { x: 2, gap: 4 } }, { json: { x: 5, gap: 10 } }]);
  });

  it("process.env RỖNG; $env của luồng không lọt; chạy không root", async () => {
    const r = await chayMaCachLy({ ma: "return [{ json: { n: Object.keys(process.env).length, uid: process.getuid() } }]", items: [] });
    expect(r.items).toEqual([{ json: { n: 0, uid: 65534 } }]);
  });

  it("mạng: fetch ⇒ lỗi; require('net') ⇒ lỗi; net qua process ⇒ lỗi", async () => {
    for (const ma of [
      "return await fetch('http://1.1.1.1/')",
      "return require('net')",
      "const net = process.getBuiltinModule('net'); return await new Promise((ok, ko) => { const s = net.connect(80, '1.1.1.1'); s.on('connect', () => ok([])); s.on('error', ko); })",
    ]) {
      const e = await loiCua(chayMaCachLy({ ma, items: [] }));
      expect(e, ma).not.toBeNull();
      expect(e!.loai, ma).toBe("ma-loi");
    }
  });

  it("đĩa: ghi tệp ⇒ lỗi (kể cả /tmp)", async () => {
    for (const ma of ["require('fs').writeFileSync('/tmp/x', '1')", "process.getBuiltinModule('fs').writeFileSync('/tmp/x', '1')"]) {
      const e = await loiCua(chayMaCachLy({ ma, items: [] }));
      expect(e?.loai, ma).toBe("ma-loi");
    }
  });

  it("vòng lặp vô hạn ⇒ het-gio trong ≤ 12 s và container đã bị xoá", async () => {
    const t0 = Date.now();
    const e = await loiCua(chayMaCachLy({ ma: "while (true) {}", items: [] }));
    const ms = Date.now() - t0;
    expect(e?.loai).toBe("het-gio");
    expect(ms).toBeLessThanOrEqual(12_000);
    const ps = spawnSync("docker", ["ps", "-a", "--filter", `name=luong-ma-${process.pid}-`, "--format", "{{.Names}}"], { encoding: "utf8" });
    expect(ps.stdout.trim()).toBe("");
  }, 30_000);

  it("rác > 1 MB: log ⇒ lỗi; kết quả ⇒ lỗi", async () => {
    expect((await loiCua(chayMaCachLy({ ma: "console.log('x'.repeat(2 * 1024 * 1024)); return []", items: [] })))?.loai).toBe("dau-ra-qua-lon");
    expect((await loiCua(chayMaCachLy({ ma: "process.stdout.write('y'.repeat(2 * 1024 * 1024)); return []", items: [] })))?.loai).toBe("dau-ra-qua-lon");
    expect((await loiCua(chayMaCachLy({ ma: "return [{ json: { s: 'z'.repeat(2 * 1024 * 1024) } }]", items: [] })))?.loai).toBe("dau-ra-qua-lon");
  }, 30_000);

  it("chuỗi kiểu shell trong mã/đầu vào là DỮ LIỆU, không tới shell", async () => {
    const r = await chayMaCachLy({ ma: "return [{ json: { s: '$(id) `id` ; echo pwned && exit 1', v: items[0].json.v } }]", items: [{ json: { v: "'; rm -rf / #" } }] });
    expect(r.items).toEqual([{ json: { s: "$(id) `id` ; echo pwned && exit 1", v: "'; rm -rf / #" } }]);
  });

  it("ảnh thiếu ⇒ lỗi thieu-anh rõ ràng (không lùi về trong tiến trình)", async () => {
    const e = await loiCua(chayMaCachLy({ ma: "return []", items: [], anh: `node@sha256:${"0".repeat(64)}` }));
    expect(e?.loai).toBe("thieu-anh");
    expect(e?.message).toMatch(/docker load/);
  });
});
