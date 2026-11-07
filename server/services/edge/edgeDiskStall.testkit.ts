/**
 * Đĩa edge treo — TEST KIT: the journal's io over the REAL file system, with a hand on it. A hung call waits at the JS level (it holds no libuv
 * thread; the thread-pool side is measured apart, see the a2n report). `tha()` lets every hung call go on, in order. A temp-dir ledger the suites
 * empty in afterEach (no litter in %TEMP%).
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EdgeCentralClient, createEdgeAuthorizeClient } from "./edgeCentralClient";
import { EdgeConfigSource } from "./edgeConfigSource";
import { EdgeExecutionAgent, type EdgeAgentConfig, type EdgeDevicePort, type EdgeSegmentOutcome, type EdgeWalker } from "./edgeExecutionAgent";
import { FakeCentral, KIT_TOKEN, kitHashDefinition } from "./edgeFakeCentral.testkit";
import { EdgeJournal, nodeEdgeJournalIo, type EdgeJournalFile, type EdgeJournalIo } from "./edgeJournal";
import { EdgeProgramChecks, EdgeStreamShipper, createEdgeAuthUnusedReporter, createEdgeJournalConsume, createEdgeReportSink } from "./edgeStreams";

export interface DiskGia {
  io: EdgeJournalIo;
  dem: { write: number; sync: number; atomic: number; close: number; open: number; unlink: number };
  /** the next `sync` and every later one hang */
  treoSync(): void;
  /** the next `write` and every later one hang */
  treoWrite(): void;
  /** the next `writeFileAtomic` and every later one hang */
  treoAtomic(): void;
  /** the next call of this kind, and every later one, hangs */
  treoOp(op: "close" | "open" | "unlink"): void;
  /** every `sync` hangs from the first line holding `s` that is written (the line itself reaches the file) */
  treoSauKhiGhi(s: string): void;
  /** the next `sync` rejects, once (a real IO error) */
  loiSync(): void;
  /** the next `write` rejects, once (a real IO error) */
  loiWrite(): void;
  tha(): void;
}

export function diskGia(): DiskGia {
  const treo = { sync: false, write: false, atomic: false, close: false, open: false, unlink: false };
  const loi = { sync: false, write: false };
  let sauKhiGhi: string | null = null;
  let mo: () => void = () => undefined;
  let cho = new Promise<void>((r) => (mo = r));
  const dem = { write: 0, sync: 0, atomic: 0, close: 0, open: 0, unlink: 0 };
  const io: EdgeJournalIo = {
    ...nodeEdgeJournalIo,
    async openAppend(p: string): Promise<EdgeJournalFile> {
      dem.open++;
      if (treo.open) await cho;
      const f = await nodeEdgeJournalIo.openAppend(p);
      return {
        async write(data: string) {
          dem.write++;
          if (loi.write) {
            loi.write = false;
            throw new Error("EIO write");
          }
          if (treo.write) await cho;
          await f.write(data);
          if (sauKhiGhi !== null && data.includes(sauKhiGhi)) treo.sync = true;
        },
        async sync() {
          dem.sync++;
          if (loi.sync) {
            loi.sync = false;
            throw new Error("EIO fsync");
          }
          if (treo.sync) await cho;
          await f.sync();
        },
        async close() {
          dem.close++;
          if (treo.close) await cho;
          await f.close();
        },
      };
    },
    async unlink(file: string) {
      dem.unlink++;
      if (treo.unlink) await cho;
      await nodeEdgeJournalIo.unlink(file);
    },
    async writeFileAtomic(file: string, data: string) {
      dem.atomic++;
      if (treo.atomic) await cho;
      await nodeEdgeJournalIo.writeFileAtomic(file, data);
    },
  };
  return {
    io,
    dem,
    treoSync: () => void (treo.sync = true),
    treoWrite: () => void (treo.write = true),
    treoAtomic: () => void (treo.atomic = true),
    treoOp: (op) => void (treo[op] = true),
    treoSauKhiGhi: (s) => void (sauKhiGhi = s),
    loiSync: () => void (loi.sync = true),
    loiWrite: () => void (loi.write = true),
    tha: () => {
      treo.sync = treo.write = treo.atomic = treo.close = treo.open = treo.unlink = false;
      sauKhiGhi = null;
      mo();
      cho = new Promise<void>((r) => (mo = r));
    },
  };
}

