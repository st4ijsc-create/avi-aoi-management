/**
 * Đo 7 câu ứng với 7 ô quy trình nhà máy — gọi THẲNG vào dịch vụ, không qua HTTP.
 * Đo HAI mức tách rời:
 *   (1) TRUY HỒI — thẻ ĐÃ DUYỆT đúng có vào top-K citations không
 *   (2) TRẢ LỜI  — câu trả lời có chứa ĐÚNG sự kiện nhà máy không
 * Lượt trước: truy hồi 7/7, trả lời 4/7. Ba câu hỏng do bộ định tuyến tool cướp câu
 * hỏi chính sách; đã vá bằng `laCauHoiQuyTac`. Lượt này đo xem bản vá có ăn thật không.
 *
 * ⚠ PHẢI nạp .env TRƯỚC khi import dịch vụ: `GGUF_EMBED_MODEL` đọc lúc nạp module.
 * Thiếu nó, dịch vụ rơi về mặc định `mxbai-embed-large-v1-f16` trong khi corpus nhúng
 * bằng Qwen3 ⇒ tự hạ xuống truy hồi THEO TỪ KHOÁ, và mọi con số đo được là của một hệ
 * thống KHÁC.
 * ⚠ In ra ngay mỗi ca (stdout bị đệm khi ghi ra tệp — lượt trước tưởng treo).
 */
import "dotenv/config";

const { retrieveKnowledge, answerQuestion } = await import("./server/services/aiLocalKnowledgeService");

type Ca = { id: string; q: string; the: string; phaiCo: RegExp[]; nhan: string };

const CAC_CA: Ca[] = [
  { id: "A1", the: "andon", nhan: "đèn/còi CÓ nối hệ thống",
    q: "Đèn và còi báo động ở nhà máy có nối vào Andon của hệ thống không?",
    phaiCo: [/IoT|mạch điện/i] },
  { id: "A2", the: "andon", nhan: "cam kết 1 phút / nhanh nhất 30 giây",
    q: "Gọi Andon bao lâu mà chưa ai tới thì coi là bất thường?",
    phaiCo: [/1 phút|một phút/i, /30 giây|30s/i] },
  { id: "A3", the: "andon", nhan: "người báo cáo xác nhận",
    q: "Ai xác nhận cuối cùng rằng sự cố Andon đã được khắc phục thật?",
    phaiCo: [/người báo cáo|người gọi/i] },
  { id: "B1", the: "alerts", nhan: "quản lý + kỹ sư",
    q: "Ai có quyền chỉnh ngưỡng cảnh báo?",
    phaiCo: [/quản lý/i, /kỹ sư/i] },
  { id: "B2", the: "alerts", nhan: "ít nhất 8 tiếng, thường 24 tiếng",
    q: "Sau khi chỉnh ngưỡng cảnh báo thì theo dõi bao lâu mới coi là đã ổn định?",
    phaiCo: [/8\s*(tiếng|giờ|h)/i, /24\s*(tiếng|giờ|h)/i] },
  { id: "C1", the: "production-orders", nhan: "quản lý + người lập lịch",
    q: "Ai được phép dời lịch hoặc huỷ đơn hàng sản xuất?",
    phaiCo: [/quản lý/i, /lập lịch/i] },
  { id: "C2", the: "production-orders", nhan: "ngưỡng 10%",
    q: "Sai lệch WIP bao nhiêu phần trăm thì coi là bất thường?",
    phaiCo: [/10\s*%/] },
];

// Danh tính THẬT: thiếu nó, vòng lặp tool trả "bạn không có quyền" và ta đo nhầm cổng
// RBAC thay vì đo tri thức.
const execCtx = { user: { id: 1, role: "admin", name: "admin" }, lang: "vi" as const };

let datTruyHoi = 0;
let datTraLoi = 0;
const chuaDat: string[] = [];

for (const ca of CAC_CA) {
  process.stdout.write(`\n[${ca.id}] ${ca.nhan}\n`);
  try {
    const r = await retrieveKnowledge(ca.q, 5);
    const paths = (r.citations ?? []).map((c) => c.sourcePath);
    const co = paths.some((p) => p.includes("operational-approved") && p.includes(ca.the));
    if (co) datTruyHoi++;
    process.stdout.write(`  truy hồi "${ca.the}": ${co ? "CÓ" : "KHÔNG"}  (conf ${r.confidence?.toFixed?.(3) ?? "?"})\n`);
  } catch (e: any) {
    process.stdout.write(`  truy hồi NÉM: ${e?.message ?? e}\n`);
  }

  try {
    const a: any = await answerQuestion(ca.q, 5, [], "engineer", undefined, execCtx as any);
    const ans = String(a?.answer ?? a?.text ?? "");
    const thieu = ca.phaiCo.filter((re) => !re.test(ans));
    if (thieu.length === 0) { datTraLoi++; process.stdout.write(`  trả lời: ĐẠT\n`); }
    else { process.stdout.write(`  trả lời: THIẾU ${thieu.map(String).join(" ")}\n`); chuaDat.push(ca.id); }
    process.stdout.write(`  » ${ans.replace(/\s+/g, " ").slice(0, 300)}\n`);
  } catch (e: any) {
    process.stdout.write(`  trả lời NÉM: ${e?.message ?? e}\n`);
    chuaDat.push(ca.id);
  }
}

process.stdout.write(`\n══ TRUY HỒI: ${datTruyHoi}/7   ·   TRẢ LỜI: ${datTraLoi}/7\n`);
if (chuaDat.length) process.stdout.write(`   chưa đạt: ${chuaDat.join(", ")}\n`);
process.exit(0);
