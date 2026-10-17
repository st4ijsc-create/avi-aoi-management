/**
 * ★★ Đợt 3b (3.4) — "GỢI Ý THÔNG ĐIỆP" commit: model chỉ SINH CHỮ, KHÔNG commit.
 *
 * • Đường model HIỆN CÓ (`aiGgufEngine.generateText` — llama-server khi có, cùng cổng ưu tiên Đợt 0.3), mức
 *   `tuong-tac` khai TƯỜNG MINH (`chayVoiUuTien`) — người đang ngồi chờ nút này, không phải việc nền.
 * • Diff là DỮ LIỆU không tin cậy (mã của dự án có thể chứa câu "bỏ qua chỉ dẫn…"): đi qua `sanitizeUntrustedBlock`
 *   (quét tiêm + che bí mật + trung hoà rào) rồi `wrapUntrustedBlock` — đúng khuôn mọi khối dữ liệu khác vào prompt.
 * • Kết quả là CHỮ cho ô thông điệp; người vẫn sửa được và vẫn phải bấm Commit. Không đường nào từ đây tới `git`.
 */
import { sanitizeUntrustedBlock, wrapUntrustedBlock } from "../aiSafety";
import { chayVoiUuTien } from "../hangDoiUuTienLlm";

export type HamSinhChu = (y: {
  prompt: string;
  systemPrompt: string;
  maxTokens: number;
  temperature: number;
  disableThinking: boolean;
}) => Promise<{ text: string }>;

export type KetQuaGoiY = { ok: true; thongDiep: string } | { ok: false; ma: "KHONG_CO_THAY_DOI" | "MODEL_LOI" | "MODEL_RONG" };

const HE_THONG: Record<"vi" | "en" | "zh", string> = {
  vi: "Bạn viết THÔNG ĐIỆP COMMIT git cho thay đổi được cung cấp. Dòng đầu ≤ 72 ký tự, thể mệnh lệnh, nêu ĐIỀU đã đổi; có thể thêm một dòng trống và tối đa 3 gạch đầu dòng. Chỉ in thông điệp, không giải thích, không khối mã.",
  en: "Write a git COMMIT MESSAGE for the given change. First line ≤ 72 characters, imperative mood, says WHAT changed; optionally a blank line and up to 3 bullet points. Print only the message, no explanation, no code fences.",
  zh: "为给定的改动编写 git 提交信息。第一行不超过 72 个字符，使用祈使语气，说明改了什么；可空一行后加最多 3 个要点。只输出提交信息，不要解释，不要代码块。",
};

/** Làm sạch đầu ra model thành một thông điệp dùng được. THUẦN. */
export function lamSachThongDiepModel(raw: string): string {
  let s = String(raw ?? "").replace(/\r\n/g, "\n");
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, "");
  s = s.replace(/^```[^\n]*\n?/gm, "").replace(/```/g, "");
  const dong = s.split("\n").map((d) => d.replace(/\s+$/, ""));
  while (dong.length && dong[0]!.trim() === "") dong.shift();
  if (dong.length === 0) return "";
  let dau = dong[0]!.trim().replace(/^(commit message|thông điệp commit|提交信息)\s*[:：]\s*/i, "").replace(/^["'`]+|["'`]+$/g, "");
  if (dau.length > 72) dau = dau.slice(0, 71) + "…";
  const than = dong.slice(1).filter((d, i, a) => !(d.trim() === "" && i > 0 && (a[i - 1] ?? "").trim() === "")).slice(0, 6);
  return [dau, ...than].join("\n").trim().slice(0, 500);
}

export async function goiYThongDiepCommit(
  diffVan: string,
  lang: "vi" | "en" | "zh",
  sinh: HamSinhChu,
): Promise<KetQuaGoiY> {
  if (!diffVan.trim()) return { ok: false, ma: "KHONG_CO_THAY_DOI" };
  const sach = sanitizeUntrustedBlock(diffVan, { maxChars: 6_000 });
  const prompt = `${wrapUntrustedBlock("git diff", sach.text)}\n\n${lang === "en" ? "Commit message:" : lang === "zh" ? "提交信息：" : "Thông điệp commit:"}`;
  let text = "";
  try {
    const r = await chayVoiUuTien("tuong-tac", () =>
      sinh({ prompt, systemPrompt: HE_THONG[lang], maxTokens: 160, temperature: 0.2, disableThinking: true }),
    );
    text = r.text;
  } catch {
    return { ok: false, ma: "MODEL_LOI" };
  }
  const td = lamSachThongDiepModel(text);
  return td ? { ok: true, thongDiep: td } : { ok: false, ma: "MODEL_RONG" };
}