/** Temp dirs of a suite: `mk()` in the test, `don()` in afterEach. */
export function thuMucTam() {
  const ds: string[] = [];
  return {
    async mk(tien = "a2n-"): Promise<string> {
      const d = await fs.mkdtemp(path.join(os.tmpdir(), tien));
      ds.push(d);
      return d;
    },
    async don(): Promise<void> {
      for (const d of ds.splice(0)) await fs.rm(d, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

export const nghi = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Polls until `fn()` holds, or throws naming `nhan`. */
export async function choDen(fn: () => boolean, nhan: string, ms = 5_000): Promise<void> {
  const het = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > het) throw new Error(`timed out waiting for: ${nhan}`);
    await nghi(5);
  }
}

export interface EdgeTrenDiaGia {
  central: FakeCentral;
  dia: DiskGia;
  clock: { t: number };
  journal: EdgeJournal;
  agent: EdgeExecutionAgent;
  shipper: EdgeStreamShipper;
  sink: ReturnType<typeof createEdgeReportSink>;
  client: EdgeCentralClient;
  config: EdgeConfigSource;
  authorize: ReturnType<typeof createEdgeAuthorizeClient>;
  /** the standing walker's outcome (absent when the caller gave its own walker) */
  tha(o: EdgeSegmentOutcome): void;
  /** everything down, the disk let go first; call once, in afterEach */
  dong(): Promise<void>;
}

/**
 * A real edge over a fake disk and FakeCentral: real journal, client, config source, shipper, authorize client, agent. By default a walker that stands
 * until `tha()`, and the test's clock on the journal and the agent (`clockThat` ⇒ Date.now, for the real walker's timing).
 */
export async function edgeTrenDiaGia(
  tam: ReturnType<typeof thuMucTam>,
  o: { accepts?: readonly string[] | null; central?: FakeCentral; walker?: EdgeWalker; devices?: EdgeDevicePort; clockThat?: boolean; dir?: string; dia?: DiskGia; authSyncTimeoutMs?: number; progressMs?: number; requestTimeoutMs?: number; maxConcurrent?: number } = {},
): Promise<EdgeTrenDiaGia> {
  const central = o.central ?? new FakeCentral();
  if (o.accepts !== undefined) central.accepts = o.accepts;
  const dia = o.dia ?? diskGia();
  const clock = { t: 1_800_000_000_000 };
  const now = o.clockThat ? Date.now : () => clock.t;
  const journal = await EdgeJournal.open({ dir: o.dir ?? (await tam.mk()), io: dia.io, now, groupCommitMs: 0, authSyncTimeoutMs: o.authSyncTimeoutMs ?? 30, stopBoundMs: 30, log: () => undefined });
  const client = new EdgeCentralClient({ centralUrl: "http://central.test", credential: KIT_TOKEN, requestTimeoutMs: 2_000, fetchImpl: central.fetchImpl, log: () => undefined });
  const config = await EdgeConfigSource.create({ client, pin: central.pin as never, nodeId: central.nodeId, credentialId: central.credentialId, credential: KIT_TOKEN, dir: await tam.mk() });
  const r = await config.refresh();
  if (!r.ok) throw new Error(`config refresh refused: ${r.reason}`);
  const shipper = new EdgeStreamShipper(journal, client);
  const sink = createEdgeReportSink(journal, (s) => shipper.nudge(s));
  const consume = createEdgeJournalConsume(journal);
  const programChecks = new EdgeProgramChecks({ config, client, read: async () => ({ status: "unsupported", source: "stub" }) });
  const authorize = createEdgeAuthorizeClient({
    client,
    trust: () => config.trust(),
    credentialId: () => config.credentialId(),
    maxTtlMs: () => 10_000,
    isJtiConsumed: (j) => journal.isJtiConsumed(j),
    programChecks: () => programChecks.latest(),
    anomaly: () => undefined,
    unused: createEdgeAuthUnusedReporter(journal, sink),
  });
  let tha: (x: EdgeSegmentOutcome) => void = () => undefined;
  const dungYen = new Promise<EdgeSegmentOutcome>((res) => (tha = res));
  const walker: EdgeWalker = o.walker ?? { drive: () => dungYen, abortLive: async () => ({ live: true }) };
  const devices: EdgeDevicePort = o.devices ?? { stopRobot: async () => ({ outcome: "sent" }), stopAdapter: async () => ({ outcome: "sent" }), lockRobot: async () => ({ ok: true, generation: 1 }), clearRobot: async () => ({ ok: true, generation: 1 }) };
  const cfg: EdgeAgentConfig = { centralUrl: "http://central.test", credential: KIT_TOKEN, pullIntervalMs: 200, progressMs: o.progressMs ?? 10, maxConcurrent: o.maxConcurrent ?? 2, requestTimeoutMs: o.requestTimeoutMs ?? 100, stopResendMinMs: 1_000, now };
  const agent = new EdgeExecutionAgent(cfg, { client, config, journal, shipper, sink, consume, authorize, programChecks, walker, devices, hashDefinition: kitHashDefinition });
  return {
    central,
    dia,
    clock,
    journal,
    agent,
    shipper,
    sink,
    client,
    config,
    authorize,
    tha: (x) => tha(x),
    dong: async () => {
      dia.tha();
      tha({ outcome: "completed" });
      await agent.stop();
      await shipper.stop();
      await agent.idle();
      await journal.close();
    },
  };
}
