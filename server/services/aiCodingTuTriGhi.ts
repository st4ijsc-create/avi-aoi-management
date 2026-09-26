/**
 * ★★★ 2026-08-24 · VÒNG TỰ-TRỊ-GHI — **model TỰ GHI mã (`apply_diff`) + TỰ CHẠY test, LẶP tới khi
 * xanh/trần, KHÔNG người duyệt từng lượt.** Đây là thay đổi NGUY HIỂM NHẤT hệ này từng làm.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ RANH GIỚI ĐÃ CHỐT VỚI CHỦ DỰ ÁN — ĐỌC TRƯỚC KHI SỬA MỘT DÒNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `aiCodingVerify.ts` khai *"HITL trên mỗi lượt GHI là bất biến"* và `autonomyPolicy.ts` xếp
 * `apply_diff` vào `AUTONOMY_INELIGIBLE` kèm *"bất biến mà doc 79 cũng KHÔNG được phép chạm"*. Chủ
 * dự án đã quyết TƯỜNG MINH gỡ đúng bất biến ấy (sau khi được nêu rõ "không đảo được nếu model
 * phá"). File này là cái cửa đó — nên nó gánh SÁU hàng rào, và **không cái nào là tuỳ chọn**, và
 * mỗi cái đều đo được:
 *
 *   1. **MẶC ĐỊNH TẮT + kill-switch runtime.** Cờ `AI_CODING_TU_TRI_GHI` (mặc định TẮT, chỉ `"1"`
 *      bật) đọc qua `autonomyPolicy.autonomyGhiTuTriBat`; kill-switch dùng LẠI
 *      `autonomyPolicy.isKillSwitchTripped` (bền qua restart, đọc TƯƠI mỗi lượt) — KHÔNG dựng cái
 *      thứ hai.
 *   2. **LỆNH PHÁ HUỶ NGOÀI TẦM.** Bước CHẠY dùng lại `aiCodingVerify.chayKiemChung` → danh sách
 *      trắng HẸP (`NHAN_KIEM_CHUNG`, `git checkout`/`rm`/`DROP` KHÔNG có). File này KHÔNG nới nó.
 *   3. **HỘP CÁT + secret nguyên vẹn.** Bước GHI đi qua ĐÚNG `apply_diff` → `phanQuyetDuongDan` +
 *      `writeConfined` + cấm `.env`/bí mật. Không cửa ghi thứ hai.
 *   4. **TỆP BẨN CỦA NGƯỜI ⇒ DỪNG.** `applyDiff` barrier 4 trả `note:"FILE_DIRTY"` ⇒ vòng DỪNG với
 *      `tep_ban_nguoi`, đĩa 0 đổi. Không đè công việc chưa lưu của con người (sự cố 2026-08-18).
 *   5. **TRẦN CỨNG 10 + DỪNG-KHÔNG-TIẾN-BỘ.** `kepTranVongTuTri` kẹp `[1..10]`; `quyetDinhTiep`
 *      (thuần, `shared/aiCodingLoop.ts`) dừng khi số ca đỏ không giảm / đầu ra lặp.
 *   6. **AUDIT WORM TỪNG LƯỢT.** Mỗi lượt ghi+chạy ⇒ một hàng `audit_logs`
 *      (`AI_CODING_TU_TRI_LUOT`): băm TRƯỚC/SAU tệp, lệnh đã chạy, kết quả test, lượt thứ mấy.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * KHỞI ĐỘNG PHẢI TƯỜNG MINH — MỘT CHỖ DUY NHẤT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Vòng chỉ chạy khi người dùng khởi động một TÁC VỤ tự trị tường minh (`laYDinhTuTri`, ví dụ *"tự
 * sửa cho test xanh"*) VÀ cờ bật. Một câu *"đọc tệp X"* hay *"giải thích"* KHÔNG BAO GIỜ khởi động vòng.
 * Điểm khởi động là `khoiDongTuTriGhiDuoc` — một vị từ, có lưới.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ CƠ CHẾ — TÁI DÙNG TỐI ĐA, KHÔNG DỰNG BẢN SAO
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bước GHI mượn ĐÚNG cửa mà `aiCodingVerify` mượn cho `run_command`: `executeDecision` (→
 * `proposeAction`) → `confirmAction(..., { reason })`. "Người duyệt" được thay bằng "chính sách tự
 * trị đã bật cờ" (`apDungDiffTuTriDuoc` — vị từ trong `autonomyPolicy.ts`, CHỈ `true` cho
 * `apply_diff` khi cờ bật). Bước CHẠY mượn NGUYÊN `chayKiemChung`. Quyết định DỪNG/ĐI mượn NGUYÊN
 * `quyetDinhTiep`. File này chỉ là bộ **điều phối** ba mảnh ấy + cổng khởi động + sổ WORM.
 *
 * ⚠ **PHỤ THUỘC CỜ KÉP CÓ CHỦ Ý**: vòng tự-ghi dùng `chayKiemChung` cho bước CHẠY, mà `chayKiemChung`
 *   đòi `AI_CODING_AUTOLOOP=1`. Nên vòng tự-ghi cần **CẢ HAI** cờ (`AI_CODING_AUTOLOOP=1` +
 *   `AI_CODING_TU_TRI_GHI=1`). Đây là phòng vệ theo chiều sâu, không phải phiền hà: không ai bật được
 *   "tự ghi" mà chưa bật "tự chạy test" — hai công tắc độc lập cho một hành vi nguy hiểm.
 *
 * ⚠ Nội dung bản vá KHÔNG sinh ở đây: nó tới từ tầng model (persona sửa + `khoiNguCanhMa`) qua tham
 *   số `sinhBanVa` được TIÊM VÀO — nhờ đó lưới chạy được KHÔNG cần model 30B (`sinhBanVa` giả).
 */
