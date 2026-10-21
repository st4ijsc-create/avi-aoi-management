/**
 * Đợt 9 — dữ liệu e2e Flow Studio trên `aoi_management_test` CHỈ. Tiền tố `fse2e` cho mọi hàng; dọn sạch ở teardown (và hàng
 * sót của lượt hỏng trước). Gieo: một admin, ba luồng (thử node · so sánh lượt · OT), hai lượt chạy khác nhau cho so sánh.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const require = createRequire(path.join(REPO, "package.json"));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const postgres = require("postgres") as typeof import("postgres");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bcrypt = require("bcryptjs") as { hash: (s: string, n: number) => Promise<string> };

export const TEST_DB = "aoi_management_test";
export const PREFIX = "fse2e";

export function testDatabaseUrl(): string {
  let u: URL;
  if (process.env.FS_TEST_DATABASE_URL) u = new URL(process.env.FS_TEST_DATABASE_URL);
  else {
    const env = fs.readFileSync(path.join(REPO, ".env"), "utf8");
    const m = /^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m.exec(env);
    if (!m) throw new Error("no DATABASE_URL in .env and no FS_TEST_DATABASE_URL");
    u = new URL(m[1]);
    u.pathname = "/" + TEST_DB;
  }
  if (u.pathname !== "/" + TEST_DB) throw new Error(`refusing: FS e2e runs on ${TEST_DB} only, got ${u.pathname}`);
  return u.toString();
}

export async function withTestDb<T>(fn: (sql: ReturnType<typeof postgres>) => Promise<T>): Promise<T> {
  const sql = postgres(testDatabaseUrl(), { max: 1, connect_timeout: 15, onnotice: () => {} });
  try {
    const [{ db }] = await sql`SELECT current_database() AS db`;
    if (db !== TEST_DB) throw new Error(`refusing: current_database()=${db}`);
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export const FLOW_THU = `${PREFIX}-thu`;
export const FLOW_SO_SANH = `${PREFIX}-sosanh`;
export const FLOW_OT = `${PREFIX}-ot`;

export interface FsFixture {
  admin: { id: number; username: string; password: string };
  runA: string;
  runB: string;
  /** Máy thật trong CSDL _test (node OT phải trỏ máy TỒN TẠI và thuộc phạm vi người gọi). */
  machineId: number;
  /** Kỹ sư thuộc HAI nhà máy (phải chọn nhà máy khi tạo luồng) và kỹ sư thuộc MỘT nhà máy (máy chủ tự gán). */
  nhieu: { id: number; username: string; password: string };
  mot: { id: number; username: string; password: string };
  nhaMayA: { id: number; code: string };
  nhaMayB: { id: number; code: string };
}

const nut = (id: string, type: string, parameters: Record<string, unknown> = {}, x = 0) => ({
  id, type, typeVersion: 1, name: id, position: [x, 0], parameters,
});
const noi = (a: string, b: string, pa = "main") => ({ from: { node: a, port: pa }, to: { node: b, port: "main" } });
const dinhNghia = (id: string, ten: string, nodes: ReturnType<typeof nut>[], connections: ReturnType<typeof noi>[]) => ({
  id, name: ten, version: 1, nodes, connections, settings: { uuTien: "background", luuDuLieu: "day-du" },
});

export async function teardownFixtures(): Promise<Record<string, number>> {
  return withTestDb(async (sql) => {
    const like = `${PREFIX}%`;
    const out: Record<string, number> = {};
    out.ai_flow_runs = (await sql`DELETE FROM ai_flow_runs WHERE "flowId" LIKE ${like}`).count;
    out.ai_flow_credentials = (await sql`DELETE FROM ai_flow_credentials WHERE id LIKE ${like}`).count;
    out.ai_flows = (await sql`DELETE FROM ai_flows WHERE id LIKE ${like}`).count;
    // luồng do e2e tạo qua giao diện (id sinh từ tên, không mang tiền tố): theo CHỦ hoặc NHÀ MÁY của fixture
    const fl = (await sql`SELECT id FROM ai_flows WHERE "factoryId" IN (SELECT id FROM factories WHERE code LIKE ${like}) OR "ownerId" IN (SELECT id FROM users WHERE "openId" LIKE ${like})`).map((r) => String(r.id));
    if (fl.length) {
      await sql`DELETE FROM ai_flow_runs WHERE "flowId" IN ${sql(fl)}`;
      out.ai_flows_ui = (await sql`DELETE FROM ai_flows WHERE id IN ${sql(fl)}`).count;
    }
    out.machines = (await sql`DELETE FROM machines WHERE code LIKE ${like}`).count;
    out.stations = (await sql`DELETE FROM stations WHERE code LIKE ${like}`).count;
    out.production_lines = (await sql`DELETE FROM production_lines WHERE code LIKE ${like}`).count;
    out.workshops = (await sql`DELETE FROM workshops WHERE code LIKE ${like}`).count;
    out.factories = (await sql`DELETE FROM factories WHERE code LIKE ${like}`).count;
    const users = (await sql`SELECT id FROM users WHERE "openId" LIKE ${like}`).map((r) => Number(r.id));
    if (users.length) {
      await sql`DELETE FROM user_factory_assignments WHERE "userId" IN ${sql(users)}`;
      await sql`DELETE FROM user_sessions WHERE "userId" IN ${sql(users)}`.catch(() => undefined);
      await sql`DELETE FROM permissions WHERE "userId" IN ${sql(users)}`;
      await sql`DELETE FROM user_secrets WHERE "userId" IN ${sql(users)}`;
      try {
        out.users = (await sql`DELETE FROM users WHERE id IN ${sql(users)}`).count;
      } catch {
        out.usersDeactivated = (await sql`UPDATE users SET "isActive" = false WHERE id IN ${sql(users)}`).count;
      }
    }
    return out;
  });
}

