/**
 * ★★★ doc 83 — **CẦU NỐI: MỘT CỬA DUY NHẤT từ mọi mặt tiếp xúc KHÔNG-WEB (CLI · MCP) vào lớp an
 * toàn ĐÃ CÓ.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ BẤT BIẾN SỐ MỘT CỦA FILE NÀY: **NÓ KHÔNG BIẾT LÀM GÌ CẢ.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * File này KHÔNG chứa: hộp cát, phép phán quyết đường dẫn, băm TOCTOU, hàng rào tệp bẩn, danh
 * sách trắng lệnh, phép kiểm RBAC, hay một cửa ghi đĩa. Nó **không nhập `node:fs`** một lần nào.
 * Mọi việc ấy đã có chủ, và chủ của chúng là mã đang chạy trên web hôm nay:
 *
 *     CLI / MCP
 *        └─► cauNoiCli (file này)                     ← chỉ dựng `ToolExecContext` + gác HITL
 *              ├─► streamAnswer(codingMode:true)      ← aiLocalKnowledgeService (đường web dùng)
 *              │     └─► streamCodingAnswer → tryExecuteCodingToolLoop → executeDecision
 *              │                                        ├─ read tool  → handler + argsWithAuthCtx
 *              │                                        └─ write tool → proposeAction  (HITL)
 *              ├─► executeDecision(...)               ← đường TOOL TRỰC TIẾP (MCP)
 *              └─► confirmAction(...)                 ← CHỈ sau khi NGƯỜI gõ đồng ý
 *
 * Viết một bản thứ hai của bất kỳ hàng rào nào ở đây là cách chúng lệch nhau. Repo này đã đếm lớp
 * lỗi *"hai bản sao của một vị từ an toàn"* nhiều lần; xem `_uyQuyenAnh.ts`, `phanQuyetDuongDan`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ HAI THỨ FILE NÀY **CÓ** SỞ HỮU, và cả hai đều là hàng rào MỚI (không có bản cũ để dùng lại)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  1. **`duyetVaGhi()` — cổng HITL Ở TERMINAL.** Trên web, người bấm một cái nút; ở đây người gõ
 *     một ký tự. Cổng phải phát biểu được *"ĐÃ CÓ NGƯỜI ĐỒNG Ý"* theo **CẤU TẠO**, nên nó nhận
 *     `dongY: boolean` và `confirmAction` nằm **sau một câu `if (dongY !== true) return`**. Đây là
 *     **điểm gọi `confirmAction` DUY NHẤT** của cả CLI lẫn MCP —
 *     `cauNoiCli.census.test.ts` đếm bằng AST, nên một điểm gọi thứ hai ⇒ ĐỎ.
 *     ⚠ `=== true` chứ không phải truthy: `"n"`, `"0"`, `"no"` đều là chuỗi truthy trong JS, và một
 *       người gõ `n` mà bị coi là đồng ý là chế độ hỏng tệ nhất mà tính năng này có thể có.
 *  2. **`chotAnToanTienTrinh()` — CHỐT VRAM.** Xem docblock của chính nó.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ GỐC DỰ ÁN: CLI NHẬN **ID**, KHÔNG BAO GIỜ NHẬN ĐƯỜNG DẪN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `moPhienCli` gọi `phanGiaiGoc(projectId)` — đúng cửa mà tRPC và đường chat web dùng. Một người
 * gõ `--du-an D:\SOURCES\bi-mat` sẽ trượt `ID_HOP_LE` (`[A-Za-z0-9_-]{1,64}`) rồi trượt
 * `gocTheoId` ⇒ `PROJECT_NOT_FOUND`. **Không có tham số đường dẫn nào trong cả CLI lẫn MCP**;
 * `cauNoiCli.census.test.ts` §2 cưỡng chế điều đó bằng AST trên hai tệp điểm vào.
 */
import {
  confirmAction,
  getPendingActionForUser,
  listPendingActionsForUser,
  type PendingActionDTO,
  type PendingActionSummary,
} from "../aiCopilotActions";
import { streamAnswer, type ConversationMessage, type StreamEvent } from "../aiLocalKnowledgeService";
import { executeDecision, type ToolExecContext, type ToolExecOutcome, type ToolLang } from "../aiLocalTools";
import { danhSachDuAn, phanGiaiGoc, type DuAnHopCat } from "../aiLocalTools/repoProjects";
import type { DanhTinhCli } from "./danhTinhCli";

