/**
 * ★★★ 2026-08-23 · UX LÔ 1 (B1) — **GỢI Ý MỞ ĐẦU THEO DỰ ÁN ĐANG CHỌN**, một chỗ, khoá theo id.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * SỰ VIỆC ĐO ĐƯỢC (buổi trải nghiệm người-dùng-thật)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ba nút gợi ý đầu trang `/ai-coding-workspace` viết CỨNG cho repo chính (`server/routers.ts`,
 * `executeDecision`, `npm run check`). Người dùng chọn dự án **csharp** rồi bấm gợi ý ⇒ được dẫn
 * vào một tệp KHÔNG TỒN TẠI trong dự án ấy — lượt chạm đầu tiên là một lời từ chối.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BA QUYẾT ĐỊNH, MỖI CÁI MỘT LÝ DO
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   1. **Dữ liệu ở MỘT chỗ (đây), khoá theo `projectId`** — không rải ba biểu thức điều kiện trong
 *      JSX. Trang chỉ `map` kết quả; lưới đơn vị đo thẳng bảng này.
 *   2. **Id lạ ⇒ MẢNG RỖNG (ẩn gợi ý), không rơi về gợi ý repo** — gợi SAI tệ hơn không gợi: dự án
 *      do admin đăng ký qua UI (`ai_repo_du_an`) có cây thư mục ta không biết; dẫn người ta vào
 *      `server/routers.ts` của một dự án C# là đúng lỗi vừa vá.
 *   3. **Nội dung bám CÂY THẬT của hai dự án mẫu** (`sandbox-projects/csharp-demo` ·
 *      `react-pg-demo`): tệp nêu trong gợi ý là tệp CÓ THẬT (`src/Calculator.cs`,
 *      `CalculatorDemo.sln`, `src/validate.mjs`, `test/validate.test.mjs` — đã kiểm trên đĩa
 *      2026-08-23), và lệnh là lệnh DANH SÁCH TRẮNG đúng hệ sinh thái (`dotnet test` ·
 *      `node --test`). Gợi ý "vì sao ca X đỏ" bám đúng lỗi CỐ Ý cài trong hai dự án đề thi.
 *
 * ⚠ `canChayLenh: true` ⇒ trang chỉ hiện khi tài khoản có `ai_repo_exec` (đúng phép lịch sự đang
 *   áp cho nút "npm run check" cũ — server vẫn là hàng rào thật).
 * ⚠ Chuỗi hiển thị đi qua `t(khoa, macDinh)` ở trang — bảng này chỉ giữ KHOÁ + bản vi mặc định,
 *   không ghim một ngôn ngữ vào dữ liệu.
 */

export interface GoiYDuAn {
  /** Khoá i18n (`repoWs.suggest.*`) — câu hiển thị = câu GỬI cho tác nhân, đúng mẫu ba nút cũ. */
  khoa: string;
  /** Bản tiếng Việt mặc định (fallback khi thiếu khoá). */
  macDinh: string;
  /** Gợi ý CHẠY LỆNH — ẩn khi tài khoản thiếu `ai_repo_exec` (phép lịch sự; server mới là hàng rào). */
  canChayLenh?: boolean;
}

const BANG_GOI_Y: Readonly<Record<string, readonly GoiYDuAn[]>> = {
  // Repo chính — giữ NGUYÊN ba gợi ý cũ (đang đúng với cây của nó).
  repo: [
    { khoa: "repoWs.suggest.read", macDinh: "Đọc file server/routers.ts và tóm tắt" },
    { khoa: "repoWs.suggest.grep", macDinh: "Tìm nơi gọi executeDecision trong repo" },
    { khoa: "repoWs.suggest.check", macDinh: "Chạy npm run check rồi đọc lỗi", canChayLenh: true },
  ],
  // Dự án thử C# (`sandbox-projects/csharp-demo`).
  csharp: [
    { khoa: "repoWs.suggest.csharpRead", macDinh: "Đọc src/Calculator.cs và tóm tắt" },
    { khoa: "repoWs.suggest.csharpTest", macDinh: "Chạy dotnet test CalculatorDemo.sln", canChayLenh: true },
    { khoa: "repoWs.suggest.csharpWhy", macDinh: "Giải thích vì sao hai ca Divide_ByZero đỏ" },
  ],
  // Dự án thử React/Node (`sandbox-projects/react-pg-demo`).
  react: [
    { khoa: "repoWs.suggest.reactRead", macDinh: "Đọc src/validate.mjs và tóm tắt" },
    { khoa: "repoWs.suggest.reactTest", macDinh: "Chạy node --test test/validate.test.mjs", canChayLenh: true },
    { khoa: "repoWs.suggest.reactWhy", macDinh: "Giải thích vì sao hai ca của validateTodo đang đỏ" },
  ],
};

/** Id lạ/rỗng ⇒ `[]` — ẩn gợi ý thay vì gợi sai (mặc định AN TOÀN, xem quyết định 2). */
export function goiYTheoDuAn(projectId: string | null | undefined): readonly GoiYDuAn[] {
  if (typeof projectId !== "string" || projectId === "") return [];
  return BANG_GOI_Y[projectId] ?? [];
}

/**
 * ★★★ 2026-08-25 · NHÓM HOÃN (onboarding) — GỢI Ý KHÁM PHÁ MẶC ĐỊNH cho dự án id-lạ (admin tự đăng ký).
 *
 * Quyết định 2 ở trên vẫn ĐÚNG NGUYÊN: `goiYTheoDuAn` trả `[]` cho id-lạ — KHÔNG rơi về gợi ý repo, vì
 * gợi SAI TỆP là lỗi đã vá. Nhưng "rỗng hoàn toàn" bỏ người mở một dự án lạ TRƯỚC MÀN TRẮNG không lối
 * vào. Bộ này chữa đúng khe đó mà KHÔNG tái phạm lỗi cũ: **KHÔNG nêu tên tệp cụ thể** — chỉ nhờ tác
 * nhân TỰ khám phá cây (list_files) / mô tả cấu trúc / đọc README "nếu có". An toàn cho MỌI cây thư mục.
 *
 * ⚠ **0 mục `canChayLenh`**: ta KHÔNG biết lệnh test của dự án lạ (dotnet? node? npm?) — đoán một lệnh
 *   chạy là đúng loại rủi ro quyết định-2 chặn. Nút "Chạy kiểm chứng" (ribbon) + ô "Chạy nhanh"
 *   (terminal) vẫn đọc `goiYTheoDuAn` TRỰC TIẾP ⇒ vắng mặt cho dự án lạ (đúng). Bộ này CHỈ để TRANG đổ
 *   vào KHU GỢI Ý MỞ ĐẦU khi `goiYTheoDuAn` rỗng — một lối vào, không phải một cửa chạy lệnh.
 */
export const MAC_DINH_KHAM_PHA: readonly GoiYDuAn[] = [
  { khoa: "repoWs.suggest.mac.list", macDinh: "Liệt kê các tệp trong dự án này" },
  { khoa: "repoWs.suggest.mac.structure", macDinh: "Mô tả cấu trúc và mục đích của dự án này" },
  { khoa: "repoWs.suggest.mac.readme", macDinh: "Đọc README (nếu có) và tóm tắt" },
];
