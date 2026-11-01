/**
 * SCADA R1b-2b-2a T6d (AN TOÀN, dieu-phoi 2026-11-01) — khoá idempotency của đường lập trình / deploy KHÔNG đụng phạm vi khác.
 *
 * Trước T6d: `programming.deployBuild` / `requestDeployApproval` / `rollbackDeployment` / `deployToFleet` dùng THẲNG khoá client chọn làm khoá UNIQUE toàn
 * cục của `program_deployments` (và làm khoá `dispatch()` OT). Người B (nhà máy 2) dùng lại khoá K của người A (nhà máy 1) ⇒ `deployBuild` trả NGUYÊN hàng
 * deploy của A (lộ build / thiết bị / kết quả của A, và deploy của B không bao giờ chạy — "đã ghi" GIẢ), hoặc CONFLICT nêu build # của A.
 * Sau T6d: khoá LƯU = `khoaMienLapTrinh(người gọi, K)` ⇒ khoá của người khác đơn giản là KHÔNG trùng: deploy của B chạy bình thường (sim), không thấy gì
 * của A; mọi tra cứu theo khoá lọc `requestedBy` = người gọi; hàng khoá CŨ (trước T6d, chưa đặt miền) chỉ được trả cho CHÍNH người đã yêu cầu nó.
 *
 * CSDL THẬT (`_test`), router SẢN XUẤT (`createCaller`). KHÔNG cờ nào được bật (deploy thiết bị TẮT ⇒ mọi lượt deploy là `simulated` / `rejected` ở cổng);
 * không thiết bị thật. MỖI ca chạy trong MỘT giao dịch ROLLBACK của chính nó (`getDb` trả giao dịch): nhà máy / người dùng / dự án / build / hàng
 * `program_deployments` (sổ append-only, mig 0279) đều biến mất khi ca xong — không dọn, không xoá trên bảng WORM, không id tường minh.
 */
import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const H = vi.hoisted(() => ({ tx: null as unknown }));
vi.mock("../db/connection", async (importOriginal) => {
  const real = await importOriginal<typeof import("../db/connection")>();
  // getDb + getReadDb (phạm vi nhà máy đọc `factories` qua pool đọc) + getJobsDb ⇒ CÙNG giao dịch của ca
  return {
    ...real,
    getDb: (async () => (H.tx ? H.tx : real.getDb())) as typeof real.getDb,
    getReadDb: (async () => (H.tx ? H.tx : real.getReadDb())) as typeof real.getReadDb,
    getJobsDb: (async () => (H.tx ? H.tx : real.getJobsDb())) as typeof real.getJobsDb,
    __realGetDb: real.getDb,
  };
});

import * as conn from "../db/connection";
import { khoaMienLapTrinh, tienToMienLapTrinh } from "../services/programming/khoaMienLapTrinh";

