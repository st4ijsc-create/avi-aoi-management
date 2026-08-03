import { execFile } from "node:child_process";

const INSTANCE_RE = /^pid_(\d+)_luid_(0x[0-9a-f]+)_(0x[0-9a-f]+)_phys_\d+$/i;

export interface VramProcessSample {
  readonly totalBytes: number;
  readonly byPid: ReadonlyMap<number, number>;
  readonly byLuid: ReadonlyMap<string, number>;
  readonly sampledAtMs: number;
}
export interface RawProcRow { readonly pid: number; readonly ppid: number }

export function collectDescendants(procs: readonly RawProcRow[], roots: readonly number[]): Set<number> {
  const childrenOf = new Map<number, number[]>();
  for (const row of procs) {
    const list = childrenOf.get(row.ppid);
    if (list) list.push(row.pid);
    else childrenOf.set(row.ppid, [row.pid]);
  }
  const seen = new Set<number>();
  const stack = [...roots];
  while (stack.length > 0) {
    const pid = stack.pop()!;
    if (seen.has(pid)) continue; // cat vong, khong treo
    seen.add(pid);
    for (const child of childrenOf.get(pid) ?? []) stack.push(child);
  }
  return seen;
}

export function parseProcessCounters(rawJson: string, roots: readonly number[], nowMs: number): VramProcessSample | null {
  let parsed: { counters?: unknown; procs?: unknown };
  try {
    parsed = JSON.parse(rawJson) as typeof parsed;
  } catch {
    return null;
  }
  const counters = Array.isArray(parsed.counters) ? parsed.counters : [];
  const procsRaw = Array.isArray(parsed.procs) ? parsed.procs : [];
  const procs: RawProcRow[] = [];
  for (const row of procsRaw) {
    const r = row as { pid?: unknown; ppid?: unknown };
    if (typeof r.pid === "number" && typeof r.ppid === "number") procs.push({ pid: r.pid, ppid: r.ppid });
  }
  const wanted = collectDescendants(procs, roots);

  const byPid = new Map<number, number>();
  const byLuid = new Map<string, number>();
  let totalBytes = 0;
  for (const row of counters) {
    const c = row as { i?: unknown; v?: unknown };
    if (typeof c.i !== "string" || typeof c.v !== "number" || !Number.isFinite(c.v)) continue;
    const m = INSTANCE_RE.exec(c.i);
    if (!m) continue;
    const pid = Number(m[1]);
    if (!wanted.has(pid)) continue;
    const bytes = Math.max(0, Math.round(c.v));
    const luid = `${m[2].toLowerCase()}_${m[3].toLowerCase()}`;
    byPid.set(pid, (byPid.get(pid) ?? 0) + bytes);
    byLuid.set(luid, (byLuid.get(luid) ?? 0) + bytes);
    totalBytes += bytes;
  }
  return { totalBytes, byPid, byLuid, sampledAtMs: nowMs };
}

const PS_SCRIPT = [
  "$ErrorActionPreference='Stop';",
  "$c=(Get-Counter '\\GPU Process Memory(*)\\Dedicated Usage').CounterSamples|",
  "ForEach-Object{ @{ i=$_.InstanceName; v=[double]$_.CookedValue } };",
  "$p=Get-CimInstance Win32_Process|ForEach-Object{ @{ pid=[int]$_.ProcessId; ppid=[int]$_.ParentProcessId } };",
  "@{counters=$c;procs=$p}|ConvertTo-Json -Depth 4 -Compress",
].join(" ");

const PROBE_TIMEOUT_MS = 10_000;
let warnedUnavailable = false;

export function readProcessVram(roots: readonly number[]): Promise<VramProcessSample | null> {
  if (roots.length === 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", PS_SCRIPT],
      { timeout: PROBE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err) {
          if (!warnedUnavailable) {
            warnedUnavailable = true;
            console.warn(`[VRAM] dau do theo tien trinh khong dung duoc (${err.message}) — quay ve danh dau measureFailed`);
          }
          resolve(null);
          return;
        }
        resolve(parseProcessCounters(stdout, roots, Date.now()));
      },
    );
  });
}
