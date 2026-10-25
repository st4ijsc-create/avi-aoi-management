/**
 * W17b — tầng ROUTE EXPRESS của GET /api/reports/artifacts/:id/download với khoá API có phạm vi nhà máy HẸP (CSDL `_test` thật; xác thực + kho tệp được giả, còn lại thật).
 * Khoá nhà máy A tải tệp của người tạo nhà máy B / hệ thống ⇒ 404; tải tệp người tạo A ⇒ 200 đúng nội dung; khoá TOÀN CỤC ⇒ 200 cho cả hai; phiên người dùng vai đặc quyền theo phạm vi người tạo.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";

const RUN = `pw23${process.pid}${Date.now().toString(36)}`;
const THU_MUC = fs.mkdtempSync(path.join(os.tmpdir(), "artf-"));
process.env.LOCAL_STORAGE_DIR = THU_MUC;

let faCode = "";
let fbCode = "";
let userA = 0;
let userSessionViewer = 0;

vi.mock("../api/export/exportRouter", () => ({
  authenticateExportRequest: async (req: { header: (n: string) => string | undefined }) => {
    const p = req.header("x-test-principal");
    if (p === "keyA") return { principal: { kind: "api-key", name: "khoa-A", tenantScope: { mode: "factory", corporateCode: null, factoryCode: faCode } }, status: 200 };
    if (p === "global") return { principal: { kind: "api-key", name: "khoa-toan-cuc", tenantScope: { mode: "global" } }, status: 200 };
    if (p === "viewer") return { principal: { kind: "session", name: "viewer", userId: userSessionViewer, userRole: "supervisor" }, status: 200 };
    return { principal: null, status: 401, message: "no auth" };
  },
}));
vi.mock("../storage", () => ({
  storageGet: async (key: string) => ({ key, url: `/uploads/${key}` }),
  storageDelete: async () => ({ deleted: true }),
}));

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
const one = async (q: ReturnType<typeof sql>) => (await dung(q))[0];
let server: ReturnType<ReturnType<typeof express>["listen"]>;
let goc = "";
const ids: Record<string, number> = {};

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("không có CSDL test");
  db = d;
  faCode = `${RUN}fa`;
  fbCode = `${RUN}fb`;
  await dung(sql`INSERT INTO factories (code, name) VALUES (${faCode}, ${faCode}), (${fbCode}, ${fbCode})`);
  const cA = await taoNguoiDungTest("ca", "supervisor", { tienTo: "pw23", ts: RUN, ten: "PW23 ca" });
  const cB = await taoNguoiDungTest("cb", "supervisor", { tienTo: "pw23", ts: RUN, ten: "PW23 cb" });
  const v = await taoNguoiDungTest("v", "supervisor", { tienTo: "pw23", ts: RUN, ten: "PW23 v" });
  userA = cA.id;
  userSessionViewer = v.id;
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${cA.id}, ${faCode}), (${cB.id}, ${fbCode}), (${v.id}, ${faCode})`);
  const mk = async (by: number | null, ten: string) => {
    const key = `${RUN}-${ten}.csv`;
    fs.writeFileSync(path.join(THU_MUC, key), `noi-dung-${ten}`);
    return Number((await one(sql`INSERT INTO report_artifacts ("reportType", format, title, "storageKey", "storageUrl", "fileHash", "createdBy")
      VALUES ('t', 'csv', ${RUN + "-" + ten}, ${key}, ${"/uploads/" + key}, ${"d".repeat(64)}, ${by}) RETURNING id`)).id);
  };
  ids.a = await mk(cA.id, "a");
  ids.b = await mk(cB.id, "b");
  ids.sys = await mk(null, "sys");
  const { registerReportArtifactRoutes } = await import("./reportArtifactRoutes");
  const app = express();
  registerReportArtifactRoutes(app);
  server = app.listen(0);
  goc = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120_000);

afterAll(async () => {
  server?.close();
  if (db) {
    await dung(sql`DELETE FROM report_artifacts WHERE title LIKE ${RUN + "%"}`).catch(() => undefined);
    await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${RUN + "%"}`).catch(() => undefined);
    await dung(sql`DELETE FROM factories WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  }
  fs.rmSync(THU_MUC, { recursive: true, force: true });
});

async function tai(id: number, principal: string): Promise<{ status: number; body: string }> {
  const r = await fetch(`${goc}/api/reports/artifacts/${id}/download`, { headers: { "x-test-principal": principal } });
  return { status: r.status, body: await r.text() };
}

describe("route tải tệp báo cáo — phạm vi khoá API", () => {
  it("khoá nhà máy A: tệp người tạo A ⇒ 200 đúng nội dung; tệp người tạo B / hệ thống ⇒ 404", async () => {
    expect(await tai(ids.a, "keyA")).toEqual({ status: 200, body: "noi-dung-a" });
    expect((await tai(ids.b, "keyA")).status).toBe(404);
    expect((await tai(ids.sys, "keyA")).status).toBe(404);
  });
  it("khoá TOÀN CỤC: tải được tất cả ⇒ 200", async () => {
    expect(await tai(ids.a, "global")).toEqual({ status: 200, body: "noi-dung-a" });
    expect(await tai(ids.b, "global")).toEqual({ status: 200, body: "noi-dung-b" });
    expect(await tai(ids.sys, "global")).toEqual({ status: 200, body: "noi-dung-sys" });
  });
  it("phiên giám sát viên nhà máy A: tệp A ⇒ 200; tệp B / hệ thống ⇒ 404; không xác thực ⇒ 401", async () => {
    expect((await tai(ids.a, "viewer")).status).toBe(200);
    expect((await tai(ids.b, "viewer")).status).toBe(404);
    expect((await tai(ids.sys, "viewer")).status).toBe(404);
    expect((await tai(ids.a, "none")).status).toBe(401);
    expect(userA).toBeGreaterThan(0);
  });
});
