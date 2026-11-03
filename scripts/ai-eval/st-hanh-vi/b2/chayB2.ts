/**
 * ★ Đợt 12 B2 — CHẠY (chỉ SAU khi kịch bản đã commit — luật đăng ký trước): mọi lời giải qua OIP theo `kich-ban/`, so với phán quyết
 * CHÍNH THỨC đã ghi (RuSTy, báo cáo Đợt 9). Không đổi điểm chính thức.
 *   npx tsx scripts/ai-eval/st-hanh-vi/b2/chayB2.ts [--bao-cao <thư mục reports Đợt 9>] [--ra <thư mục ra>]
 * Lời giải: (1) `mau/` (lời giải mẫu — phải ĐẠT), (2) đột biến `sai` của bai.json áp lên mẫu (phải TRƯỢT), (3) lời giải MODEL trong
 * hai báo cáo `PLC-v1-ab-kiem-q36-27b-{1,2}.json` (trường `tep`, phán quyết chính thức `dat`).
 * Ra: `B2-ket-qua.json` (mọi lời giải) + `B2-bang.md` (bảng có MẪU SỐ + 3 ví dụ mỗi ô).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const THU_MUC_NAY = path.dirname(fileURLToPath(import.meta.url));
import { createHash } from "node:crypto";
import { chamLoiGiai, docKichBan, GOC_KHO, THU_MUC_KICH_BAN, type KetQuaBai } from "./boBocBai";

const arg = (t: string, md: string) => {
  const i = process.argv.indexOf(t);
  return i > 0 ? process.argv[i + 1]! : md;
};
const THU_MUC_BAO_CAO = arg("--bao-cao", "D:/SOURCES/_ai9_do/scripts/ai-eval/ngau-nhien/reports");
const RA = arg("--ra", path.join(THU_MUC_NAY, "bao-cao"));
const BAO_CAO = ["PLC-v1-ab-kiem-q36-27b-1.json", "PLC-v1-ab-kiem-q36-27b-2.json"];

/** Lỗi biên dịch do TẬP CON của OIP (không phải lỗi lời giải) — theo thông điệp của checker OIP (LINT / TIME_TO_LINT: 64 bit). */
const RE_TAP_CON = /not supported|not implemented|is a separate IEC language|unsupported|LINT\b|64-bit/i;

/** Ngoại lệ ĐĂNG KÝ TRƯỚC (kiem-dinh rà đáp án, ghi trước khi chạy): lệch ngữ nghĩa OIP / đột biến không phủ / tập con. */
interface NgoaiLe {
  id: string;
  loai: "ngu-nghia-oip" | "khong-phu" | "tap-con-oip";
  doan?: string;
  buoc?: number[];
  sai?: number[];
  ly_do: string;
}
const NGOAI_LE = (JSON.parse(fs.readFileSync(path.join(THU_MUC_NAY, "ngoai-le-dang-ky.json"), "utf8")) as { muc: NgoaiLe[] }).muc;

interface Dong {
  id: string;
  loai: "mau" | "sai" | "model";
  nhan: string;
  chinhThuc: boolean | null;
  /** phán quyết OIP SAU khi bỏ các bước ngoại lệ ngữ nghĩa đã đăng ký (bước bị bỏ hiện ở `lechNgoaiLe`) */
  oip: "dat" | "truot" | "tu-choi-tap-con" | "tu-choi-khac";
  loi?: string;
  lech?: KetQuaBai["lech"];
  lechNgoaiLe?: KetQuaBai["lech"];
  /** dòng dính ngoại lệ đã đăng ký (đột biến vô hình / không phủ / tập con) */
  ngoaiLe?: NgoaiLe["loai"];
  soKiem: number;
  bam: string;
}