/**
 * ★★★ **CHỐT VRAM — bắt buộc gọi ở dòng đầu của MỌI điểm vào không-web.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ ĐO ĐƯỢC TRÊN `.env` ĐANG CHẠY: `LLAMA_SERVER_STRICT` **CỐ Ý ĐỂ TẮT** (dòng 803 của `.env`,
 * nguyên văn: *"server chết ⇒ tự lùi về in-process + log cảnh báo rõ ràng"*).
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Với **máy chủ web** đó là một lựa chọn hợp lý: một tiến trình thường trú, có sổ VRAM, tự lùi để
 * không chết hẳn. Với một **CLI** thì nó là một cái bẫy: mỗi lần llama-server bận/ốm, tiến trình
 * CLI sẽ **nạp bản thứ hai của model ~19 GB** vào card mà llama-server đang giữ ~26,7 GB. Doc 79
 * đã ghi đúng chế độ hỏng ấy dưới một tên khác (hộ ma VRAM ⇒ *"AI ngừng trả lời hoàn toàn"*), và
 * một CLI người ta chạy nhiều lần trong ngày là cách nhanh nhất để tái tạo nó.
 *
 * ⇒ CLI **ép `LLAMA_SERVER_STRICT=true` cho TIẾN TRÌNH CỦA CHÍNH NÓ**. Hệ quả: llama-server không
 *   phục vụ được thì lượt gọi model **NÉM một lỗi nói rõ lý do**, thay vì lặng lẽ chiếm card.
 * ⚠ `process.env` là của **tiến trình này**; máy chủ web không đổi một byte. Đây là lý do chốt nằm
 *   ở đây chứ không nằm trong `.env`.
 */
export function chotAnToanTienTrinh(): void {
  process.env.LLAMA_SERVER_STRICT = "true";
}

export const MA_PHIEN = {
  /** `projectId` không có trong danh sách TRẮNG `AI_REPO_SANDBOX_ROOTS` (hoặc là một đường dẫn). */
  DU_AN_KHONG_CO: "PROJECT_NOT_FOUND",
} as const;
export type MaPhien = (typeof MA_PHIEN)[keyof typeof MA_PHIEN];

export interface PhienCli {
  readonly duAn: DuAnHopCat;
  readonly execCtx: ToolExecContext;
  readonly lang: ToolLang;
}

export type KetQuaMoPhien =
  | { readonly ok: true; readonly phien: PhienCli }
  | { readonly ok: false; readonly ma: MaPhien; readonly loi: string };

/** Danh sách dự án hợp lệ — dùng lại NGUYÊN bộ phân tích danh sách trắng của trục 2. */
export function danhSachDuAnCli(): DuAnHopCat[] {
  return danhSachDuAn();
}

/**
 * Mở một phiên CLI/MCP. Nhận **danh tính ĐÃ CHỨNG MINH** (`xacThucCli`) — không có quá tải nào
 * nhận `userId` trần, nên không có đường nào dựng được một phiên từ một con số bịa.
 */
export function moPhienCli(p: {
  danhTinh: DanhTinhCli;
  projectId: string | null | undefined;
  lang?: ToolLang;
  nguon: "cli" | "mcp";
}): KetQuaMoPhien {
  const pg = phanGiaiGoc(p.projectId ?? undefined);
  if (!pg.ok) {
    return {
      ok: false,
      ma: MA_PHIEN.DU_AN_KHONG_CO,
      loi:
        `Dự án "${String(p.projectId)}" không nằm trong danh sách TRẮNG (AI_REPO_SANDBOX_ROOTS). ` +
        `CLI chỉ nhận ID dự án, KHÔNG nhận đường dẫn. Dự án hợp lệ: ` +
        danhSachDuAn()
          .map((d) => `${d.id} (${d.ten})`)
          .join(" · "),
    };
  }
  const id = pg.id ?? danhSachDuAn()[0]!.id;
  const duAn = danhSachDuAn().find((d) => d.id === id) ?? danhSachDuAn()[0]!;
  const lang: ToolLang = p.lang ?? "vi";

  return {
    ok: true,
    phien: {
      duAn,
      lang,
      execCtx: {
        // ★ Danh tính THẬT — cùng ba ô mà `buildExecCtx` của tuyến web dựng từ `ctx.user`.
        user: { id: p.danhTinh.userId, role: p.danhTinh.role, name: p.danhTinh.ten },
        lang,
        // ★ Ba ô ghi sổ. `req` chỉ đi vào audit (xem `buildAuditCtx`), không vào phán quyết nào.
        req: { ip: `cli:${p.nguon}`, headers: { "user-agent": `avi-coding-${p.nguon}` } },
        // ★★★ GỐC DỰ ÁN đã phân giải SERVER-SIDE từ id trong danh sách trắng. `argsWithAuthCtx`
        //     xoá mọi `__projectRoot` từ đầu vào rồi gán lại từ đúng ô này.
        projectRoot: pg.goc ?? undefined,
      },
    },
  };
}

