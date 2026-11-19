/**
 * K1 — quét che oan của `shared/mauBiMat.ts` trên kho văn bản ĐÃ COMMIT, so với nền `scripts/che-oan/nen.json`.
 * CHỈ ĐỌC: đọc qua `git ls-tree` + `git cat-file --batch` (không đọc cây làm việc, không ghi tệp nào).
 *
 *   npx tsx scripts/che-oan/quet-che-oan.ts                 # so commit HEAD với nền; thoát 1 nếu có khớp MỚI
 *   npx tsx scripts/che-oan/quet-che-oan.ts --rev main      # so một commit khác
 *   npx tsx scripts/che-oan/quet-che-oan.ts --in-nen        # in nền mới ra stdout (người chạy tự xem rồi tự lưu)
 *
 * Mã thoát: 0 = không khớp mới · 1 = có khớp mới (DỪNG, báo chủ dự án trước khi gộp — luật HST 14/11) · 2 = lỗi (git, nền hỏng).
 * In ra chỉ tệp:dòng và hình `<tiền tố>+<n>`, KHÔNG in thân khớp.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { docNen, laTepTrongKho, lapNen, maThoat, quetNoiDung, soVoiNen, taoKetQuaRong, tachCatFileBatch } from "./quetCheOan";

const GOC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const NEN_MAC_DINH = path.join(GOC, "scripts", "che-oan", "nen.json");

function thamSo(ten: string): string | undefined {
  const i = process.argv.indexOf(ten);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const git = (a: string[], dauVao?: string) =>
  execFileSync("git", a, { cwd: GOC, input: dauVao, maxBuffer: 1 << 30, stdio: ["pipe", "pipe", "pipe"] });

function main(): number {
  const rev = git(["rev-parse", "--verify", `${thamSo("--rev") ?? "HEAD"}^{commit}`]).toString("utf8").trim();
  const tep = git(["-c", "core.quotepath=off", "ls-tree", "-r", "--name-only", "-z", rev])
    .toString("utf8")
    .split("\0")
    .filter((t) => t && laTepTrongKho(t));
  const muc = tachCatFileBatch(git(["cat-file", "--batch"], tep.map((t) => `${rev}:${t}\n`).join("")), tep);
  const kq = taoKetQuaRong();
  for (const m of muc) if ("noiDung" in m) quetNoiDung(kq, m.tep, m.noiDung);
  const tom = `rev ${rev.slice(0, 12)} · ${kq.soTep} tệp · ${kq.soDong} dòng · ${kq.soKyTu} ký tự`;

  if (process.argv.includes("--in-nen")) {
    process.stderr.write(`K1 ${tom}\n`);
    process.stdout.write(`${JSON.stringify(lapNen(kq, rev), null, 2)}\n`);
    return 0;
  }

  const duongNen = thamSo("--nen") ?? NEN_MAC_DINH;
  const nen = docNen(JSON.parse(fs.readFileSync(duongNen, "utf8")));
  const ss = soVoiNen(kq, nen);
  console.log(`K1 ${tom} · nền ${nen.rev.slice(0, 12)}`);
  for (const t of Object.keys(kq.khop)) console.log(`  ${t}: ${kq.khop[t]} (nền ${nen.khop[t] ?? "—"})`);
  for (const t of ss.thieuTrongNen) console.log(`  ⚠ mẫu "${t}" chưa có trong nền — lập lại nền CÓ CHỦ Ý (--in-nen) sau khi xem khớp.`);
  for (const g of ss.giam) console.log(`  giảm: ${g.ten} ${g.nen} → ${g.nay}`);
  for (const d of ss.moi) {
    console.log(`  ✗ KHỚP MỚI ${d.ten}: ${d.nen} → ${d.nay}`);
    for (const v of kq.viTri[d.ten]!.slice(0, 50)) console.log(`      ${v.tep}:${v.dong} [${v.dang}]`);
  }
  const ma = maThoat(ss);
  console.log(ma === 0 ? "K1 ĐẠT: không khớp mới." : "K1 DỪNG: có khớp mới — báo chủ dự án trước khi gộp.");
  return ma;
}

try {
  process.exitCode = main();
} catch (e) {
  console.error(`K1 lỗi: ${(e as Error).message}`);
  process.exitCode = 2;
}