export async function countFixtures(): Promise<Record<string, number>> {
  return withTestDb(async (sql) => {
    const like = `${PREFIX}%`;
    const [r] = await sql`SELECT
      (SELECT count(*)::int FROM ai_flows WHERE id LIKE ${like}) AS flows,
      (SELECT count(*)::int FROM ai_flow_runs WHERE "flowId" LIKE ${like}) AS runs,
      (SELECT count(*)::int FROM machines WHERE code LIKE ${like}) AS machines,
      (SELECT count(*)::int FROM factories WHERE code LIKE ${like}) AS factories,
      (SELECT count(*)::int FROM users WHERE "openId" LIKE ${like}) AS users`;
    return r as unknown as Record<string, number>;
  });
}

export async function setupFixtures(): Promise<FsFixture> {
  const password = "FS!" + crypto.randomBytes(10).toString("hex");
  const hash = await bcrypt.hash(password, 10);
  const run = `${PREFIX}${Date.now().toString(36)}`;
  const runA = crypto.randomUUID();
  const runB = crypto.randomUUID();
  return withTestDb((sql) =>
    sql.begin(async (tx) => {
      const [u] = await tx`INSERT INTO users ("openId", username, name, "loginMethod", role, "isActive", two_factor_enabled, "passwordChangedAt")
        VALUES (${`${run}-admin`}, ${`${run}_admin`}, 'FS admin', 'password', 'admin', true, false, now()) RETURNING id`;
      await tx`INSERT INTO user_secrets ("userId", "passwordHash", "updatedAt") VALUES (${u.id}, ${hash}, now())`;
      const [fac] = await tx`INSERT INTO factories (code, name) VALUES (${run}, ${run + " factory"}) RETURNING id`;
      const [facB] = await tx`INSERT INTO factories (code, name) VALUES (${run + "b"}, ${run + " factory B"}) RETURNING id`;
      const mkKySu = async (ten: string, ...ma: string[]) => {
        const [k] = await tx`INSERT INTO users ("openId", username, name, "loginMethod", role, "isActive", two_factor_enabled, "passwordChangedAt")
          VALUES (${`${run}-${ten}`}, ${`${run}_${ten}`}, ${"FS " + ten}, 'password', 'engineer', true, false, now()) RETURNING id`;
        await tx`INSERT INTO user_secrets ("userId", "passwordHash", "updatedAt") VALUES (${k.id}, ${hash}, now())`;
        // `factory.list` đòi "bất kỳ quyền nào" (requireBatKyQuyenNao): kỹ sư cần ít nhất một hàng quyền.
        await tx`INSERT INTO permissions ("userId", category, "moduleName", "canView") VALUES (${k.id}, 'machine_monitoring', 'machine_status', true)`;
        for (const c of ma) await tx`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${k.id}, ${c})`;
        return { id: Number(k.id), username: `${run}_${ten}`, password };
      };
      const nhieu = await mkKySu("nhieu", run, run + "b");
      const mot = await mkKySu("mot", run);
      const [ws] = await tx`INSERT INTO workshops ("factoryId", code, name) VALUES (${fac.id}, ${run}, ${run + " ws"}) RETURNING id`;
      const [ln] = await tx`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ws.id}, ${run}, ${run + " line"}) RETURNING id`;
      const [st] = await tx`INSERT INTO stations ("lineId", code, name) VALUES (${ln.id}, ${run}, ${run + " station"}) RETURNING id`;
      const [mc] = await tx`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${st.id}, ${run}, ${run + " machine"}, ${"AOI"}, true) RETURNING id`;

      const luong = async (id: string, ten: string, def: object, hang: string) => {
        await tx`INSERT INTO ai_flows (id, name, "riskClass", enabled) VALUES (${id}, ${ten}, ${hang}, false)`;
        await tx`INSERT INTO ai_flow_versions ("flowId", version, definition, "riskClass") VALUES (${id}, 1, ${tx.json(def as never)}, ${hang})`;
      };
      await luong(FLOW_THU, "FS thử node", dinhNghia(FLOW_THU, "FS thử node", [nut("t", "kich-hoat.thu-cong")], []), "thuan");
      await luong(
        FLOW_SO_SANH,
        "FS so sánh",
        dinhNghia(FLOW_SO_SANH, "FS so sánh", [nut("t", "kich-hoat.thu-cong"), nut("dat", "du-lieu.dat", { truong: { a: 1 } }, 260)], [noi("t", "dat")]),
        "thuan",
      );
      await luong(
        FLOW_OT,
        "FS node OT",
        dinhNghia(FLOW_OT, "FS node OT", [nut("t", "kich-hoat.thu-cong"), nut("dx", "ot.de-xuat-lenh", { may: 999999, lenh: "pause", hetHanGio: 24 }, 260)], [noi("t", "dx")]),
        "ot",
      );

      // hai lượt của luồng so sánh: B khác A ở thời gian, đầu ra của `dat`, và trạng thái (lỗi)
      const t0 = new Date(Date.UTC(2026, 9, 21, 1, 0, 0));
      const at = (s: number) => new Date(t0.getTime() + s * 1000);
      const item = (a: unknown) => ({ main: [{ json: { a } }] });
      await tx`INSERT INTO ai_flow_runs (id, "flowId", version, "triggerKind", status, "startedAt", "finishedAt")
        VALUES (${runA}, ${FLOW_SO_SANH}, 1, 'thu-cong', 'xong', ${at(0)}, ${at(2)})`;
      await tx`INSERT INTO ai_flow_runs (id, "flowId", version, "triggerKind", status, error, "startedAt", "finishedAt")
        VALUES (${runB}, ${FLOW_SO_SANH}, 1, 'thu-cong', 'loi', ${tx.json({ thongDiep: "hỏng ở dat" })}, ${at(10)}, ${at(17)})`;
      const buoc = async (rid: string, nodeId: string, status: string, s0: number, s1: number, input: unknown, output: unknown, error: unknown = null) =>
        tx`INSERT INTO ai_flow_steps ("runId", "nodeId", lan, "lanThu", status, "idempotencyKey", input, output, error, "startedAt", "finishedAt")
          VALUES (${rid}, ${nodeId}, 1, 1, ${status}, ${`${rid}:${nodeId}:1`}, ${tx.json(input as never)}, ${output === null ? null : tx.json(output as never)}, ${error === null ? null : tx.json(error as never)}, ${at(s0)}, ${at(s1)})`;
      await buoc(runA, "t", "xong", 0, 1, item(1), item(1));
      await buoc(runA, "dat", "xong", 1, 2, item(1), item(1));
      await buoc(runB, "t", "xong", 10, 11, item(1), item(1));
      await buoc(runB, "dat", "loi", 11, 17, item(2), null, { thongDiep: "hỏng ở dat" });
      // bí mật CŨ chưa khai host (mặc định {}) — UI phải báo "chưa dùng được" và cho admin khai
      await tx`INSERT INTO ai_flow_credentials (id, ten, loai, "banMa", iv, tag, "phienBanKhoa") VALUES (${`${PREFIX}-bm-cu`}, ${"Bí mật cũ"}, ${"token"}, ${Buffer.alloc(8, 1)}, ${Buffer.alloc(12, 2)}, ${Buffer.alloc(16, 3)}, 1)`;
      // vết model (sự kiện do động cơ ghi khi node ai.* chạy): A dùng model gán; B rơi dự phòng vì khe nặng đang giữ model khác
      const vet = (rid: string, o: object) => tx`INSERT INTO ai_flow_events ("runId", kind, payload) VALUES (${rid}, ${"buoc.model"}, ${tx.json({ nodeId: "dat", lan: 1, vaiTro: "extract", ...o } as never)})`;
      await vet(runA, { model: "Qwen3-Khe-Nang-30B", nguon: "gan-profile", phamVi: "flow", duPhong: false, kheBan: false, lyDo: [] });
      await vet(runB, { model: "Qwen3-4B-Instruct-2507-UD-Q4_K_XL", nguon: "du-phong", phamVi: "flow", duPhong: true, kheBan: true, lyDo: ["gán flow → p-nang", "khe-dang-giu-model-khac (p-nang; bề mặt nền không đổi khe)"] });
      return { admin: { id: Number(u.id), username: `${run}_admin`, password }, runA, runB, machineId: Number(mc.id), nhieu, mot, nhaMayA: { id: Number(fac.id), code: run }, nhaMayB: { id: Number(facB.id), code: run + "b" } };
    }),
  );
}
