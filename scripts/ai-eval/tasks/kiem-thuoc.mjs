/**
 * KIỂM THƯỚC toàn bộ bài, không gọi model: mỗi bài chạy check.mjs với lời giải đúng (phải thoát 0) và lời giải sai (phải thoát 1).
 * Thoát 2 ở bất kỳ đâu = thước hỏng. Không thoả ⇒ vứt mọi số đo của bộ.
 *
 *   node scripts/ai-eval/tasks/kiem-thuoc.mjs [--only <id,…|stack|bộ>] [--ra <tệp json>]
 *
 * ma-don chạy song song 3 (thư mục tạm riêng). pilot-repo chạy tuần tự vì đột biến sửa cây tại chỗ.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { danhSachBai, thamSo } from "./lib/chung.mjs";

const CHE_DO = {
  "ma-don": [["ok", 0], ["bad", 1]],
  "agent-f": [["mau", 0], ["goc", 1], ["gian-lan", 1]],
  "pilot-repo": [["mau", 0], ["goc", 1], ["gian-lan", 1]],
};

const { lay } = thamSo();
const only = lay("--only")?.split(",");
const ds = danhSachBai().filter((b) => !only || only.some((o) => o === b.id || o === b.stack || o === b.bo));

function chayMot(b, cheDo, kyVong) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [`${b.dir}/check.mjs`, "--kiem-thuoc", cheDo], { windowsHide: true });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (out += d));
    c.on("close", (ma) => {
      const dong = out.trim().split(/\r?\n/).pop() ?? "";
      let kq = null;
      try {
        kq = JSON.parse(dong);
      } catch {
        /* giữ null: in đuôi đầu ra */
      }
      const dung = ma === kyVong;
      const hang = { id: b.id, stack: b.stack, bo: b.bo, cheDo, kyVong, ma, dung, lyDo: kq?.lyDo ?? null, tests: kq?.tests, dotBien: kq?.dotBien, ms: kq?.ms };
      if (!dung) hang.duoi = (kq?.loi ?? out).slice(-500);
      console.log(`${dung ? "ok " : "SAI"} ${b.stack}/${b.id} ${cheDo} ma=${ma} ${kq?.lyDo?.join(",") ?? ""} ${kq?.dotBien ? `dot-bien ${kq.dotBien.bat}/${kq.dotBien.tong}` : ""}`);
      resolve(hang);
    });
  });
}

const hang = [];
const viec = ds.flatMap((b) => CHE_DO[b.kieu].map(([c, k]) => ({ b, c, k })));
const songSong = viec.filter((v) => v.b.kieu === "ma-don");
const tuanTu = viec.filter((v) => v.b.kieu !== "ma-don");
let i = 0;
await Promise.all(
  Array.from({ length: 3 }, async () => {
    while (i < songSong.length) {
      const v = songSong[i++];
      hang.push(await chayMot(v.b, v.c, v.k));
    }
  }),
);
for (const v of tuanTu) hang.push(await chayMot(v.b, v.c, v.k));

const sai = hang.filter((h) => !h.dung);
const tong = { bai: ds.length, luot: hang.length, dung: hang.length - sai.length, sai: sai.map((h) => `${h.id}:${h.cheDo}:ma=${h.ma}`) };
if (lay("--ra")) fs.writeFileSync(lay("--ra"), JSON.stringify({ tong, hang }, null, 1));
for (const s of sai) console.log(`--- ${s.id} ${s.cheDo}\n${s.duoi ?? ""}`);
console.log(JSON.stringify(tong));
process.exit(sai.length ? 1 : 0);