const bai = fs.readdirSync(GOC_KHO).filter((d) => d.startsWith("st-")).sort();
const dong: Dong[] = [];
const cham = (id: string, loai: Dong["loai"], nhan: string, chinhThuc: boolean | null, tep: Record<string, string>, saiSo?: number) => {
  const nguon = Object.keys(tep).sort().map((k) => tep[k]).join("\n");
  const kq = chamLoiGiai(docKichBan(id), nguon);
  const nlBuoc = NGOAI_LE.filter((n) => n.id === id && n.doan !== undefined);
  const laNl = (l: KetQuaBai["lech"][number]) => nlBuoc.some((n) => n.doan === l.doan && (n.buoc ?? []).includes(l.buoc));
  const lech = kq.lech.filter((l) => !laNl(l));
  const lechNgoaiLe = kq.lech.filter(laNl);
  const oip: Dong["oip"] = kq.loi ? (RE_TAP_CON.test(kq.loi) ? "tu-choi-tap-con" : "tu-choi-khac") : lech.length === 0 ? "dat" : "truot";
  const nl =
    NGOAI_LE.find((n) => n.id === id && saiSo !== undefined && (n.sai ?? []).includes(saiSo))?.loai ??
    (lechNgoaiLe.length ? "ngu-nghia-oip" : undefined) ??
    (kq.loi && RE_TAP_CON.test(kq.loi) ? NGOAI_LE.find((n) => n.id === id && n.loai === "tap-con-oip")?.loai : undefined);
  dong.push({
    id,
    loai,
    nhan,
    chinhThuc,
    oip,
    ...(kq.loi ? { loi: kq.loi.slice(0, 300) } : {}),
    ...(lech.length ? { lech: lech.slice(0, 3) } : {}),
    ...(lechNgoaiLe.length ? { lechNgoaiLe: lechNgoaiLe.slice(0, 3) } : {}),
    ...(nl ? { ngoaiLe: nl } : {}),
    soKiem: kq.soKiem,
    bam: createHash("sha256").update(nguon).digest("hex").slice(0, 12),
  });
};

for (const id of bai) {
  const b = JSON.parse(fs.readFileSync(path.join(GOC_KHO, id, "bai.json"), "utf8")) as { tepGiai: string[]; sai?: Array<{ tep: string; tu: string; den: string }> };
  const mau = Object.fromEntries(b.tepGiai.map((t) => [t, fs.readFileSync(path.join(GOC_KHO, id, "mau", t), "utf8")]));
  cham(id, "mau", "mau", true, mau);
  (b.sai ?? []).forEach((s, i) => {
    if (!mau[s.tep]?.includes(s.tu)) return void dong.push({ id, loai: "sai", nhan: `sai#${i} KHONG AP DUOC`, chinhThuc: false, oip: "tu-choi-khac", loi: "dot bien khong ap duoc", soKiem: 0, bam: "" });
    cham(id, "sai", `sai#${i}`, false, { ...mau, [s.tep]: mau[s.tep]!.replace(s.tu, s.den) }, i);
  });
}
for (const f of BAO_CAO) {
  const j = JSON.parse(fs.readFileSync(path.join(THU_MUC_BAO_CAO, f), "utf8")) as { rows: Array<{ id: string; lang: string; luot: number; nhanh: string; dat: boolean; tep?: Record<string, string> }> };
  for (const r of j.rows) {
    if (r.lang !== "st") continue;
    if (!r.tep || !Object.keys(r.tep).length) {
      dong.push({ id: r.id, loai: "model", nhan: `${f}#${r.nhanh}#${r.luot}`, chinhThuc: r.dat, oip: "tu-choi-khac", loi: "khong co tep trich", soKiem: 0, bam: "" });
      continue;
    }
    cham(r.id, "model", `${f.replace(/\.json$/, "")}#${r.nhanh}#l${r.luot}`, r.dat, r.tep);
  }
}

fs.mkdirSync(RA, { recursive: true });
const kb = Object.fromEntries(bai.map((id) => [id, createHash("sha256").update(fs.readFileSync(path.join(THU_MUC_KICH_BAN, `${id}.json`))).digest("hex").slice(0, 12)]));
fs.writeFileSync(path.join(RA, "B2-ket-qua.json"), JSON.stringify({ luc: new Date().toISOString(), bamKichBan: kb, dong }, null, 1));

// ─── bảng ────────────────────────────────────────────────────────────────────────────────────────
const dem = (f: (d: Dong) => boolean) => dong.filter(f);
const vd = (ds: Dong[]) =>
  ds.slice(0, 3).map((d) => `\`${d.id}\` ${d.nhan}${d.loi ? ` — ${d.loi.slice(0, 110)}` : d.lech?.[0] ? ` — ${d.lech[0].doan} b${d.lech[0].buoc} ${d.lech[0].nhan ?? ""}: ${d.lech[0].ten} ky=${JSON.stringify(d.lech[0].ky)} thuc=${JSON.stringify(d.lech[0].thuc)}` : ""}`).join("<br>") || "—";
