/**
 * Đợt 9.4 — CLI xoay khoá: mặc định CHẠY KHÔ · `--ap-dung` mới ghi · đầu ra không chứa khoá/giá trị · lỗi ⇒ mã thoát ≠ 0.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { like } from "drizzle-orm";
import { getDb } from "../server/db/connection";
import { aiFlowCredentials } from "../drizzle/schema";
import { giaiMaChoChay, taoBiMat } from "../server/services/flow/biMat";
import { chay, docThamSo } from "./flow-xoay-khoa";

const TT = "t9cli";
const k1 = randomBytes(32).toString("base64");
const k2 = randomBytes(32).toString("base64");
const GT = `tok-${randomBytes(16).toString("hex")}`;
const giu = { k: process.env.AI_FLOW_KHOA_BI_MAT, p: process.env.AI_FLOW_KHOA_BI_MAT_PHIEN_BAN, c: process.env.AI_FLOW_KHOA_BI_MAT_CU };

function datEnv(k: string, p?: string, c?: string) {
  process.env.AI_FLOW_KHOA_BI_MAT = k;
  if (p) process.env.AI_FLOW_KHOA_BI_MAT_PHIEN_BAN = p;
  else delete process.env.AI_FLOW_KHOA_BI_MAT_PHIEN_BAN;
  if (c) process.env.AI_FLOW_KHOA_BI_MAT_CU = c;
  else delete process.env.AI_FLOW_KHOA_BI_MAT_CU;
}

beforeAll(async () => {
  datEnv(k1);
  await (await getDb())!.delete(aiFlowCredentials).where(like(aiFlowCredentials.id, `${TT}%`));
  await taoBiMat({ id: `${TT}-1`, ten: "cli", loai: "token", giaTri: GT }, null);
});
afterAll(async () => {
  for (const [k, v] of [["AI_FLOW_KHOA_BI_MAT", giu.k], ["AI_FLOW_KHOA_BI_MAT_PHIEN_BAN", giu.p], ["AI_FLOW_KHOA_BI_MAT_CU", giu.c]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await (await getDb())?.delete(aiFlowCredentials).where(like(aiFlowCredentials.id, `${TT}%`));
});

describe("flow-xoay-khoa CLI (Đợt 9.4)", () => {
  it("đọc tham số", () => {
    expect(docThamSo(["--ap-dung", "--tien-to=erp-"])).toEqual({ sinhKhoa: false, apDung: true, tienTo: "erp-" });
    expect(docThamSo([])).toEqual({ sinhKhoa: false, apDung: false });
  });

  it("--sinh-khoa in đúng một khoá 32 byte base64, không đụng CSDL", async () => {
    const ra: string[] = [];
    expect(await chay(["--sinh-khoa"], (s) => ra.push(s))).toBe(0);
    expect(ra).toHaveLength(1);
    expect(Buffer.from(ra[0], "base64")).toHaveLength(32);
  });

  it("mặc định CHẠY KHÔ: báo cần chuyển, không ghi; --ap-dung ghi; kết thúc chạy lại = 0 cần chuyển; đầu ra sạch", async () => {
    datEnv(k2, "2", k1);
    const ra: string[] = [];
    const out = (s: string) => void ra.push(s);
    expect(await chay([`--tien-to=${TT}`], out)).toBe(0);
    expect(ra.join("\n")).toMatch(/CHẠY KHÔ/);
    expect(ra.join("\n")).toMatch(/cần chuyển 1 · đã chuyển 0/);
    expect((await (await getDb())!.select().from(aiFlowCredentials).where(like(aiFlowCredentials.id, `${TT}%`)))[0].phienBanKhoa).toBe(1);

    expect(await chay([`--tien-to=${TT}`, "--ap-dung"], out)).toBe(0);
    expect(ra.join("\n")).toMatch(/đã chuyển 1/);
    datEnv(k2, "2"); // bỏ khoá cũ
    expect((await giaiMaChoChay(`${TT}-1`)).giaTri).toBe(GT);

    ra.length = 0;
    expect(await chay([`--tien-to=${TT}`, "--ap-dung"], out)).toBe(0);
    expect(ra.join("\n")).toMatch(/cần chuyển 0 · đã chuyển 0/);

    const het = ra.join("\n");
    for (const s of [GT, k1, k2]) expect(het.includes(s)).toBe(false);
  });

  it("lỗi ⇒ mã thoát 1, nói rõ KHÔNG ghi gì, không lộ khoá", async () => {
    datEnv(k1); // hiện hành 1, nhưng hàng đã ở v2 ⇒ không có khoá giải
    const ra: string[] = [];
    expect(await chay([`--tien-to=${TT}`, "--ap-dung"], (s) => ra.push(s))).toBe(1);
    expect(ra.join("\n")).toMatch(/LỖI \(THIEU_KHOA\)/);
    expect(ra.join("\n")).toMatch(/Không có thay đổi nào/);
    for (const s of [GT, k1, k2]) expect(ra.join("\n").includes(s)).toBe(false);
  });
});
