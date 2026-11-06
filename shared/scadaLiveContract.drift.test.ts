// SCADA 1b — hợp đồng client không được LỆCH máy chủ (scadaSocket.ts @1a). Đọc tệp máy chủ như văn bản (không import mã server).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CAP_MS_HOP_LE, GIOI_HAN_CLIENT, MA_LOI_SCADA, TRUONG_HOP_DONG } from "./scadaLiveContract";

const SRC = readFileSync(resolve(__dirname, "../server/services/scada/scadaSocket.ts"), "utf8").replace(/\r\n/g, "\n");

function khoiKieu(ten: string): string {
  const i = SRC.indexOf(`export type ${ten} = {`);
  expect(i, `không thấy export type ${ten}`).toBeGreaterThan(-1);
  const j = SRC.indexOf("\n};", i);
  return SRC.slice(i, j);
}
/** Tên trường cấp 1 (thụt 2 dấu cách), bỏ dòng chú thích. */
function truongCua(ten: string): string[] {
  return khoiKieu(ten)
    .split("\n")
    .map((l) => /^ {2}([A-Za-z][A-Za-z0-9]*)(\?)?:/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => m[1] + (m[2] ?? ""));
}

describe("hợp đồng SCADA 1a — client khớp máy chủ", () => {
  it("tập capMs hợp lệ", () => {
    const m = /export const CAP_MS_HOP_LE = \[([^\]]+)\] as const;/.exec(SRC);
    expect(m).not.toBeNull();
    expect(m![1].split(",").map((s) => Number(s.trim()))).toEqual([...CAP_MS_HOP_LE]);
  });

  it("mã lỗi", () => {
    const m = /export type MaLoiScada = ([^;]+);/.exec(SRC);
    expect(m).not.toBeNull();
    const ma = [...m![1].matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]);
    expect(ma.sort()).toEqual([...MA_LOI_SCADA].sort());
  });

  it("GIOI_HAN (giá trị số)", () => {
    const i = SRC.indexOf("export const GIOI_HAN = {");
    expect(i).toBeGreaterThan(-1);
    const khoi = SRC.slice(i, SRC.indexOf("} as const;", i));
    const server: Record<string, number> = {};
    for (const m of khoi.matchAll(/^ {2}([a-zA-Z]+): (\d+),/gm)) server[m[1]] = Number(m[2]);
    expect(server).toEqual({ ...GIOI_HAN_CLIENT });
  });

  for (const [ten, truong] of Object.entries(TRUONG_HOP_DONG)) {
    it(`trường của ${ten}`, () => {
      expect(truongCua(ten)).toEqual([...truong]);
    });
  }

  it("đột biến thiết bị đo: bộ trích tên trường THẬT sự đọc được (không rỗng)", () => {
    expect(truongCua("ScadaSnapshot").length).toBeGreaterThanOrEqual(6);
  });
});