import {
  apDungDiffTuTriDuoc,
  autonomyGhiTuTriBat,
  isKillSwitchTripped,
} from "./ai/autonomyPolicy";
import { laYDinhTuTri } from "./aiLocalTools/intentClassifier";
import { chayKiemChung, type MaTuChoiKiemChung } from "./aiCodingVerify";
import { executeDecision, type ToolExecContext, type ToolLang } from "./aiLocalTools";
import { confirmAction, type CopilotUser } from "./aiCopilotActions";
import { phanGiaiGoc } from "./aiLocalTools/repoProjects";
import {
  AUDIT_ACTIONS,
  ENTITY_TYPES,
  createAuditContext,
  logCrudOperation,
} from "./auditTrailService";
import {
  bamChuoi,
  catLoiChoPrompt,
  chuanHoaDauRa,
  kepTranVongTuTri,
  maTuChoiGhi,
  quyetDinhTiep,
  type LyDoDungVong,
} from "@shared/aiCodingLoop";

/**
 * ★ Lý do đánh dấu lượt confirm TỰ ĐỘNG trong audit của `confirmAction`. KHÁC
 * `AI_CODING_AUTOLOOP_VERIFY` (chỉ bước CHẠY): reason này gắn với một lượt GHI không người duyệt,
 * nên nó phải phân biệt được ở sổ audit — "ai đã duyệt lượt ghi này" trả lời "chính sách tự trị".
 */
export const LY_DO_TU_TRI_GHI = "AI_CODING_TU_TRI_GHI" as const;

/** Trần số lượt của vòng TỰ-GHI, đọc env TẠI CHỖ (lưới lật env theo ca). Kẹp `[1..10]`. */
export function tranTuTriGhi(): number {
  return kepTranVongTuTri(process.env.AI_CODING_TU_TRI_GHI_MAX);
}

/**
 * ★★★ CỔNG KHỞI ĐỘNG — điểm DUY NHẤT quyết định *"câu này có được mở vòng tự-ghi không"*.
 * Đủ HAI vế: (a) người dùng XIN tường minh (`laYDinhTuTri`); (b) chính sách CHO PHÉP (cờ bật, qua
 * vị từ `apDungDiffTuTriDuoc`). Kill-switch async được kiểm ở TỪNG lượt trong vòng (không ở đây).
 *
 * ⚠ Đột biến "gỡ `laYDinhTuTri`" ⇒ câu thường mở được vòng ⇒ ĐỎ; "gỡ `apDungDiffTuTriDuoc`" ⇒ cờ
 *   TẮT vẫn mở ⇒ ĐỎ. Hai vế, hai đột biến độc lập.
 */