/**
 * ★ MỘT LƯỢT HỘI THOẠI — uỷ quyền **nguyên vẹn** cho `streamAnswer` với `codingMode:true`, tức
 * ĐÚNG hàm mà `/api/ai/local-kb/stream` gọi cho `/ai-coding-workspace`.
 *
 * ⇒ CLI thừa hưởng **không sửa một byte**: persona lập trình · 5 tool · vòng lặp tool đa bước ·
 *   ngữ cảnh mã (mục lục → mã thật) · sinh mã · sửa theo KHỐI · lô nhiều tệp · bài học xuyên phiên ·
 *   HITL cho mọi tool ghi. Thêm một tính năng vào web là CLI có ngay, và ngược lại.
 */
export function chayLuot(
  phien: PhienCli,
  cauHoi: string,
  lichSu: ConversationMessage[] = [],
): AsyncGenerator<StreamEvent> {
  return streamAnswer(cauHoi, 5, lichSu, "engineer", { codingMode: true, projectId: phien.duAn.id, uiLanguage: phien.lang }, phien.execCtx);
}

/**
 * ★ ĐƯỜNG TOOL TRỰC TIẾP — cho MCP, nơi bên gọi (một tác nhân khác) đã biết nó muốn tool nào.
 *
 * ⚠⚠ Đây **KHÔNG** phải một cửa hậu quanh HITL: `executeDecision` phân nhánh theo `isWriteTool`,
 * và mọi tool ghi rơi vào `proposeAction` ⇒ trả `pendingAction`, **0 byte chạm đĩa**. Muốn ghi
 * thì vẫn phải qua `duyetVaGhi`, và `duyetVaGhi` **không có mặt trong MCP** (xem `mcpServer.ts`).
 */
export function chayTool(
  phien: PhienCli,
  tool: string,
  args: Record<string, unknown>,
): Promise<ToolExecOutcome> {
  return executeDecision({ tool, args }, phien.execCtx);
}

export const MA_DUYET = {
  /** Người KHÔNG gõ đồng ý ⇒ không ghi. Đây là đường ra mặc định, không phải ngoại lệ. */
  NGUOI_TU_CHOI: "NGUOI_TU_CHOI",
} as const;

export type KetQuaDuyet =
  | { readonly ok: true; readonly trangThai: string; readonly thongDiep?: string; readonly ketQua?: unknown }
  | { readonly ok: false; readonly ma: string; readonly thongDiep: string };

/**
 * ★★★ **CỔNG HITL Ở TERMINAL — ĐIỂM GỌI `confirmAction` DUY NHẤT của CLI và MCP.**
 *
 * ⚠⚠⚠ `dongY` phải là **`true` theo giá trị**, không phải "truthy". Người gõ `n` gửi xuống chuỗi
 *     `"n"`, và `"n"` là truthy. Một `if (dongY)` ở đây biến *"không"* thành *"có"* trong im lặng —
 *     đúng chế độ hỏng mà cả hàng rào HITL sinh ra để chặn.
 *
 * ⚠ Người gọi **không** được tự gọi `confirmAction`. `cauNoiCli.census.test.ts` §1 đếm bằng AST:
 *   toàn bộ `server/services/aiCodingCli/**` + `scripts/ai-coding-cli/**` có **đúng MỘT** điểm gọi
 *   `confirmAction(`, và nó nằm trong hàm này, SAU câu `if (dongY !== true)`.
 *
 * ⚠ Băm chống TOCTOU **không** được kiểm lại ở đây, và đó là điều ĐÚNG: `applyDiff.phanQuyet()`
 *   chạy trong `execute()` (tức SAU `confirmAction`) và so băm(tệp thật) với băm(`original`) một
 *   lần NỮA. Viết một phép kiểm băm thứ hai ở tầng CLI là dựng bản sao thứ hai của một vị từ an
 *   toàn — cái sai mà file này tồn tại để tránh.
 *
 * ⚠ ĐỢT 3 (2026-08-23) — CLI **áp TẤT CẢ khối**, cố ý không truyền `selectedHunkIds` (tham số mới
 *   của `confirmAction` cho thẻ duyệt web). Thẻ duyệt terminal VẼ theo khối bằng đúng
 *   `computeHunkPlan` (cli.ts) nên người đọc thấy từng khối, nhưng CHỌN từng khối ở terminal là
 *   một UI khác hẳn (đọc phím điều hướng khối, vẽ lại trạng thái chọn) — để dành, không làm nửa
 *   vời. Không truyền ⇒ server đi nguyên đường cũ, từng byte — đó chính là hợp đồng tương thích
 *   ngược mà đợt 3 cam kết.
 */
