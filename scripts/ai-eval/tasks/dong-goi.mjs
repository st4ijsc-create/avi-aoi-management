/**
 * Sinh `tasks/<stack>/<id>/{prompt.md, bai.json, check.mjs}` từ bộ cũ (tasks-hard, tasks-api2, agent-f). Bộ cũ vẫn là nguồn sự thật của đề và
 * bài kiểm ẩn, `run.mjs` / `run-f.mjs` chạy y nguyên. Bài pilot TC-xx viết tay (đột biến trong check.mjs), tệp này không đụng.
 *
 *   node scripts/ai-eval/tasks/dong-goi.mjs           ghi
 *   node scripts/ai-eval/tasks/dong-goi.mjs --kiem    không ghi; thoát 1 nếu thiếu bài hoặc tệp lệch nguồn
 */
import fs from "node:fs";
import { BENCH_CODEGEN, TASKS } from "./lib/chung.mjs";

const CHECK = 'import { chayCheck } from "../../lib/chay.mjs";\n\nprocess.exit(await chayCheck(import.meta.url));\n';
const docJson = (rel) => JSON.parse(fs.readFileSync(`${BENCH_CODEGEN}/${rel}`, "utf8"));

function danhSach() {
  const ra = [];
  for (const t of docJson("tasks-hard.json")) {
    ra.push({ stack: t.lang, id: t.id, prompt: t.prompt, bai: { id: t.id, kieu: "ma-don", bo: "tasks-hard", lang: t.lang, ten: t.name, nguon: { tep: "tasks-hard.json", id: t.id }, canDb: false } });
  }
  // canDb = CSDL của repo. Bài pgsql / tsql / `pg: true` dùng cụm PostgreSQL riêng và LocalDB riêng dựng xong vứt (cham.mjs), không chạm `_test` hay DEV.
  for (const t of docJson("tasks-api2.json")) {
    ra.push({ stack: t.nhom, id: t.id, prompt: t.prompt, bai: { id: t.id, kieu: "ma-don", bo: "tasks-api2", lang: t.lang, ten: t.name, nguon: { tep: "tasks-api2.json", id: t.id }, canDb: false } });
  }
  // (11/11, NC-8) bài `nhom: "dai"` (việc dài, nhiều tệp) vào bộ RIÊNG `agent-dai`: `--bo agent-f` vẫn đúng 6 bài cũ, so được với các đêm trước.
  for (const t of docJson("agent-f/bai.json")) {
    const duAn = `sandbox-projects/agent-f/${t.id}`;
    ra.push({ stack: t.lang, id: t.id, prompt: t.cauHoi.replaceAll("{DA}", duAn), bai: { id: t.id, kieu: "agent-f", bo: t.nhom === "dai" ? "agent-dai" : "agent-f", lang: t.lang, ten: t.moTa, nguon: { tep: "agent-f/bai.json", id: t.id }, duAn, canDb: false } });
  }
  return ra;
}

const kiem = process.argv.includes("--kiem");
const lech = [];
const ds = danhSach();
for (const x of ds) {
  const dir = `${TASKS}/${x.stack}/${x.id}`;
  const tep = { "prompt.md": `${x.prompt.trimEnd()}\n`, "bai.json": `${JSON.stringify(x.bai, null, 2)}\n`, "check.mjs": CHECK };
  for (const [ten, noiDung] of Object.entries(tep)) {
    const p = `${dir}/${ten}`;
    if (kiem) {
      if (!fs.existsSync(p) || fs.readFileSync(p, "utf8") !== noiDung) lech.push(`${x.stack}/${x.id}/${ten}`);
    } else {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(p, noiDung);
    }
  }
}
console.log(JSON.stringify({ bai: ds.length, lech }));
process.exit(lech.length ? 1 : 0);