export function khoiDongTuTriGhiDuoc(question: string): boolean {
  return laYDinhTuTri(question) && apDungDiffTuTriDuoc("apply_diff");
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ CỜ CẢNH BÁO "MODEL ĐÃ CHẠM TỆP TEST" — chống-gaming ở TẦNG AUDIT, KHÔNG chặn cứng
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ ĐÃ BỎ `trichTepTuLoi` (regex-nhặt-tệp-đầu) — CÓ GHI LÝ DO (nghiệm thu LIVE 30B 2026-08-24)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản đầu cho một regex nhặt đường dẫn ĐẦU TIÊN trong đầu ra test rồi qua `phanQuyetDuongDan`.
 * Live bắt HAI lỗ chết: (1) `dotnet test` khi TEST đỏ in stack đường TUYỆT ĐỐI tới tệp test
 * (`... in C:\…\tests\CalculatorTests.cs:line 35`) ⇒ hộp cát từ chối ⇒ vòng dừng SAI lý do; (2) kể
 * cả nới, nó trỏ tệp TEST chứ không phải tệp NGUỒN có bug ⇒ model sẽ sửa TEST để gaming — tệ hơn.
 * ⇒ Đã thay bằng: **MODEL CHỌN tệp** (từ cây `list_files` thật) + **server XÁC THỰC**
 * (`aiCodingAgent.dungBanVaTuManifest`). `trichTepTuLoi` cùng lưới oracle của nó đã bị gỡ.
 *
 * ★ CÒN LẠI ở đây là cờ AUDIT: nếu đường model chọn là một tệp TEST, sổ WORM ghi `sua_tep_test:true`.
 * KHÔNG chặn cứng (sửa test đôi khi hợp lệ), nhưng người xem lại PHẢI thấy được model đã chạm test —
 * đây là chống-gaming ở tầng audit. Đột biến "cờ luôn false" ⇒ ca audit-tệp-test ĐỎ.
 */
const RE_TEP_TEST_THU_MUC = /(^|[/\\])tests?[/\\]/i;
/**
 * ⚠ Tên tệp TEST đòi BIÊN, không "test" ở đâu cũng tính — nếu không `contest.ts`/`latest.cs` bị nhận
 *   nhầm. Hai quy ước tách nhau: JS/TS dùng `.test.`/`.spec.` (biên là dấu ngăn `. _ - / \`); .NET
 *   dùng hậu tố PascalCase `FooTest(s).cs` (chữ T HOA phân biệt `CalculatorTests.cs` với `latest.cs`).
 */
const RE_TEP_TEST_TEN_JS = /(^|[._/\\-])(tests?|spec)\.[cm]?[jt]sx?$/i;
const RE_TEP_TEST_TEN_CS = /(^|[A-Za-z0-9])Tests?\.cs$/;

export function laTepTest(duong: string | null | undefined): boolean {
  const s = String(duong ?? "");
  return RE_TEP_TEST_THU_MUC.test(s) || RE_TEP_TEST_TEN_JS.test(s) || RE_TEP_TEST_TEN_CS.test(s);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// MỘT LƯỢT TỰ GHI (apply_diff — KHÔNG người duyệt)
// ══════════════════════════════════════════════════════════════════════════════════════════════
export interface YeuCauLuotGhi {
  /** id dự án (danh sách TRẮNG). Vắng ⇒ gốc mặc định. **KHÔNG BAO GIỜ là một đường dẫn.** */
  projectId?: string;
  /** Đường dẫn tệp (tương đối gốc dự án) — model chọn. Hộp cát của `apply_diff` phán quyết. */
  path: string;
  /** Nội dung tệp model TIN là đang có (từ `read_file`) — băm neo TOCTOU. */
  original: string;
  /** Nội dung mong muốn. */
  modified: string;
  /** Lượt thứ mấy (1-based). Server kiểm trần. */
  luot: number;
}

export type MaLuotGhi =
  | "TU_TRI_TAT" // cờ AI_CODING_TU_TRI_GHI vắng/lạ ⇒ vòng tự-ghi KHÔNG xảy ra
  | "KILL_SWITCH" // kill-switch runtime đã bật
  | "NO_EXEC_CONTEXT"
  | "LOOP_CAP"
  | "PROJECT_NOT_FOUND"
  | "DENIED" // RBAC từ chối ở propose (thiếu ai_repo_read/canEdit)
  | "TEP_BAN_NGUOI" // applyDiff trả FILE_DIRTY — tệp có thay đổi CHƯA COMMIT của người
  | "GHI_TU_CHOI" // applyDiff trả một note khác (BASE_MISMATCH/PATH_REJECTED/…)
  | "RUN_FAILED";

export interface KetQuaLuotGhi {
  /** `true` ⇔ BYTE đã vào đĩa. */
  ok: boolean;
  ma: MaLuotGhi | null;
  message: string | null;
  path: string | null;
  bytes: number | null;
  created: boolean;
  bamTruoc: string | null;
  bamSau: string | null;
  /** Mã note khi `apply_diff.execute` TỪ CHỐI dù `confirmAction` trả ok (xem `daBiTuChoiGhi`). */
  maTuChoi: string | null;
  tran: number;
}

/** Hình dạng TỐI THIỂU của `apply_diff` ToolResult mà lượt ghi cần đọc (tránh nhập kiểu private). */
interface KetQuaApDung {
  note?: string | null;
  textSummary?: string | null;
  data?: {
    path?: string | null;
    bytes?: number | null;
    created?: boolean;
    sha256Before?: string | null;
    sha256After?: string | null;
  } | null;
}

/**
 * ★★★ MỘT LƯỢT GHI. Đi qua `executeDecision` → `proposeAction` → `confirmAction` — ĐÚNG cửa người
 * bấm vẫn đi, cùng RBAC hai lần, cùng hàng `ai_pending_actions`, cùng bốn hàng rào của pha C
 * (`applyDiff`). Thứ DUY NHẤT khác một lượt người bấm: **không có người bấm** — và audit ghi rõ điều
 * đó qua `{ reason: LY_DO_TU_TRI_GHI }`.
 *
 * ⚠ Tên tool là một HẰNG CHỮ `"apply_diff"`. Không tham số nào chọn tool ⇒ không có đường cho lượt
 *   này chạy một lệnh hay ghi qua một tool khác.
 */
export async function chayLuotTuTriGhi(
  y: YeuCauLuotGhi,
  execCtx: ToolExecContext | undefined,
  user: CopilotUser,
  lang: ToolLang,
): Promise<KetQuaLuotGhi> {
  const tran = tranTuTriGhi();
  const rong = (ma: MaLuotGhi, message: string | null = null, maTuChoi: string | null = null): KetQuaLuotGhi => ({
    ok: false, ma, message, path: null, bytes: null, created: false, bamTruoc: null, bamSau: null, maTuChoi, tran,
  });

  // ── HÀNG RÀO 1 — cờ (qua VỊ TỪ apDungDiffTuTriDuoc) + kill-switch runtime ──────────────────────
  if (!apDungDiffTuTriDuoc("apply_diff")) return rong("TU_TRI_TAT");
  if (await isKillSwitchTripped()) return rong("KILL_SWITCH");
  if (!execCtx) return rong("NO_EXEC_CONTEXT");
  if (!Number.isInteger(y.luot) || y.luot < 1 || y.luot > tran) return rong("LOOP_CAP");

  const goc = phanGiaiGoc(y.projectId);
  if (!goc.ok) return rong("PROJECT_NOT_FOUND");
  const ctx: ToolExecContext = goc.goc ? { ...execCtx, projectRoot: goc.goc } : execCtx;

  // ── ĐỀ XUẤT (đúng cửa HITL) ────────────────────────────────────────────────────────────────────
  const out = await executeDecision(
    { tool: "apply_diff", args: { path: y.path, original: y.original, modified: y.modified } },
    ctx,
  );
  if (out.denied) return rong("DENIED", out.denied.message ?? null);
  if (!out.pendingAction) return rong("RUN_FAILED", out.error ?? null);

  // ── XÁC NHẬN — không có người bấm; "người duyệt" = "chính sách tự trị đã bật cờ" ────────────────
  const kq = await confirmAction(
    out.pendingAction.actionId,
    out.pendingAction.token,
    user,
    lang,
    execCtx.req,
    {},
    { reason: LY_DO_TU_TRI_GHI },
  );
  if (!kq.ok) return rong("RUN_FAILED", kq.message ?? kq.status);

  // ── ĐỌC KẾT QUẢ — `confirmAction.ok` chỉ nói "vòng đời chạy hết chặng", KHÔNG nói "byte đã vào
  //    đĩa". `applyDiff.execute` TỪ CHỐI (tệp bẩn/băm lệch/…) vẫn trả ok kèm `note` (xem
  //    `daBiTuChoiGhi`/`maTuChoiGhi`). Đọc note TRƯỚC khi tin là đã ghi.
  const kqAp = kq.result as unknown as KetQuaApDung | null | undefined;
  const note = maTuChoiGhi(kq.result);
  if (note !== null) {
    const message = kqAp?.textSummary ?? null;
    // Tệp bẩn của NGƯỜI ⇒ lý do RIÊNG (không phải "model sai") ⇒ vòng DỪNG, đĩa 0 đổi.
    if (note === "FILE_DIRTY") return rong("TEP_BAN_NGUOI", message, note);
    return rong("GHI_TU_CHOI", message, note);
  }

  const data = kqAp?.data ?? null;
  return {
    ok: true,
    ma: null,
    message: kqAp?.textSummary ?? null,
    path: data?.path ?? null,
    bytes: data?.bytes ?? null,
    created: data?.created === true,
    bamTruoc: data?.sha256Before ?? null,
    bamSau: data?.sha256After ?? null,
    maTuChoi: null,
    tran,
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// AUDIT WORM MỘT LƯỢT (băm trước/sau · lệnh · kết quả test · lượt thứ mấy)
// ══════════════════════════════════════════════════════════════════════════════════════════════
export interface AuditLuotTuTri {
  luot: number;
  command: string | null;
  soDo: number | null;
  soXanh: number | null;
  xanh: boolean;
  bamTruoc: string | null;
  bamSau: string | null;
  path: string | null;
  /** ★ Model đã chọn ghi vào một tệp TEST? Cờ chống-gaming (xem `laTepTest`). KHÔNG chặn — chỉ khai. */
  suaTepTest: boolean;
}

/**
 * MỘT hàng WORM cho MỘT lượt của vòng. **Best-effort**: một lỗi ghi sổ KHÔNG được làm chết vòng
 * (cùng kỷ luật với audit follow-up ở `proposeAction`) — nhưng một lượt tự-ghi KHÔNG có hàng audit
 * là một lượt model đã làm gì đó mà không ai truy lại được, nên nó được ghi ở đường CHÍNH, không
 * phải nhánh phụ.
 */
export async function ghiAuditLuotTuTri(user: CopilotUser, req: ToolExecContext["req"], a: AuditLuotTuTri): Promise<void> {
  try {
    await logCrudOperation(createAuditContext({ user: { id: user.id, name: user.name ?? null }, req }), {
      action: AUDIT_ACTIONS.AI_CODING_TU_TRI_LUOT,
      entityType: ENTITY_TYPES.AI_ACTION,
      entityName: a.path ?? "(no-write)",
      details: {
        operation: "AI_CODING_TU_TRI_LUOT",
        metadata: {
          luot: a.luot,
          command: a.command,
          test: { soDo: a.soDo, soXanh: a.soXanh, xanh: a.xanh },
          sha256Before: a.bamTruoc,
          sha256After: a.bamSau,
          path: a.path,
          // ★ Chống-gaming: model chọn ghi vào tệp TEST ⇒ khai TRONG sổ (không chặn).
          sua_tep_test: a.suaTepTest,
          autonomy: { reason: LY_DO_TU_TRI_GHI },
        },
      },
      status: "success",
    });
  } catch {
    /* best-effort — không để một lỗi ghi sổ làm chết vòng */
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// BỘ ĐIỀU PHỐI VÒNG — chạy test → đọc lỗi → tự ghi → chạy lại → …
// ══════════════════════════════════════════════════════════════════════════════════════════════
/** Sinh bản vá kế tiếp từ lỗi test (tầng model — TIÊM VÀO để lưới chạy không cần 30B). */
export type SinhBanVa = (
  loi: string,
  luot: number,
) => Promise<{ path: string; original: string; modified: string } | null>;

/**
 * ★★★ TIẾN ĐỘ TỪNG LƯỢT — móc QUAN SÁT (không phải hàng rào thứ bảy).
 *
 * Vòng chạy tới 10 lượt × (một lượt model ~30–75 s + một lượt test tới 240 s). Nếu điểm gọi chỉ
 * `await` kết quả cuối thì người dùng nhìn màn hình đứng im nhiều phút — đúng thứ đường tool đã dựng
 * hàng-chờ-đánh-thức để tránh (`aiLocalKnowledgeService.streamAnswer`). Móc này để điểm gọi PHÁT
 * "vòng tự trị · lượt i/N · N test đỏ · đang tự sửa…" NGAY khi nó xảy ra.
 *
 * ⚠ THUẦN QUAN SÁT: nó KHÔNG đổi luồng điều khiển, KHÔNG quyết định dừng/đi, KHÔNG ghi. Bỏ nó đi
 *   (mọi lời gọi 5-tham-số cũ) thì vòng chạy y hệt — chỉ mất phần hiển thị tiến độ.
 */
export interface TienDoTuTri {
  luot: number;
  tran: number;
  /** `"chay"` = vừa chạy test xong (đã biết số đỏ/xanh); `"sua"` = sắp sinh + ghi bản vá cho lượt này. */
  pha: "chay" | "sua";
  soDo: number | null;
  soXanh: number | null;
  xanh: boolean;
}
export type OnTienTuTri = (t: TienDoTuTri) => void;

export interface YeuCauVongTuTri {
  projectId?: string;
  /** Câu KHỞI ĐỘNG — phải `laYDinhTuTri`. */
  cauHoi: string;
  /** Lượt bắt đầu (mặc định 1). */
  luotBatDau?: number;
}

export interface LuotVong {
  luot: number;
  command: string | null;
  soDo: number | null;
  soXanh: number | null;
  xanh: boolean;
  /** Băm tệp của lượt GHI trong lượt này (null nếu lượt chỉ chạy test rồi dừng). */
  bamTruoc: string | null;
  bamSau: string | null;
  path: string | null;
}

export interface KetQuaVongTuTri {
  /** Vòng có được KHỞI ĐỘNG không (đủ `khoiDongTuTriGhiDuoc`). */
  batDau: boolean;
  lyDo: LyDoDungVong | null;
  soLuot: number;
  luots: LuotVong[];
  message: string | null;
}

/** Map mã từ chối của bước CHẠY (`chayKiemChung`) sang lý do DỪNG vòng — mỗi mã một câu khác nhau. */
function lyDoTuKiemChung(ma: MaTuChoiKiemChung | null): LyDoDungVong {
  switch (ma) {
    case "AUTOLOOP_OFF":
      return "co_tat"; // thiếu AI_CODING_AUTOLOOP — vòng tự-ghi đòi CẢ HAI cờ
    case "LOOP_CAP":
      return "het_tran";
    case "DENIED":
      return "khong_quyen";
    case "CMD_NOT_VERIFY":
    case "NO_VERIFY_CMD":
      return "khong_co_lenh";
    default:
      return "loi";
  }
}

/**
 * ★★★ BỘ ĐIỀU PHỐI. Mỗi vòng lặp = MỘT lượt CHẠY test + (nếu chưa xanh, chưa giậm chân, chưa hết
 * trần) MỘT lượt GHI. Trần đếm theo LƯỢT CHẠY. Kill-switch kiểm ĐẦU mỗi lượt (bật giữa vòng ⇒ dừng
 * ngay lượt kế). Audit WORM một hàng cho mỗi lượt CÓ GHI.
 *
 * ⚠ Thứ tự cầu chì (mượn `quyetDinhTiep`): XANH → KHÔNG-TIẾN-BỘ → HẾT-TRẦN. Tệp bẩn (`tep_ban_nguoi`)
 *   và kill-switch (`kill_switch`) là hai lối thoát RIÊNG, đứng trước cả `quyetDinhTiep`.
 */
export async function chayVongTuTriGhi(
  y: YeuCauVongTuTri,
  execCtx: ToolExecContext | undefined,
  user: CopilotUser,
  lang: ToolLang,
  sinhBanVa: SinhBanVa,
  /** ★ Móc tiến độ THUẦN QUAN SÁT — xem `TienDoTuTri`. Vắng ⇒ vòng chạy y hệt, chỉ không phát tiến độ. */
  onTien?: OnTienTuTri,
): Promise<KetQuaVongTuTri> {
  // ── KHỞI ĐỘNG TƯỜNG MINH — một chỗ DUY NHẤT ─────────────────────────────────────────────────
  if (!khoiDongTuTriGhiDuoc(y.cauHoi)) {
    // Phân biệt "không xin" với "xin nhưng cờ tắt" cho người đọc — không gộp thành một im lặng.
    const lyDo: LyDoDungVong | null = autonomyGhiTuTriBat() ? null : "co_tat";
    return { batDau: false, lyDo, soLuot: 0, luots: [], message: null };
  }

  const tran = tranTuTriGhi();
  const luots: LuotVong[] = [];
  let soDoTruoc: number | null = null;
  let bamDauRaTruoc: string | null = null;
  let luot = Math.max(1, Math.trunc(y.luotBatDau ?? 1));

  const dung = (lyDo: LyDoDungVong, message: string | null = null): KetQuaVongTuTri => ({
    batDau: true, lyDo, soLuot: luots.length, luots, message,
  });

  while (luot <= tran) {
    // Kill-switch bật GIỮA vòng ⇒ DỪNG ngay lượt kế (đọc tươi mỗi lượt).
    if (await isKillSwitchTripped()) return dung("kill_switch");

    // ── 1) CHẠY test (mượn nguyên chayKiemChung — danh sách trắng hẹp, không lệnh phá huỷ) ──────
    const kc = await chayKiemChung({ projectId: y.projectId, cauHoi: y.cauHoi, luot }, execCtx, user, lang);
    if (!kc.ok) return dung(lyDoTuKiemChung(kc.ma), kc.message);

    const bamDauRa = bamChuoi(chuanHoaDauRa(kc.output));
    // ★ TIẾN ĐỘ — vừa CHẠY test xong, người dùng thấy "lượt i/N · N test đỏ" (hoặc "đã xanh").
    onTien?.({ luot, tran, pha: "chay", soDo: kc.soDo, soXanh: kc.soXanh, xanh: kc.xanh });

    // ── 2) QUYẾT ĐỊNH DỪNG/ĐI (mượn nguyên quyetDinhTiep) ───────────────────────────────────────
    const pq = quyetDinhTiep({
      luot, tran, xanh: kc.xanh, soDo: kc.soDo, soDoTruoc, bamDauRa, bamDauRaTruoc,
    });
    if (!pq.tiep) {
      luots.push({ luot, command: kc.command, soDo: kc.soDo, soXanh: kc.soXanh, xanh: kc.xanh, bamTruoc: null, bamSau: null, path: null });
      return dung(pq.lyDo ?? "loi");
    }

    // ★ TIẾN ĐỘ — chưa xanh, chưa giậm chân, chưa hết trần ⇒ SẮP tự sửa.
    onTien?.({ luot, tran, pha: "sua", soDo: kc.soDo, soXanh: kc.soXanh, xanh: false });

    // ── 3) SINH BẢN VÁ (tầng model — tiêm vào) ──────────────────────────────────────────────────
    const banVa = await sinhBanVa(catLoiChoPrompt(kc.output), luot);
    if (!banVa) {
      luots.push({ luot, command: kc.command, soDo: kc.soDo, soXanh: kc.soXanh, xanh: kc.xanh, bamTruoc: null, bamSau: null, path: null });
      return dung("loi", "không sinh được bản vá");
    }

    // ★ Chống-gaming: model vừa chọn tệp NÀO? Nếu là tệp TEST, sổ WORM phải khai (không chặn cứng).
    const suaTepTest = laTepTest(banVa.path);

    // ── 4) TỰ GHI (apply_diff, không người duyệt) ───────────────────────────────────────────────
    const w = await chayLuotTuTriGhi({ projectId: y.projectId, path: banVa.path, original: banVa.original, modified: banVa.modified, luot }, execCtx, user, lang);

    // ── 5) AUDIT WORM một hàng cho lượt này (băm + lệnh + kết quả test + lượt + cờ sửa-tệp-test) ──
    await ghiAuditLuotTuTri(user, execCtx?.req, {
      luot, command: kc.command, soDo: kc.soDo, soXanh: kc.soXanh, xanh: kc.xanh,
      bamTruoc: w.bamTruoc, bamSau: w.bamSau, path: w.path, suaTepTest,
    });
    luots.push({ luot, command: kc.command, soDo: kc.soDo, soXanh: kc.soXanh, xanh: kc.xanh, bamTruoc: w.bamTruoc, bamSau: w.bamSau, path: w.path });

    // ── 6) LỐI THOÁT RIÊNG của bước ghi ─────────────────────────────────────────────────────────
    if (w.ma === "TEP_BAN_NGUOI") return dung("tep_ban_nguoi", w.message);
    if (w.ma === "KILL_SWITCH") return dung("kill_switch");
    if (w.ma === "TU_TRI_TAT") return dung("co_tat");
    if (!w.ok) return dung("loi", w.message);

    soDoTruoc = kc.soDo;
    bamDauRaTruoc = bamDauRa;
    luot++;
  }

  return dung("het_tran");
}
