/**
 * Đĩa edge treo — TEST KIT: the journal's io over the REAL file system, with a hand on it. A hung call waits at the JS level (it holds no libuv
 * thread; the thread-pool side is measured apart, see the a2n report). `tha()` lets every hung call go on, in order. A temp-dir ledger the suites
 * empty in afterEach (no litter in %TEMP%).
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { nodeEdgeJournalIo, type EdgeJournalFile, type EdgeJournalIo } from "./edgeJournal";

export interface DiskGia {
  io: EdgeJournalIo;
  dem: { write: number; sync: number; atomic: number };
  /** the next `sync` and every later one hang */
  treoSync(): void;
  /** the next `write` and every later one hang */
  treoWrite(): void;
  /** the next `writeFileAtomic` and every later one hang */
  treoAtomic(): void;
  /** every `sync` hangs from the first line holding `s` that is written (the line itself reaches the file) */
  treoSauKhiGhi(s: string): void;
  /** the next `sync` rejects, once (a real IO error) */
  loiSync(): void;
  /** the next `write` rejects, once (a real IO error) */
  loiWrite(): void;
  tha(): void;
}

export function diskGia(): DiskGia {
  const treo = { sync: false, write: false, atomic: false };
  const loi = { sync: false, write: false };
  let sauKhiGhi: string | null = null;
  let mo: () => void = () => undefined;
  let cho = new Promise<void>((r) => (mo = r));
  const dem = { write: 0, sync: 0, atomic: 0 };
  const io: EdgeJournalIo = {
    ...nodeEdgeJournalIo,
    async openAppend(p: string): Promise<EdgeJournalFile> {
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
        close: () => f.close(),
      };
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
    treoSauKhiGhi: (s) => void (sauKhiGhi = s),
    loiSync: () => void (loi.sync = true),
    loiWrite: () => void (loi.write = true),
    tha: () => {
      treo.sync = treo.write = treo.atomic = false;
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
