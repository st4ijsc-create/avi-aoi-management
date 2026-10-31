/**
 * ★ Đợt 12 H4.2 — ĐÓNG GÓI bản ghi thô (`AI_GHI_LUOT_DIR/<runId>.jsonl`, cửa sổ GPU) thành fixture gzip vào repo.
 *
 *   npx tsx scripts/ai-eval/phat-lai/dongGoi.ts --tho <thư mục thô> --run <runId> --goc <thư mục dự án lúc ghi> --bai <id bài>
 *       [--du-an-tuong-doi sandbox-projects/agent-f/<bai>] [--commit <sha>] [--dist <sha>] [--dat 1|0] [--ra server/testing/fixtures/phat-lai]
 *
 * Đọc hàng `ai_agent_runs` của runId (CHỈ ĐỌC — câu hỏi, chế độ, sự kiện đã lưu, lý do dừng) bằng DATABASE_URL của `.env` cây chính
 * (đọc theo regex, không source). Thay đường gốc / thư mục người dùng bằng token, NÉM khi còn đường ổ đĩa / mẫu khoá (không tự xoá —
 * người đóng gói xem bản thô). Trần dieu-phoi: mỗi tệp ≤ 2 MB, tổng thư mục ≤ 10 MB ⇒ vượt thì dừng, không ghi.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { dongGoi } from "../../../server/testing/phatLaiLuot";

const TRAN_TEP = 2 * 1024 * 1024;
const TRAN_TONG = 10 * 1024 * 1024;

const arg = (ten: string, macDinh?: string) => {
  const i = process.argv.indexOf(ten);
  return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : macDinh;
};
const can = (ten: string) => {
  const v = arg(ten);
  if (!v) throw new Error(`thiếu ${ten}`);
  return v;
};

async function main() {
  const tho = can("--tho");
  const runId = can("--run");
  const goc = path.resolve(can("--goc"));
  const bai = can("--bai");
  const ra = path.resolve(arg("--ra", "server/testing/fixtures/phat-lai")!);
  if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new Error("runId không hợp lệ");
  const dong = fs.readFileSync(path.join(tho, `${runId}.jsonl`), "utf8").trim().split("\n").map((d) => JSON.parse(d) as Record<string, unknown>);

  const env = fs.readFileSync("D:/SOURCES/avi-aoi-management/.env", "utf8");
  const url = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, "");
  if (!url) throw new Error("không đọc được DATABASE_URL");
  const postgres = (await import("postgres")).default;
  const sql = postgres(url, { max: 1 });
  try {
    const [h] = await sql`select "cauHoi", "cheDo", "suKien", "lyDoDung" from ai_agent_runs where id = ${runId}::uuid`;
    if (!h) throw new Error("không có hàng ai_agent_runs cho runId");
    const datRaw = arg("--dat");
    const fx = dongGoi(dong, {
      goc,
      duAnTuongDoi: arg("--du-an-tuong-doi", `sandbox-projects/agent-f/${bai}`)!,
      cauHoi: String(h.cauHoi),
      cheDo: String(h.cheDo),
      suKien: Array.isArray(h.suKien) ? (h.suKien as unknown[]) : [],
      lyDo: (h.lyDoDung as string | null) ?? null,
      ...(datRaw !== undefined ? { dat: datRaw === "1" } : {}),
      bai,
      ...(arg("--dist") ? { dist: arg("--dist")! } : {}),
      ...(arg("--commit") ? { commit: arg("--commit")! } : {}),
    });
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(fx), "utf8"), { level: 9 });
    if (gz.length > TRAN_TEP) throw new Error(`fixture ${gz.length} B > trần ${TRAN_TEP} B`);
    fs.mkdirSync(ra, { recursive: true });
    const tong = fs.readdirSync(ra).reduce((s, t) => s + fs.statSync(path.join(ra, t)).size, 0) + gz.length;
    if (tong > TRAN_TONG) throw new Error(`tổng thư mục ${tong} B > trần ${TRAN_TONG} B`);
    const tep = path.join(ra, `${bai}-${runId.slice(0, 8)}.json.gz`);
    fs.writeFileSync(tep, gz);
    console.log(JSON.stringify({ tep: path.relative(process.cwd(), tep).split(path.sep).join("/"), byte: gz.length, luot: fx.luot.length, lyDo: fx.ky.lyDo, suKien: fx.ky.suKien.length }));
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(`dongGoi: ${(e as Error).message}`);
  process.exit(1);
});
