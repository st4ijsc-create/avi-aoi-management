/**
 * ★★★ doc 79 · DANH SÁCH PHIÊN — **LUẬT VỀ HÌNH DẠNG MỘT PHIÊN ĐƯỢC LƯU.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ BẤT BIẾN SỐ MỘT: **MỘT PHIÊN ĐÃ LƯU CHỈ CHỨA `{role, content}` — KHÔNG GÌ KHÁC.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Không gian làm việc có ba thứ trạng thái SỐNG mà một bản lưu trữ **tuyệt đối không được mang**:
 *
 *   1. **Thẻ duyệt HITL** (`pending_action`: `actionId`/`token`/`args`/`expiresAt`). Nạp lại một
 *      thẻ duyệt CŨ từ một phiên cũ là con đường ngắn nhất tới một lượt GHI **không ai bấm trong
 *      lượt này**. Băm chống TOCTOU của nó đã cũ ⇒ nếu có ghi được thì cũng là ghi bằng **ảnh
 *      chụp đĩa của hôm qua**. Nên phiên **không lưu nó**, và điều đó được cưỡng chế **theo cấu
 *      tạo** chứ không bằng một lời dặn: `locLuot()` **CHIẾU** (project) mọi lượt xuống đúng hai ô
 *      `role`/`content`. Cửa ghi và cửa đọc **đều** đi qua phép chiếu ấy, nên kể cả một hàng bị
 *      đầu độc bằng SQL thẳng cũng KHÔNG phát ra được một thẻ duyệt.
 *   2. **Trạng thái vòng tự động** (lượt i/trần, lệnh, băm lượt trước). Nó thuộc về **một lượt
 *      chạy**, không thuộc về một mạch hội thoại. "Khôi phục" nó là dựng một vòng đang chạy MA:
 *      thẻ hiện "lượt 2/3" cho một vòng không có tiến trình nào phía sau.
 *   3. **Đường dẫn gốc dự án.** Phiên chỉ mang `projectId` — xem `RE_ID_DU_AN` bên dưới.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÌ SAO PHÉP CHIẾU, KHÔNG PHẢI PHÉP KIỂM TRA (`validate`)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Một phép KIỂM TRA trả `true/false` rồi để người gọi quyết định — tức nó phụ thuộc vào việc mọi
 * người gọi nhớ xử lý nhánh `false`. Một phép CHIẾU không có nhánh nào để quên: đầu ra của nó
 * **không thể** mang ô lạ, bất kể đầu vào là gì. Cùng lý lẽ đã dựng `toolRegistry.argsWithAuthCtx`
 * (xoá vô điều kiện `__authCtx` do model bịa rồi gán lại từ phiên thật) — không hỏi, chỉ chiếu.
 *
 * ⚠ File này **THUẦN** (không I/O, không `process.env`) để cả client lẫn server dùng CHUNG một
 *   luật. Hai bản sao của cùng một luật là cách chúng lệch nhau.
 */

// ══════════════════════════════════════════════════════════════════════════════════════════════
// GIỚI HẠN — mỗi con số là một quyết định, không phải một hằng số tuỳ ý
// ══════════════════════════════════════════════════════════════════════════════════════════════

export const GIOI_HAN_PHIEN = {
  /**
   * Số lượt tối đa GIỮ LẠI trong một phiên. Vượt thì giữ **N lượt CUỐI** — ngữ cảnh lập trình
   * hữu ích nằm ở cuối mạch (lỗi vừa đọc, bản sửa vừa đề xuất), không ở đầu.
   */
  SO_LUOT: 200,
  /** Byte tối đa cho MỘT lượt. Đầu ra `dotnet test`/`npm run check` có thể rất dài. */
  BYTE_MOI_LUOT: 20_000,
  /** Byte tối đa cho CẢ phiên (tổng nội dung). Cắt từ ĐẦU (bỏ lượt cũ nhất) khi vượt. */
  BYTE_CA_PHIEN: 400_000,
  /** Độ dài nhãn tự sinh. */
  DAI_NHAN: 80,
  /** Số phiên tối đa liệt kê cho một (người dùng × dự án). */
  SO_PHIEN_LIET_KE: 50,
} as const;

