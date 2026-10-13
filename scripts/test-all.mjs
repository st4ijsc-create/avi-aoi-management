#!/usr/bin/env node
/**
 * doc 81 Đợt 10 final fix wave residual 2 (ruling R-10-bu) — `npm run test:all`: the default vitest run AND the serial project
 * (vitest.serial.config.ts: the suites that change shared `_test` state for minutes, one file at a time). The serial run goes even
 * when the default run fails; the exit code is non-zero when EITHER failed (the first non-zero code). `npm test` stays plain
 * `vitest run` (file arguments keep working — CI gates pass them). No dependency beyond vitest itself.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const DEFAULT_RUN = ["vitest", "run"];
export const SERIAL_RUN = ["vitest", "run", "--config", "vitest.serial.config.ts"];

/** `runner(args)` runs `npx <args…>` and returns its exit code. Both runs always happen. */
export async function runAll(runner) {
  const a = await runner([...DEFAULT_RUN]);
  const b = await runner([...SERIAL_RUN]);
  return a !== 0 ? a : b;
}

function npx(args) {
  const r = spawnSync("npx", args, { stdio: "inherit", shell: process.platform === "win32" });
  return r.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runAll(npx).then((code) => process.exit(code));
}
