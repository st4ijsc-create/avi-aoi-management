import fs from "node:fs";
import { trichMaST } from "../../../../server/services/ai/st/trichMaST";
import { ghepMaST, chanDoanTheoKhoi } from "../../../../server/services/ai/st/kiemBienDichSt";
import { bienDichST } from "../../../../server/services/flow/lib/bienDichST";
// @ts-expect-error mjs
import { trichTep } from "../lib/trichTep.mjs";
// @ts-expect-error mjs
import { docKho } from "../lib/kho.mjs";
// @ts-expect-error mjs
import { chayST } from "../lib/st/chayST.mjs";
const h = JSON.parse(fs.readFileSync("scripts/ai-eval/ngau-nhien/reports/PLC-v1-ab-kiem-q36-27b-1.json", "utf8")).rows;
const bai = docKho({ only: "st-tt7-bcd" })[0];
for (const r of h.filter((x: any) => x.id === "st-tt7-bcd" && x.nhanh === "bat").slice(0, 2)) {
  const t = String(r.vanBanGoc).split("\n---\n")[0];
  const k = trichMaST(t); const g = ghepMaST(k);
  const kq = await bienDichST(g.ma);
  console.log(`== H#${r.luot}: khối ${k.length}, đường /v1: ok=${kq.ok}`);
  for (const d of chanDoanTheoKhoi(kq.chanDoan, g.bang, k.length).filter((d: any) => d.mucDo === "error").slice(0, 4)) console.log("   ", d.tep, d.dong, d.ma, d.thongDiep.slice(0, 100));
  const tr = trichTep(t, bai);
  const dir = fs.mkdtempSync("tmp/m-");
  fs.mkdirSync(`${dir}/src`, { recursive: true });
  const tep: any[] = [];
  for (const [rel, nd] of Object.entries(tr.tep)) { if (!/^src\/[^/]+\.st$/i.test(rel)) continue; fs.writeFileSync(`${dir}/${rel}`, nd as string); tep.push({ ten: rel, duong: `${process.cwd()}/${dir}/${rel}` }); }
  fs.writeFileSync(`${dir}/_main.st`, "FUNCTION main : DINT\n    main := 0;\nEND_FUNCTION\n"); tep.push({ ten: "_main.st", duong: `${process.cwd()}/${dir}/_main.st` });
  const m = await chayST({ tep, thuMucViec: `${process.cwd()}/tmp/_st-jobs`, giayChay: 5 });
  console.log(`   đường M (vòng sửa mot-luot): giaiDoan=${m.giaiDoan} ok=${m.ok}`, (m.chanDoan ?? []).filter((d: any) => d.mucDo === "error").slice(0, 4).map((d: any) => `${d.tep}:${d.dong} ${d.ma} ${String(d.thongDiep).slice(0, 80)}`).join(" | "));
}
process.exit(0);
