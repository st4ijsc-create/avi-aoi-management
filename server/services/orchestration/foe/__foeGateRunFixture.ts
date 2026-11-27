/**
 * doc 81 Đợt 4 fix round 1 (R-4-i) — TEST FIXTURE (DB `_test` only): a real orchestration workflow + run + gate row, so
 * the dispatchers' DB layer (foeGateApproval.foeApprovalDbRefusal) has real rows to re-derive the run owner and the gate
 * approver from. Not imported by product code.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { expect } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { orchestrationRunSteps, orchestrationRuns, orchestrationWorkflows } from "../../../../drizzle/schema";
import { FOE_APPROVAL_SOURCE_SERVER, computeBindingDigest, hashWorkflowDefinition } from "./foeGateApproval";
import { orchestrationRunsWithApiKey } from "./runApiKeyIdentity";
import { edgeAssignedRunIdsAmong } from "../../edge/edgeExecutionSchema";
import type { WorkflowDefinition } from "./workflowModel";

export interface FoeGateRunFixture {
  runId: number;
  workflowId: number;
  cleanup: () => Promise<void>;
}

export async function makeFoeGateRun(opts: {
  tag: string;
  owner: number | null;
  /** null ⇒ no gate row at all. */
  approvedBy: number | null;
  source?: string;
  /** true ⇒ the gate's defHash does not match the deployed definition (a redeploy happened after the approval). */
  stale?: boolean;
  /** doc 81 Đợt 8 O2 — steps after the gate (e.g. an OT command on a sim adapter whose program checksum the digest covers). */
  steps?: WorkflowDefinition["steps"];
  /**
   * doc 81 Đợt 9 R fix 1 — an API-started run: the run's paramsJson / contextJson carry the API marker and, when given, the
   * key is written IN THE INSERT (mig 0369 refuses every later update of the column).
   */
  api?: { keyId: number | null };
}): Promise<FoeGateRunFixture> {
  const d = await getDb();
  if (!d) throw new Error("no db");
  const def: WorkflowDefinition = { ref: `${opts.tag}-wf`.slice(0, 120), name: opts.tag, steps: [{ id: "g0", type: "hitl_gate", prompt: "fixture" }, ...(opts.steps ?? [])] };
  const [wf] = await d.insert(orchestrationWorkflows).values({ ref: def.ref, name: def.name, definitionJson: def, status: "active" }).returning();
  const base = {
    workflowId: wf.id,
    workflowRef: def.ref,
    status: "running" as const,
    paramsJson: opts.api ? { __foeStartedViaApi: true } : {},
    contextJson: opts.api ? { startedViaApi: true } : {},
    startedBy: opts.owner,
    startedAt: new Date(),
  };
  const [run] =
    opts.api && opts.api.keyId !== null
      ? await d.insert(orchestrationRunsWithApiKey).values({ ...base, startedViaApiKeyId: opts.api.keyId }).returning()
      : await d.insert(orchestrationRuns).values(base).returning();
  if (opts.approvedBy !== null) {
    await d.insert(orchestrationRunSteps).values({
      runId: run.id,
      stepId: "g0",
      stepType: "hitl_gate",
      status: "completed",
      attempt: 0,
      resultJson: {
        approved: true,
        approvedBy: opts.approvedBy,
        approvalSource: opts.source ?? FOE_APPROVAL_SOURCE_SERVER,
        defHash: opts.stale ? "0".repeat(64) : hashWorkflowDefinition(def),
        bindingDigest: await computeBindingDigest(d, def), // doc 81 Đợt 5 task E3
      },
      finishedAt: new Date(),
    });
  }
  return {
    runId: run.id,
    workflowId: wf.id,
    cleanup: async () => {
      await d.delete(orchestrationRunSteps).where(eq(orchestrationRunSteps.runId, run.id));
      await d.delete(orchestrationRuns).where(inArray(orchestrationRuns.id, [run.id]));
      await d.delete(orchestrationWorkflows).where(eq(orchestrationWorkflows.id, wf.id));
    },
  };
}

/** TEST-DB-RUN-SOT — the statuses the FOE boot scan takes (foeEngine rehydrateInterruptedRuns: activeStatuses). */
const TRANG_THAI_QUET_BOOT = ["queued", "running", "compensating"] as const;
/** TEST-DB-RUN-SOT — the bound of each read of chanRunSot (RUN-SOT-POOL). */
export const HAN_DOC_RUN_SOT_MS = 10_000;