export async function duyetVaGhi(
  phien: PhienCli,
  pending: Pick<PendingActionDTO, "actionId" | "token">,
  dongY: boolean,
): Promise<KetQuaDuyet> {
  if (dongY !== true) {
    return {
      ok: false,
      ma: MA_DUYET.NGUOI_TU_CHOI,
      thongDiep: "Bạn KHÔNG duyệt — không có byte nào được ghi. Đề xuất sẽ tự hết hạn.",
    };
  }
  const kq = await confirmAction(
    pending.actionId,
    pending.token,
    { id: phien.execCtx.user.id, role: phien.execCtx.user.role, name: phien.execCtx.user.name ?? null },
    phien.lang,
    phien.execCtx.req,
  );
  if (!kq.ok) return { ok: false, ma: kq.reason ?? kq.status, thongDiep: kq.message ?? kq.status };
  return { ok: true, trangThai: kq.status, thongDiep: kq.message, ketQua: kq.result };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// HỘP THƯ ĐỀ XUẤT — hai lượt CHUYỂN TIẾP mỏng sang chủ của bảng `ai_pending_actions`
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠⚠ **KHÔNG có một câu SQL nào ở đây, và đó là chủ ý — census đã bắt bản đầu của tôi.** Bản ấy tự
 * truy vấn `ai_pending_actions` ngay trong file này; `cauNoiCli.census.test.ts` §2.3 đỏ vì file này
 * có bất biến *"nó không biết làm gì cả"*. Census đúng ở mức sâu hơn một con số: bảng ấy đã có
 * **một chủ** (`aiCopilotActions.ts` — nơi `propose` ghi vào và `confirm` đọc ra), và một nơi thứ
 * hai cùng biết về nó là bước đầu của lớp lỗi *"hai bản sao của một vị từ"* mà cả file này được
 * viết ra để tránh.
 * ⇒ Ba ràng buộc (chủ sở hữu · còn hạn · đang chờ) sống **một chỗ duy nhất**, trong mệnh đề `where`
 *   của `listPendingActionsForUser` / `getPendingActionForUser`.
 *
 * ⚠ `phien.execCtx.user.id` là danh tính ĐÃ CHỨNG MINH (`xacThucCli` → `moPhienCli`); không có quá
 *   tải nào nhận một `userId` trần, nên không đường nào đọc hộp thư của người khác từ đây.
 */
export type DeXuatCho = PendingActionSummary & {
  /** ID dự án suy ngược từ `projectRoot` qua danh sách TRẮNG. `null` nếu gốc không còn trong đó. */
  duAnId: string | null;
};

/** ⚠ So gốc bằng chuỗi ĐÃ CHUẨN HOÁ hoa/thường + bỏ dấu phân cách cuối: Windows coi `D:\X` ≡ `d:\x\`. */
function duAnTheoGoc(goc: string | null): string | null {
  if (goc === null) return null;
  const chuan = goc.replace(/[\\/]+$/, "").toLowerCase();
  const m = danhSachDuAn().find((d) => d.goc.replace(/[\\/]+$/, "").toLowerCase() === chuan);
  return m ? m.id : null;
}

export async function danhSachDeXuatCho(phien: PhienCli): Promise<DeXuatCho[]> {
  const ds = await listPendingActionsForUser(phien.execCtx.user.id);
  return ds.map((d) => ({ ...d, duAnId: duAnTheoGoc(d.projectRoot) }));
}

export async function layDeXuatCho(phien: PhienCli, actionId: unknown): Promise<PendingActionDTO | null> {
  return getPendingActionForUser(phien.execCtx.user.id, actionId);
}

export type { StreamEvent, ConversationMessage, PendingActionDTO };
