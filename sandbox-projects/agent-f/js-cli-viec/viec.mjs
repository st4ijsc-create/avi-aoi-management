#!/usr/bin/env node
import path from "node:path";
import { chay } from "./src/cli.mjs";

const ma = await chay(process.argv.slice(2), {
  ghi: (s) => process.stdout.write(s),
  loi: (s) => process.stderr.write(s),
  duongKho: process.env.VIEC_KHO || path.resolve("viec.json"),
});
process.exitCode = ma;
