/**
 * HA-4 (lệnh) — GỢI Ý DẠNG ĐƯỢC PHÉP gần nhất, nối vào lời từ chối lệnh của chế độ tu-dong (`cauTuChoiLenhTuDong` ở boThucThiMayChu.ts).
 *
 * VÌ SAO: lượt đo 14/11 (agent-f, 6 mẫu) — 18 lời gọi bị `LENH_CAN_DUYET_TAY`; model KHÔNG lặp lại đúng lệnh (0 lần) mà dò biến thể (3–7 lượt/mẫu) vì
 * lời từ chối chỉ liệt kê danh sách chung. Hàm này nói thẳng "dạng đúng là …" cho các họ lệnh hay gặp, và với lệnh ĐỌC tệp thì nói rõ tệp bị từ chối là CHỦ Ý
 * (không lách bằng script — đường lách thật đã xảy ra: mẫu py-doi-soat #3 tự viết test in CSV).
 *
 * THUẦN: chỉ đọc chuỗi, KHÔNG đọc đĩa / env / CSDL; KHÔNG nới quyền (chỉ sinh chữ). KHÔNG chép lệnh của model vào kết quả (câu cố định ⇒ không dẫn lại nội dung tuỳ ý vào lời nhắc).
 * Trả `""` khi không có gợi ý riêng (lệnh đã đúng dạng hoặc không thuộc họ nào) — lời từ chối chung vẫn đứng nguyên.
 * ⚠ KHÔNG nhận cờ / glob mới: đây chỉ là lời nhắn; quyết định A(2) (không nới `-v/-s/-q` và glob) nằm ở repoCommandSandbox.ts.
 */

/** chỉ xét tối đa chừng này token đầu (lệnh dài bất thường không làm chậm) */
const TRAN_TOKEN = 64;

const LENH_DOC_TEP: ReadonlySet<string> = new Set(["cat", "head", "tail", "type", "less", "more", "get-content", "gc"]);

const GOI_Y = {
  pytestCo: (ten: "pytest" | "unittest") =>
    `The only accepted form is exactly \`python -m ${ten} <path>\` — one path, without flags (-v, -s, -q, -x are not accepted; the output verbosity cannot be changed). Re-run it in that form.`,
  motDuong: (ten: "pytest" | "unittest") => `Pass exactly one path: \`python -m ${ten} <path>\` (a directory runs every test inside it).`,
  tenTrinhThongDich: "The interpreter must be named exactly `python` (not python3 / py): `python -m pytest <path>` or `python -m unittest <path>`.",
  maTuyY:
    "Running arbitrary code or scripts (python -c, python <file>.py) is not allowed in automatic mode. To verify, run the tests with `python -m pytest <path>` or `python -m unittest <path>`.",
  docTep:
    "Reading files through shell commands is not available in automatic mode. Use the read_file tool with the path. If read_file refuses the file, it is not readable by design: do not write or run a script to print it and do not look for another command — tell the user.",
  nodeGlob: "Wildcards (*) are not accepted in commands. Pass the test DIRECTORY instead: `node --test <directory>`.",
  kyTuDaiDien: "Wildcards (* ?) are not accepted in commands; pass a directory or a single file path.",
  mkdir: "mkdir is not a verification command and does not run in automatic mode; create files with write_file.",
} as const;

export function goiYLenhTuChoi(lenh: unknown): string {
  if (typeof lenh !== "string") return "";
  const tok = lenh.trim().toLowerCase().split(/\s+/, TRAN_TOKEN).filter((s) => s !== "");
  if (tok.length === 0) return "";
  const [t0, t1, t2] = tok;
  const sau3 = tok.slice(3);

  // họ Python: trình chạy test (đúng dạng thì KHÔNG gợi ý), chạy mã tuỳ ý, tên trình thông dịch sai
  if ((t0 === "py" || /^python3(\.\d+)?$/.test(t0 ?? "")) && t1 === "-m" && (t2 === "pytest" || t2 === "unittest")) return GOI_Y.tenTrinhThongDich;
  if (t0 === "python") {
    if (t1 === "-m" && (t2 === "pytest" || t2 === "unittest")) {
      if (sau3.some((s) => s.startsWith("-"))) return GOI_Y.pytestCo(t2);
      if (sau3.length > 1) return GOI_Y.motDuong(t2);
    } else if (t1 === "-c" || t1 === "-" || (t1 !== undefined && t1.endsWith(".py"))) {
      return GOI_Y.maTuyY;
    }
  }
  if (t0 !== undefined && LENH_DOC_TEP.has(t0)) return GOI_Y.docTep;
  const coKyTuDaiDien = tok.some((s) => s.includes("*") || s.includes("?"));
  if (t0 === "node" && t1 === "--test" && coKyTuDaiDien) return GOI_Y.nodeGlob;
  if (t0 === "mkdir" || t0 === "md") return GOI_Y.mkdir;
  if (coKyTuDaiDien) return GOI_Y.kyTuDaiDien;
  return "";
}