/**
 * ★★★ Hình dạng `projectId` — **CHÍNH LÀ HÀNG RÀO "PHIÊN KHÔNG MANG ĐƯỜNG DẪN".**
 *
 * `[A-Za-z0-9_-]` loại bỏ `\` `/` `:` `.` ` ` — tức **không đường dẫn Windows nào**
 * (`D:\SOURCES\…`) và **không đường dẫn POSIX nào** (`/etc/passwd`, `../..`) lọt qua được. Đây là
 * cùng hình dạng mà `repoProjects.ID_HOP_LE` dùng để tra danh sách TRẮNG; giữ nó ở `shared` để
 * client, tuyến tRPC và ràng buộc CHECK của CSDL nói CÙNG MỘT câu.
 *
 * ⚠ Hình dạng đúng **CHƯA ĐỦ** — nó chỉ chứng minh "không phải đường dẫn". Việc id ấy có nằm
 *   trong danh sách trắng hay không do `phanGiaiGoc()` phía server phán quyết (fail-closed).
 */
export const RE_ID_DU_AN = /^[A-Za-z0-9_-]{1,64}$/;

/** Hình dạng id phiên: UUID v4 do **server** sinh (client không bao giờ tự đặt id). */
export const RE_ID_PHIEN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function laIdDuAnHopLe(x: unknown): x is string {
  return typeof x === "string" && RE_ID_DU_AN.test(x);
}