const model = dem((d) => d.loai === "model");
const o = (ct: boolean, oip: Dong["oip"]) => model.filter((d) => d.chinhThuc === ct && d.oip === oip);
const md: string[] = [];
md.push(`# B2 — chấm HÀNH VI (OIP, AST walker) song song phán quyết chính thức (RuSTy) — ${new Date().toISOString().slice(0, 10)}`);
md.push("");
md.push(`Mẫu số: **${bai.length} đề** · **${dem((d) => d.loai === "mau").length} lời giải mẫu** · **${dem((d) => d.loai === "sai").length} đột biến sai** · **${model.length} lời giải model** (${BAO_CAO.join(", ")}) · tổng kiểm theo kịch bản ${dong.reduce((s, d) => s + d.soKiem, 0)}.`);
md.push("Kịch bản đăng ký trước (băm từng tệp trong `B2-ket-qua.json`). Không đổi điểm chính thức Đợt 9.");
md.push("");
md.push("## Thước: lời giải mẫu + đột biến");
md.push("| | n | OIP đạt | OIP trượt | OIP từ chối (tập con) | OIP từ chối (khác) | ví dụ |");
md.push("|---|---|---|---|---|---|---|");
for (const loai of ["mau", "sai"] as const) {
  const ds = dem((d) => d.loai === loai);
  const x = (k: Dong["oip"]) => ds.filter((d) => d.oip === k).length;
  md.push(`| ${loai === "mau" ? "mẫu (phải ĐẠT)" : "đột biến (phải TRƯỢT)"} | ${ds.length} | ${x("dat")} | ${x("truot")} | ${x("tu-choi-tap-con")} | ${x("tu-choi-khac")} | ${vd(ds.filter((d) => (loai === "mau" ? d.oip !== "dat" : d.oip === "dat")))} |`);
}
md.push("");
md.push("## Lời giải model: chính thức (RuSTy) × OIP");
md.push(`| chính thức \\ OIP | đạt | trượt hành vi | từ chối: tập con OIP (KHÔNG tính model trượt) | từ chối: khác (biên dịch / kiểu — OIP chặt hơn?) |`);
md.push("|---|---|---|---|---|");
for (const ct of [true, false]) {
  md.push(
    `| ${ct ? "ĐẠT" : "TRƯỢT"} (${model.filter((d) => d.chinhThuc === ct).length}) | ${o(ct, "dat").length}<br>${vd(o(ct, "dat"))} | ${o(ct, "truot").length}<br>${vd(o(ct, "truot"))} | ${o(ct, "tu-choi-tap-con").length}<br>${vd(o(ct, "tu-choi-tap-con"))} | ${o(ct, "tu-choi-khac").length}<br>${vd(o(ct, "tu-choi-khac"))} |`,
  );
}
md.push("");
md.push("## Ngoại lệ ĐĂNG KÝ TRƯỚC (kiem-dinh rà đáp án, `ngoai-le-dang-ky.json` — ghi trước khi chạy)");
md.push("| bài | loại | phạm vi | dòng bị ảnh hưởng (mẫu / sai / model) | lý do |");
md.push("|---|---|---|---|---|");
for (const n of NGOAI_LE) {
  const ds = dong.filter((d) => d.id === n.id && d.ngoaiLe === n.loai);
  const c = (l: Dong["loai"]) => ds.filter((d) => d.loai === l).length;
  md.push(`| \`${n.id}\` | ${n.loai} | ${n.doan ? `${n.doan} b${(n.buoc ?? []).join(",")}` : n.sai ? `sai#${n.sai.join(",")}` : "cả bài"} | ${c("mau")} / ${c("sai")} / ${c("model")} | ${n.ly_do} |`);
}
md.push("");
md.push("Bước ngoại lệ ngữ nghĩa ĐÃ BỎ khỏi phán quyết OIP ở bảng trên (vẫn ghi `lechNgoaiLe` trong JSON); đột biến dính ngoại lệ đếm trong cột OIP như thường nhưng KHÔNG đọc là \"OIP không bắt\".");
md.push("");
md.push("Ô cần đọc kỹ: **chính thức ĐẠT × OIP trượt** (bộ test chính thức bỏ sót hành vi? hoặc kịch bản/OIP khác ngữ nghĩa) và **chính thức TRƯỢT × OIP đạt** (bộ test chính thức chặt hơn kịch bản rút gọn, hoặc lỗi môi trường RuSTy).");
fs.writeFileSync(path.join(RA, "B2-bang.md"), md.join("\n") + "\n");
console.log(md.join("\n"));