/**
 * TEST-DB-RUN-SOT (HST 27/11) — before a DB case runs the FOE boot scan (rehydrateInterruptedRuns): the runs that scan would take besides the
 * case's own — queued / running / compensating, not assigned to an edge node (the product's own edgeAssignedRunIdsAmong). The scan takes them
 * whatever FOE_DURABLE says (queued / running ⇒ held; compensating ⇒ failed, or held / re-sent once); FOE_DURABLE only adds continuing them.
 * Read on `doc`: in a case, the POOL (it sees COMMITTED rows only, so the case's own runs are not there); the case's transaction only in the
 * self-tests (RUN-SOT-DOC-QUA-TX). Any ⇒ THROWS naming each as "#<id> <status>;" and the scan is not run. Reads only: one SELECT, plus one of
 * the edge assignments when a run is found. Writes nothing. Each read is bounded by `hanMs` (RUN-SOT-POOL: the case's transaction holds one
 * connection of the pool; with none free the read would wait until the case's own timeout) ⇒ it THROWS "RUN-SOT-POOL (…)" instead.
 */
export async function chanRunSot(doc: { select: (...a: any[]) => any }, ten: string, hanMs = HAN_DOC_RUN_SOT_MS): Promise<void> {
  const coHan = async <T>(viec: PromiseLike<T>, cai: string): Promise<T> => {
    let t: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve(viec),
        new Promise<never>((_, rej) => {
          t = setTimeout(() => rej(new Error(`RUN-SOT-POOL (${ten}): ${cai} did not answer in ${hanMs} ms (no free pool connection? DB_POOL_MAX) — the boot scan is NOT run.`)), hanMs);
        }),
      ]);
    } finally {
      if (t !== undefined) clearTimeout(t);
    }
  };
  const hang: Array<{ id: number; status: string }> = await coHan(
    doc
      .select({ id: orchestrationRuns.id, status: orchestrationRuns.status })
      .from(orchestrationRuns)
      .where(inArray(orchestrationRuns.status, [...TRANG_THAI_QUET_BOOT])),
    "the read of the runs",
  );
  if (hang.length === 0) return;
  const edge = await coHan(edgeAssignedRunIdsAmong(doc, hang.map((h) => h.id)), "the read of the edge assignments");
  const sot = hang.filter((h) => !edge.has(h.id)).sort((a, b) => a.id - b.id);
  if (sot.length === 0) return;
  throw new Error(
    `TEST-DB-RUN-SOT (${ten}): the boot scan is NOT run — it would take ${sot.length} run(s) this case did not make: ${sot.map((h) => `#${h.id} ${h.status};`).join(" ")} Count them read-only and tell chu-du-an-HST; never delete them.`,
  );
}

// ── TEST-DB-TAY-CAM-CU (HST 28/11, taycam-ket-luan-1.md §4 A + A′) — một lệnh SQL qua tay cầm giao dịch của một ca ĐÃ KẾT THÚC không bao giờ tới DB ──
/* eslint-disable @typescript-eslint/no-explicit-any */
// Vì sao: postgres.js chạy lệnh trên giao dịch đã xong trên chính kết nối đó, đã về pool (postgres/src/index.js:291-296) ⇒ CÓ THỂ tự commit vào `_test`
// (command_log là WORM), CÓ THỂ nhập giao dịch của ca kế. Hôm nay 0 lệnh như vậy (lượt thăm dò 28/11), nhưng chỉ vì fork đóng trước khi các hẹn giờ
// ghi thiết bị treo bắn (TAYCAM-AN-TOAN-NHO-FORK-DONG). Móc này CHẶN mọi lệnh như vậy và ghi lại; afterAll cấp tệp đòi danh sách rỗng ⇒ đỏ có tên.
/** chụp lúc nạp module: vi.useFakeTimers() thay process.hrtime bằng hàm mới, bản đã chụp vẫn là bản gốc */
const dongHoGoc = process.hrtime.bigint.bind(process.hrtime);
/** khung của lời gọi ĐỒNG BỘ trên tay cầm (select / insert / execute / transaction …): async stack của V8 mất khung sản phẩm ở client.unsafe */
const khungLucGoi = new AsyncLocalStorage<string>();
const PHUONG_THUC_TAY_CAM = ["select", "selectDistinct", "selectDistinctOn", "insert", "update", "delete", "execute", "$count", "with", "$with", "refreshMaterializedView"] as const;