const DB_URL = process.env.DATABASE_URL;
const RUN = `t6d${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof conn.getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
const ROLLBACK = Symbol("rollback");
const realGetDb = (conn as unknown as { __realGetDb: typeof conn.getDb }).__realGetDb;

interface Nm { fid: number; mid: number; proj: number; build: number; userId: number }
let A!: Nm;
let B!: Nm;
let cA: any, cB: any;
let soCa = 0;

async function seed(ten: string): Promise<Nm> {
  const code = `${RUN}${soCa}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code}) RETURNING id`);
  const [m] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${s.id}, ${code}, ${code}, 'AOI') RETURNING id`);
  // T6d fix 1 (review M3, dieu-phoi: test KHÔNG BAO GIỜ DELETE / TRUNCATE — dọn bằng ROLLBACK) — người dùng chèn TRONG giao dịch của ca (như các bảng
  // khác), không qua helper `taoNguoiDungTest` (helper đăng ký afterAll DELETE ngoài giao dịch)
  const [u] = await dung(sql`INSERT INTO users ("openId", username, name, role, "isActive") VALUES (${`t6d-${code}`}, ${`t6d-${code}`}, ${`T6D ${ten}`}, 'supervisor', true) RETURNING id`);
  await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  const [p] = await dung(sql`INSERT INTO program_projects (code, name, kind, "factoryId", "deviceId") VALUES (${code + "-P"}, ${"P" + ten}, 'stub', ${f.id}, ${m.id}) RETURNING id`);
  const [a] = await dung(sql`INSERT INTO program_artifacts ("projectId", branch, version, kind, language, content, "contentHash", status) VALUES (${p.id}, 'main', 1, 'stub', 'txt', ${"src-" + ten}, ${"h" + ten}, 'draft') RETURNING id`);
  const [b] = await dung(sql`INSERT INTO program_builds ("artifactId", "adapterKind", status, ok) VALUES (${a.id}, 'stub', 'ok', true) RETURNING id`);
  for (const mod of ["machine_status", "machine_control"]) {
    await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${u.id}, ${mod === "machine_status" ? "machine_monitoring" : mod}::permissioncategoryenum, ${mod}, true, true, true, true)`);
  }
  return { fid: f.id, mid: m.id, proj: p.id, build: b.id, userId: u.id };
}

const caller = async (id: number, name: string) =>
  (await import("./programmingRouter")).programmingRouter.createCaller({ user: { id, role: "supervisor", name, twoFactorEnabled: true } } as never);

const deploy = (c: any, buildId: number, idempotencyKey: string) =>
  c.deployBuild({ buildId, stage: "staging" as const, idempotencyKey, actionId: `${RUN}-act-${Math.random().toString(36).slice(2, 8)}`, totpCode: "" });

/** MỘT ca = MỘT giao dịch ROLLBACK: dựng hai nhà máy A / B + người dùng + dự án + build bên trong, chạy ca, rồi huỷ hết. */
async function moiCa(fn: () => Promise<void>): Promise<void> {
  const real = await realGetDb();
  if (!real) throw new Error("không có CSDL test");
  expect(DB_URL).toMatch(/_test/);
  soCa++;
  try {
    await real.transaction(async (tx) => {
      H.tx = tx;
      db = tx as unknown as Db;
      try {
        A = await seed("A");
        B = await seed("B");
        cA = await caller(A.userId, "T6D A");
        cB = await caller(B.userId, "T6D B");
        await fn();
      } finally {
        H.tx = null;
      }
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

describe.skipIf(!DB_URL)("★★★ T6d — khoá deploy của người / nhà máy KHÁC không bao giờ trả hàng của người kia", () => {
  it("★ A (nhà máy 1) deploy với khoá K; B (nhà máy 2) dùng CÙNG K ⇒ deploy của B CHẠY (hàng MỚI của B, build của B), không thấy hàng / kết quả của A, không CONFLICT", () =>
    moiCa(async () => {
    const K = `${RUN}-K`;
    const depA = await deploy(cA, A.build, K);
    const depB = await deploy(cB, B.build, K);
    expect(depB.id).not.toBe(depA.id);
    expect(depB.buildId).toBe(B.build);
    expect(depB.requestedBy).toBe(B.userId);
    expect(depB.deviceId).toBe(B.mid);
    expect(depA.idempotencyKey).toBe(khoaMienLapTrinh(A.userId, K));
    expect(depB.idempotencyKey).toBe(khoaMienLapTrinh(B.userId, K));
    // A phát lại CHÍNH khoá của mình ⇒ đúng hàng của A (idempotent hợp lệ giữ nguyên)
    expect((await deploy(cA, A.build, K)).id).toBe(depA.id);
    // B phát lại ⇒ hàng của B, không bao giờ của A
    expect((await deploy(cB, B.build, K)).id).toBe(depB.id);
    }), 60_000);

  it("khoá đụng tiền tố hệ con khác (`hmi:<uuid>`, `il-1-2`) ⇒ khoá LƯU luôn mang miền lập trình, không trùng khoá hệ con kia", () =>
    moiCa(async () => {
    for (const raw of [`hmi:${RUN}`, `il-${RUN}`]) {
      const dep = await deploy(cA, A.build, raw);
      expect(dep.idempotencyKey).toBe(khoaMienLapTrinh(A.userId, raw));
      expect(dep.idempotencyKey).not.toBe(raw);
    }
    }), 60_000);

  it("hàng khoá CŨ (trước T6d, chưa đặt miền) của A: B dùng khoá ấy ⇒ deploy MỚI của B (không lộ hàng của A); A dùng lại ⇒ đúng hàng cũ của A (tương thích)", () =>
    moiCa(async () => {
    const K2 = `${RUN}-K2`;
    const [cu] = await dung(
      sql`INSERT INTO program_deployments ("buildId", "projectId", "deviceId", stage, status, simulated, "requestedBy", "idempotencyKey") VALUES (${A.build}, ${A.proj}, ${A.mid}, 'staging', 'simulated', true, ${A.userId}, ${K2}) RETURNING id`,
    );
    const depB = await deploy(cB, B.build, K2);
    expect(depB.id).not.toBe(cu.id);
    expect(depB.buildId).toBe(B.build);
    expect(depB.idempotencyKey).toBe(khoaMienLapTrinh(B.userId, K2));
    const depA = await deploy(cA, A.build, K2);
    expect(depA.id).toBe(cu.id); // hàng cũ của CHÍNH A
    }), 60_000);

  it("A dùng lại khoá CỦA MÌNH cho yêu cầu KHÁC (build khác) ⇒ CONFLICT như trước (Doc 54 P3.4) — chỉ trong miền của A", () =>
    moiCa(async () => {
    const K3 = `${RUN}-K3`;
    await deploy(cB, B.build, K3); // khoá K3 của B không ảnh hưởng A
    await deploy(cA, A.build, K3);
    await expect(deploy(cA, B.build, K3)).rejects.toThrow(); // build của B ngoài phạm vi A ⇒ NOT_FOUND trước cả kiểm khoá
    // build khác TRONG phạm vi A: một artifact/build thứ hai của dự án A
    const [a2] = await dung(sql`INSERT INTO program_artifacts ("projectId", branch, version, kind, language, content, "contentHash", status) VALUES (${A.proj}, 'main', 2, 'stub', 'txt', 'src-A2', 'hA2', 'draft') RETURNING id`);
    const [b2] = await dung(sql`INSERT INTO program_builds ("artifactId", "adapterKind", status, ok) VALUES (${a2.id}, 'stub', 'ok', true) RETURNING id`);
    await expect(deploy(cA, b2.id, K3)).rejects.toMatchObject({ code: "CONFLICT" });
    }), 60_000);
  it("★ hàng TRƯỚC T6d của A mang ĐÚNG chuỗi khoá miền của B (`pd:u<B>:K`) ⇒ B KHÔNG BAO GIỜ nhận hàng của A (lọc requestedBy); lỗi không nêu khoá / build của A", () =>
    moiCa(async () => {
    const K4 = `${RUN}-K4`;
    const [cuA] = await dung(
      sql`INSERT INTO program_deployments ("buildId", "projectId", "deviceId", stage, status, simulated, "requestedBy", "idempotencyKey") VALUES (${A.build}, ${A.proj}, ${A.mid}, 'staging', 'simulated', true, ${A.userId}, ${khoaMienLapTrinh(B.userId, K4)}) RETURNING id`,
    );
    let ketQua: { id?: number } | null = null;
    let loi: { code?: string; message?: string } | null = null;
    try {
      ketQua = await deploy(cB, B.build, K4);
    } catch (e) {
      loi = e as { code?: string; message?: string };
    }
    expect(ketQua?.id).not.toBe(cuA.id); // không bao giờ hàng của A
    if (loi) {
      expect(loi.code).toBe("CONFLICT");
      expect(String(loi.message)).not.toContain(K4);
      expect(String(loi.message)).not.toContain(`#${A.build}`);
    }
    }), 60_000);

  it("rollback + rollout đội máy: khoá LƯU của từng lượt cũng ở miền người gọi (`khoaMienLapTrinh` / `tienToMienLapTrinh`)", () =>
    moiCa(async () => {
    const d1 = await deploy(cA, A.build, `${RUN}-R1`);
    const d2 = await deploy(cA, A.build, `${RUN}-R2`);
    expect(d2.id).toBeGreaterThan(d1.id);
    const RK = `${RUN}-RB`;
    const rb = await cA.rollbackDeployment({ deploymentId: d2.id, actionId: `${RUN}-act-rb`, idempotencyKey: RK, totpCode: "" });
    const [hangRb] = await dung(sql`SELECT "idempotencyKey", "requestedBy" FROM program_deployments WHERE id = ${rb.id}`);
    expect(hangRb.idempotencyKey).toBe(khoaMienLapTrinh(A.userId, RK));
    expect(hangRb.requestedBy).toBe(A.userId);
    const P = `${RUN}-FL`;
    const fl = await cA.deployToFleet({
      buildId: A.build,
      deviceIds: [A.mid],
      stage: "staging" as const,
      strategy: { canaryCount: 1, promoteOnVerified: false, autoRollbackOnMismatch: false },
      idempotencyKeyPrefix: P,
      actionId: `${RUN}-act-fl`,
      totpCode: "",
    });
    const idMay = fl.results[0]?.deploymentId;
    expect(typeof idMay).toBe("number");
    const [hangFl] = await dung(sql`SELECT "idempotencyKey" FROM program_deployments WHERE id = ${idMay}`);
    expect(hangFl.idempotencyKey).toBe(`${tienToMienLapTrinh(A.userId, P)}-dev${A.mid}`);
    }), 60_000);
});
