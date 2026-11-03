// Nhật ký server của instance e2e flow-studio: NỐI THÊM, không ghi đè; phép chờ "Server running on …" chỉ đọc phần của LƯỢT NÀY.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { docNhatKyTuMoc, moNhatKyNoiThem } from "../e2e/flow-studio/nhatKyServer";

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "nk-"));
  file = path.join(dir, "server.log");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("nhatKyServer", () => {
  it("★ lượt sau KHÔNG ghi đè log lượt trước (chứng cứ của lần sụp còn nguyên) và có dòng mốc thời gian", () => {
    const a = moNhatKyNoiThem(file, "lượt A", () => new Date("2026-11-04T02:03:00.000Z"));
    fs.writeSync(a.fd, "[Interlock] disabled\nthông điệp cuối của lượt sụp\n");
    fs.closeSync(a.fd);
    const b = moNhatKyNoiThem(file, "lượt B", () => new Date("2026-11-04T02:30:00.000Z"));
    fs.closeSync(b.fd);
    const t = fs.readFileSync(file, "utf8");
    expect(t).toContain("thông điệp cuối của lượt sụp");
    expect(t).toMatch(/===== \[2026-11-04T02:03:00\.000Z\] lượt A =====/);
    expect(t).toMatch(/===== \[2026-11-04T02:30:00\.000Z\] lượt B =====/);
    expect(t.indexOf("lượt A")).toBeLessThan(t.indexOf("lượt B"));
  });

  it("★ phép chờ khởi động chỉ đọc từ mốc của lượt NÀY: dòng 'Server running' của lượt trước (cùng cổng) KHÔNG khớp", () => {
    const a = moNhatKyNoiThem(file, "lượt A");
    fs.writeSync(a.fd, "Server running on http://localhost:3051/\n");
    fs.closeSync(a.fd);
    const b = moNhatKyNoiThem(file, "lượt B");
    const re = /Server running on https?:\/\/localhost:(\d+)/;
    expect(re.exec(docNhatKyTuMoc(file, b.batDau))).toBeNull();
    fs.writeSync(b.fd, "Server running on http://localhost:3051/\n");
    fs.closeSync(b.fd);
    expect(re.exec(docNhatKyTuMoc(file, b.batDau))?.[1]).toBe("3051");
    // đột biến thiết bị đo: đọc cả tệp thì dòng của lượt A khớp ngay — đúng lỗi mà mốc bắt đầu chặn
    expect(re.exec(fs.readFileSync(file, "utf8"))?.[1]).toBe("3051");
  });

  it("★ TRẦN: log > trần ⇒ đổi tên thành .1 (ghi đè .1 cũ — chỉ giữ MỘT bản cũ), tệp mới chỉ có dòng đầu; ≤ trần ⇒ KHÔNG xoay", () => {
    const tran = 200;
    const a = moNhatKyNoiThem(file, "lượt A", undefined, tran);
    fs.writeSync(a.fd, "A".repeat(300));
    fs.closeSync(a.fd);
    const b = moNhatKyNoiThem(file, "lượt B", undefined, tran);
    fs.writeSync(b.fd, "B".repeat(300));
    fs.closeSync(b.fd);
    expect(fs.readFileSync(`${file}.1`, "utf8")).toContain("A".repeat(300));
    expect(fs.readFileSync(file, "utf8")).not.toContain("A");
    const c = moNhatKyNoiThem(file, "lượt C", undefined, tran); // log (B) > trần ⇒ .1 bị GHI ĐÈ bằng B
    fs.closeSync(c.fd);
    const cu = fs.readFileSync(`${file}.1`, "utf8");
    expect(cu).toContain("B".repeat(300));
    expect(cu).not.toContain("A");
    expect(fs.readdirSync(dir).sort()).toEqual(["server.log", "server.log.1"]); // không sinh .2, .3…
    // ≤ trần: không xoay
    const d = moNhatKyNoiThem(file, "lượt D", undefined, 10_000);
    fs.closeSync(d.fd);
    expect(fs.readFileSync(`${file}.1`, "utf8")).toContain("B".repeat(300));
    const moi = fs.readFileSync(file, "utf8");
    expect(moi.indexOf("lượt C")).toBeGreaterThan(-1);
    expect(moi.indexOf("lượt D")).toBeGreaterThan(moi.indexOf("lượt C"));
  });

  it("mốc bắt đầu vượt cuối tệp (tệp bị cắt) ⇒ chuỗi rỗng, không ném", () => {
    const a = moNhatKyNoiThem(file, "x");
    fs.closeSync(a.fd);
    expect(docNhatKyTuMoc(file, a.batDau + 9999)).toBe("");
  });
});