/** stack sâu 40 khung, trả lại giới hạn cũ ngay sau đó: khung `server/` không bị khung drizzle / postgres.js đẩy mất */
function chupStack(): string {
  const cu = Error.stackTraceLimit;
  Error.stackTraceLimit = 40;
  try {
    return String(new Error().stack);
  } finally {
    Error.stackTraceLimit = cu;
  }
}

/** tối đa 10 khung có `server/`, bỏ khung của chính fixture; không có ⇒ 3 khung đầu không thuộc node: */
function locKhung(stack: string): string[] {
  const dong = stack.split("\n").slice(1).map((d) => d.trim().replace(/\\/g, "/"));
  const ra: string[] = [];
  for (const d of dong) {
    const i = d.indexOf("/server/");
    if (i < 0 || d.includes("__foeGateRunFixture")) continue;
    const ten = /^at (?:async )?([^\s(]+) \(/.exec(d)?.[1];
    ra.push(d.slice(i + 1).replace(/\)$/, "") + (ten ? ` ${ten}` : ""));
    if (ra.length >= 10) break;
  }
  if (ra.length > 0) return ra;
  return dong.filter((d) => !d.includes("(node:") && !d.startsWith("at node:") && !d.includes("__foeGateRunFixture")).slice(0, 3);
}

/** Một lệnh bị chặn. */
export interface LenhMuonTayCam {
  /** giao dịch thứ mấy của tệp (1 = đầu tiên) và tên ca chủ của nó */
  so: number;
  caChu: string;
  /** ca đang chạy lúc lệnh tới (theo vitest) */
  caLuc: string;
  /** truoc-rollback: lệnh hôm nay vẫn rơi vào giao dịch; sau-rollback: hôm nay CÓ THỂ tự commit / nhập giao dịch ca kế */
  luc: "truoc-rollback" | "sau-rollback";
  /** ms kể từ khi ca kết thúc */
  ms: number;
  loai: "unsafe" | "savepoint";
  /** 0 = giao dịch của ca; > 0 = savepoint lồng */
  tang: number;
  /** savepoint chứa lệnh còn mở ⇒ postgres.js sẽ tự phát `rollback to` trên kết nối cũ (cận trên: sản phẩm có thể tự bắt lỗi) */
  savepointDangMo: boolean;
  /** 120 ký tự đầu của SQL, không tham số */
  cau: string;
  nguonKhung: "goi" | "unsafe";
  khung: string[];
}

const tayCamTep = new Map<string, { giaoDich: number; lenhMuon: LenhMuonTayCam[] }>();
function tayCamTC(tep: string) {
  let t = tayCamTep.get(tep);
  if (!t) {
    t = { giaoDich: 0, lenhMuon: [] };
    tayCamTep.set(tep, t);
  }
  return t;
}

/** Số giao dịch đã gài và các lệnh đã bị chặn của một tệp (afterAll cấp tệp đọc). */
export function tayCamCuaTep(tep: string): { giaoDich: number; lenhMuon: readonly LenhMuonTayCam[] } {
  return tayCamTC(tep);
}

export type MocTayCam = { ketThuc(): void; daRollback(): void };

/**
 * Gọi NGAY sau `H.tx = tx;`. Thay `client` của session của tx (và của mọi giao dịch lồng, khi chúng mở) bằng một Proxy có CỜ CHẾT: còn sống ⇒ đi
 * client thật, y như cũ; sau `ketThuc()` ⇒ ghi một bản ghi rồi từ chối "TAY-CAM-CU …". Proxy đặt ngay lúc gài nên mọi PreparedQuery dựng trong ca
 * (kể cả `tx.execute(…)` dựng trước, await sau: pg-core/db.js:276) giữ Proxy, không giữ client thật.
 */
export function gaiTayCam(tx: unknown, tep: string): MocTayCam {
  const t = tayCamTC(tep);
  const so = ++t.giaoDich;
  const caChu = expect.getState().currentTestName ?? "(ngoài ca)";
  const trangThai = { chet: false, t0: 0n, luc: "truoc-rollback" as LenhMuonTayCam["luc"] };

  const tuChoi = (loai: LenhMuonTayCam["loai"], cau: string, tang: number, spDangMo: boolean): Error => {
    const khungGoi = khungLucGoi.getStore();
    t.lenhMuon.push({
      so,
      caChu,
      caLuc: expect.getState().currentTestName ?? "(ngoài ca)",
      luc: trangThai.luc,
      ms: Math.round(Number(dongHoGoc() - trangThai.t0) / 1e5) / 10,
      loai,
      tang,
      savepointDangMo: tang > 0 && spDangMo,
      cau: cau.replace(/\s+/g, " ").slice(0, 120),
      nguonKhung: khungGoi ? "goi" : "unsafe",
      khung: locKhung(khungGoi ?? chupStack()),
    });
    return new Error(`TAY-CAM-CU (${tep} #${so} ${caChu}): a statement on the handle of a finished case transaction was refused — it would have run outside the case's ROLLBACK`);
  };

  /** `tang` 0 = giao dịch của ca; > 0 = savepoint lồng. `sp.dangMo`: callback của savepoint chưa xong. */
  const boc = (session: { client: any }, tang: number, sp: { dangMo: boolean }) => {
    const that = session.client;
    session.client = new Proxy(that, {
      get(dich, k) {
        if (k === "unsafe")
          return (q: string, ...r: unknown[]) => {
            if (!trangThai.chet) return dich.unsafe(q, ...r);
            const loi = tuChoi("unsafe", String(q), tang, sp.dangMo);
            const tu = () => Promise.reject(loi); // lười: chỉ ai await mới nhận lời từ chối, móc không tạo lời từ chối mồ côi
            return { then: (a?: any, b?: any) => tu().then(a, b), catch: (b?: any) => tu().catch(b), finally: (f?: any) => tu().finally(f), values: tu, execute: tu };
          };
        if (k === "savepoint")
          return (...r: unknown[]) => (trangThai.chet ? Promise.reject(tuChoi("savepoint", "SAVEPOINT", tang, sp.dangMo)) : dich.savepoint(...r));
        const v = Reflect.get(dich, k);
        return typeof v === "function" ? v.bind(dich) : v;
      },
    });
  };

  const theoDoi = (h: any, tang: number, sp: { dangMo: boolean }) => {
    boc(h.session, tang, sp);
    for (const m of PHUONG_THUC_TAY_CAM) {
      const g = h[m];
      if (typeof g !== "function") continue;
      h[m] = function (this: unknown, ...a: unknown[]) {
        if (trangThai.chet) khungLucGoi.enterWith(chupStack());
        return g.apply(this, a);
      };
    }
    const gTx = h.transaction;
    h.transaction = function (this: unknown, fn: (con: unknown) => unknown, ...r: unknown[]) {
      if (trangThai.chet) khungLucGoi.enterWith(chupStack());
      const spCon = { dangMo: true };
      const p = gTx.call(this, (con: unknown) => {
        theoDoi(con, tang + 1, spCon);
        return fn(con);
      }, ...r) as Promise<unknown>;
      // lời hứa DẪN XUẤT ném lại lỗi: không bắt hộ ⇒ một lời từ chối không ai bắt vẫn là Unhandled Rejection như khi không có móc
      return p.then(
        (v) => {
          spCon.dangMo = false;
          return v;
        },
        (e: unknown) => {
          spCon.dangMo = false;
          throw e;
        },
      );
    };
  };
  theoDoi(tx, 0, { dangMo: true });

  return {
    ketThuc() {
      trangThai.chet = true;
      trangThai.t0 = dongHoGoc();
    },
    daRollback() {
      trangThai.luc = "sau-rollback";
    },
  };
}

/**
 * TEST-DB-TAY-CAM-CU A′ — đồng hồ cát: mốc của lần ghi thiết bị TREO đầu tiên của tệp (hẹn giờ otDeviceWrite.ts:1352 bắt đầu cùng lúc). afterAll cấp
 * tệp đòi `msTuMocDau() < han / 2`: tệp mọc dài thêm (máy chậm, thêm ca sau ca treo) đỏ có tên TRƯỚC khi hẹn giờ kịp bắn trong fork. `dongHo` (ns): chỉ
 * tệp tự kiểm truyền đồng hồ giả; mặc định là process.hrtime.bigint gốc (fake timers không lệch).
 */
export function taoDongHoCat(dongHo: () => bigint = dongHoGoc): { danhDau(): void; msTuMocDau(): number | null } {
  let moc: bigint | null = null;
  return {
    danhDau() {
      if (moc === null) moc = dongHo();
    },
    msTuMocDau() {
      return moc === null ? null : Math.round(Number(dongHo() - moc) / 1e6);
    },
  };
}