export function laIdPhienHopLe(x: unknown): x is string {
  return typeof x === "string" && RE_ID_PHIEN.test(x);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// HÌNH DẠNG MỘT LƯỢT
// ══════════════════════════════════════════════════════════════════════════════════════════════

export type VaiLuot = "user" | "assistant";

/**
 * ⚠ **HAI Ô, HẾT.** Tên ô trùng `ChatTurn` của trang không gian làm việc có chủ ý — để đường từ
 * màn hình xuống CSDL không cần một tầng ánh xạ nào (một tầng ánh xạ là một chỗ để quên một ô).
 * Việc chặn ô LẠ nằm ở `locLuot()`, không ở tên kiểu: một `interface` TypeScript **biến mất lúc
 * chạy** và không chặn được gì.
 */
export interface LuotPhien {
  role: VaiLuot;
  content: string;
}

/** Đúng hai khoá được phép tồn tại trong một lượt đã lưu. Dùng cho cả phép chiếu lẫn lưới. */
export const KHOA_LUOT_HOP_LE = ["role", "content"] as const;

/**
 * Dấu vết của một **thẻ duyệt HITL** hoặc một **trạng thái vòng** — những ô mà một bản lưu trữ
 * tuyệt đối không được mang. Danh sách này KHÔNG phải cơ chế cưỡng chế (phép chiếu mới là); nó
 * tồn tại để **lưới đột biến** có thể hỏi đúng câu hỏi, và để câu trả lời "vì sao" đọc được.
 */
export const KHOA_CAM_TRONG_LUOT = [
  "actionId", "token", "tool", "args", "expiresAt", "preview", "summary",
  "luot", "tran", "lyDoDung", "bamDeXuatTruoc", "bamDauRaTruoc", "cauHoiGoc",
] as const;

/** true ⇔ đối tượng có ĐÚNG hai khoá `role`/`content`. Lưới dùng; mã sản xuất không cần hỏi. */
export function luotSachHitl(x: unknown): boolean {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const keys = Object.keys(x as Record<string, unknown>).sort();
  return keys.length === 2 && keys[0] === "content" && keys[1] === "role";
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PHÉP CHIẾU — cửa DUY NHẤT cho cả lượt GHI lẫn lượt ĐỌC
// ══════════════════════════════════════════════════════════════════════════════════════════════

function catByte(s: string, tran: number): string {
  return s.length <= tran ? s : s.slice(0, tran);
}

/**
 * ★★★ **CHIẾU** một danh sách lượt bất kỳ (kể cả `unknown` đọc lên từ jsonb) xuống hình dạng lưu
 * trữ hợp lệ. Không ném, không trả lỗi — đầu vào rác cho ra danh sách RỖNG hoặc ngắn hơn.
 *
 * Bốn việc, theo đúng thứ tự này:
 *   1. **Bỏ** phần tử không phải object, `role` không thuộc {user, assistant}, `content` không
 *      phải chuỗi. Một lượt méo bị BỎ, không bị "sửa cho đúng" — đoán ý một hàng hỏng là cách sinh
 *      dữ liệu bịa.
 *   2. **Chiếu** xuống đúng `{role, content}` ⇒ mọi ô lạ (`actionId`, `token`, `args`…) biến mất
 *      **theo cấu tạo**. Đây là bất biến số một của file này.
 *   3. **Cắt** nội dung mỗi lượt theo `BYTE_MOI_LUOT`.
 *   4. **Cắt từ ĐẦU** cho tới khi thoả cả `SO_LUOT` lẫn `BYTE_CA_PHIEN` — giữ phần CUỐI vì ngữ
 *      cảnh lập trình hữu ích nằm ở cuối mạch.
 */
export function locLuot(x: unknown): LuotPhien[] {
  if (!Array.isArray(x)) return [];

  const sach: LuotPhien[] = [];
  for (const raw of x) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const o = raw as Record<string, unknown>;
    const role = o.role;
    const content = o.content;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;
    // ⚠ Đây là dòng làm nên bất biến: dựng một object MỚI từ hai ô, không `{...o}`.
    sach.push({ role, content: catByte(content, GIOI_HAN_PHIEN.BYTE_MOI_LUOT) });
  }

  // Trần theo SỐ LƯỢT — giữ phần cuối.
  let ra = sach.length > GIOI_HAN_PHIEN.SO_LUOT ? sach.slice(-GIOI_HAN_PHIEN.SO_LUOT) : sach;

  // Trần theo TỔNG BYTE — bỏ dần từ đầu. Vòng lặp có biến giảm (`ra.length`) nên luôn dừng.
  let tong = 0;
  for (const t of ra) tong += t.content.length;
  let i = 0;
  while (tong > GIOI_HAN_PHIEN.BYTE_CA_PHIEN && i < ra.length) {
    tong -= ra[i]!.content.length;
    i++;
  }
  if (i > 0) ra = ra.slice(i);

  return ra;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// NHÃN TỰ SINH — người dùng KHÔNG phải đặt tên phiên
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Nhãn suy từ **câu hỏi ĐẦU TIÊN của người dùng** (không phải câu trả lời của AI — câu trả lời có
 * thể mở đầu bằng một khối mã và cho ra một nhãn vô nghĩa).
 *
 * ⚠ Trả `""` khi không suy được, **không** trả một chuỗi tiếng Việt cứng: nhãn mặc định là việc
 *   của giao diện (`t()` ba locale). Nhét "Phiên chưa đặt tên" vào CSDL là ghim một ngôn ngữ vào
 *   dữ liệu — đúng lớp lỗi mà đợt F11/F12 vừa trả giá.
 */
export function nhanTuLuot(turns: readonly LuotPhien[]): string {
  const dau = turns.find((t) => t.role === "user");
  if (!dau) return "";
  // Gộp mọi khoảng trắng (kể cả xuống dòng) thành một dấu cách ⇒ nhãn luôn MỘT dòng.
  const mot = dau.content.replace(/\s+/g, " ").trim();
  if (mot === "") return "";
  if (mot.length <= GIOI_HAN_PHIEN.DAI_NHAN) return mot;
  return mot.slice(0, GIOI_HAN_PHIEN.DAI_NHAN - 1) + "…";
}
