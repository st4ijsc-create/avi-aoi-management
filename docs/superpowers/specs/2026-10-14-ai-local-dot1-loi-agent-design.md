# Đợt 1 — Lõi agent dùng chung (`shared/agentCore`) — thiết kế

Kế hoạch mẹ: `docs/superpowers/plans/2026-10-14-ai-local-hoan-thien-7-tang.md` §Đợt 1. Quyết định chủ dự án: Q1 (repo chính
ngoài tự ghi), **Q2 = A** (lõi dùng chung, server chạy cho trình duyệt, extension chạy cho VSCode và gọi `/v1`), Q5 (1 × 64k).

## 1. Mục tiêu và cổng ra (viết TRƯỚC khi làm)

Một yêu cầu kiểu *"thêm tính năng X qua nhiều tệp, chạy test, sửa tới khi xanh"* chạy trọn trong một lượt agent.

| Cổng | Ngưỡng | Nền |
|---|---|---|
| A2 (2 lỗi / 2 tệp) qua chế độ agent | ≥ 70 % trên **12 lượt** | ≈ 44 % (đường tự trị cũ) — đo lại nền ở Đợt 0.4 |
| Bộ F (tính năng nhiều tệp, mới) | ≥ 60 % × 3 lượt | chưa có đường nào làm được (0 %) |
| Chế độ Hỏi (H 12×3) | không tụt quá ±3 bài so nền Đợt 0.4 | nền Đợt 0.4 |
| Census ghi | 0 lượt ghi ngoài gốc dự án; mọi lượt ghi có hàng `ai_pending_actions` + audit | — |
| Hoàn tác | khôi phục đúng byte (sha256) mọi tệp lượt chạy đã tạo/sửa/xoá/đổi tên | — |
| Tệp test của bài | không bị agent sửa (băm trước = sau) — nếu sửa ⇒ bài tính TRƯỢT | — |

## 2. Kiến trúc

```
                ┌──────────── shared/agentCore (THUẦN: không import server/, client/, vscode) ─────────────┐
                │ kieu.ts · congCu.ts (schema tool) · loiNhac.ts (system prompt) · nguCanh.ts (nén lịch sử) │
                │ vongAgent.ts: chayVongAgent({ goiModel, boThucThi, phat, signal, gioiHan, dongHo })       │
                └───────────────▲──────────────────────────────────────────────▲──────────────────────────────┘
          server (trình duyệt, CLI)                                    extension VSCode (Đợt 4)
  goiModel = aiGgufEngine.chatCompletionStream(tools)            goiModel = POST /v1/chat/completions (stream, tools)
  boThucThi = BoThucThiMayChu → executeDecision / propose /      boThucThi = BoThucThiVscode → apBanVa / chayLenhCucBo
              confirmAction / run_command (mọi hàng rào cũ)                  / getDiagnostics
  quanLyLuotChay (bộ nhớ + bảng ai_agent_runs) ⇄ SSE + tRPC
```

**Nguyên tắc ràng buộc từ census hiện có (không được phá):**
- Tool chạy qua `executeDecision` (`aiLocalTools/index.ts`) — chỉ hai tệp được gọi `.handler(` (`authCtxInjection.test.ts`).
- Ghi đĩa chỉ qua tool ghi → `proposeAction` → `confirmAction` (`programmingFileIo.census.test.ts`: `writeConfined` một cửa).
- Lệnh chỉ qua tool `run_command` (`repoCommand.census.test.ts` §E).
- Kết quả tool là DỮ LIỆU: không bao giờ quét tìm lệnh; `scanUntrustedContent` mức `high` ⇒ dừng vòng (khuôn G2-C).

## 3. `shared/agentCore` — hợp đồng

```ts
// kieu.ts
export type CheDoAgent = "hoi" | "sua" | "tu-dong";
//   hoi     : chỉ tool đọc + todo_write; tool ghi/lệnh bị từ chối (model được báo).
//   sua     : ghi + lệnh đều chờ người duyệt (HITL từng lượt).
//   tu-dong : ghi/lệnh trong danh sách trắng tự chạy SAU checkpoint; chỉ cho dự án được phép tự ghi (Q1).
export interface TinNhan { role: "system"|"user"|"assistant"|"tool"; content: string;
  tool_calls?: WireToolCall[]; tool_call_id?: string; name?: string }
export interface LoiGoiTool { id: string; ten: string; thamSo: Record<string, unknown> }
export interface KetQuaTool {
  choModel: string;                 // văn bản đưa lại model (đã cắt + che), LUÔN có
  ok: boolean;
  ma?: string;                      // mã lỗi/từ chối máy đọc được (BASE_MISMATCH, BI_BAC, …)
  hienThi?: unknown;                // dữ liệu cho UI (diff, đầu ra lệnh) — không vào model
  thayDoi?: ThayDoiTep[];           // tệp đã đổi (cho checkpoint/hoàn tác/UI)
}
export interface ThayDoiTep { duong: string; loai: "tao"|"sua"|"xoa"|"doi-ten"; tuDuong?: string; bamSau?: string|null }
export type SuKienAgent =
  | { loai: "bat-dau"; runId: string; cheDo: CheDoAgent }
  | { loai: "chu"; noiDung: string }                 // delta văn bản trả lời
  | { loai: "nghi"; noiDung: string }                // delta reasoning
  | { loai: "goi-tool"; goi: LoiGoiTool; luot: number }
  | { loai: "ket-qua-tool"; id: string; ten: string; ok: boolean; tomTat: string; ma?: string; hienThi?: unknown }
  | { loai: "can-duyet"; id: string; deXuat: DeXuatDuyet }   // vòng đang TẠM DỪNG
  | { loai: "da-duyet"|"bi-bac"; id: string; lyDo?: string }
  | { loai: "ke-hoach"; viec: ViecKeHoach[] }
  | { loai: "checkpoint"; checkpointId: string; tep: string[] }
  | { loai: "usage"; vao: number; ra: number; nghi?: number; ctxPhanTram?: number }
  | { loai: "dang-cho-model"; phiaTruoc: number }
  | { loai: "xong"; lyDo: LyDoDung; tomTat?: string }
  | { loai: "loi"; ma: string; thongDiep: string };
export type LyDoDung = "hoan-thanh"|"het-luot"|"het-gio"|"het-token"|"huy"|"lap-lai"|"menh-lenh-trong-du-lieu"|"loi-model";
export interface ViecKeHoach { noiDung: string; trangThai: "cho"|"dang-lam"|"xong" }

// vongAgent.ts
export interface GoiModel {
  (vao: { tinNhan: TinNhan[]; congCu: WireTool[]; signal: AbortSignal }):
    AsyncIterable<{ loai: "chu"|"nghi"; noiDung: string } | { loai: "xong"; toolCalls: WireToolCall[];
                    usage?: { vao: number; ra: number; nghi?: number } }>;
}
export interface BoThucThi {
  congCu(cheDo: CheDoAgent): WireTool[];     // bộ tool phơi cho model theo chế độ
  chay(goi: LoiGoiTool, ctx: { cheDo: CheDoAgent; runId: string; luot: number; signal: AbortSignal;
                               phat: (e: SuKienAgent) => void }): Promise<KetQuaTool>;
}
export interface GioiHanVong { soLuotToiDa: number; msToiDa: number; tokenRaToiDa: number; kyTuQuanSatToiDa: number }
export function chayVongAgent(y: { cauHoi: string; lichSu?: TinNhan[]; cheDo: CheDoAgent; runId: string;
  nguCanhDuAn: string; goiModel: GoiModel; boThucThi: BoThucThi; phat: (e: SuKienAgent) => void;
  signal: AbortSignal; gioiHan?: Partial<GioiHanVong>; dongHo?: () => number }): Promise<{ lyDo: LyDoDung; tinNhan: TinNhan[] }>;
```

**Vòng:** gửi model (system + ngữ cảnh dự án + lịch sử + câu hỏi) → stream `chu`/`nghi` → nếu có `toolCalls`: chạy LẦN LƯỢT
qua `boThucThi.chay` (phát `goi-tool`/`ket-qua-tool`), nối `role:"tool"` → lặp; không có tool call ⇒ `hoan-thanh`.
Dừng sớm: hết lượt (mặc định 30), hết giờ (mặc định 20 phút), hết token ra, huỷ (`signal`), **lặp lại** (cùng tool + cùng tham
số 3 lần liên tiếp), `menh-lenh-trong-du-lieu`. Huỷ phải ngắt cả lượt model đang stream và lượt chờ duyệt.

**Ngữ cảnh 64k (`nguCanh.ts`):** ước lượng token bằng hằng 2,8 ký tự/token (dùng chung `uocLuongSoToken` — truyền vào, không
chép); mỗi kết quả tool cắt đầu+đuôi theo `kyTuQuanSatToiDa` (mặc định 12.000 ký tự); khi tổng > 70 % ngân sách ⇒ thay kết
quả tool CŨ (trừ 2 lượt gần nhất) bằng `[đã rút gọn: <tool> <đường> — <n> ký tự]`. Không bao giờ bỏ system/câu hỏi gốc.

**Bộ tool v1 (`congCu.ts`, tên tiếng Anh cho model, mô tả tiếng Anh ngắn):**

| Tool | Tham số | Loại | Ghi chú |
|---|---|---|---|
| `read_file` | path, start_line?, end_line? | đọc | đánh số dòng |
| `list_dir` | path | đọc | |
| `find_files` | pattern (glob tên) | đọc | duyệt cây, trần 200 |
| `grep` | pattern (regex), path?, include? | đọc | |
| `edit_file` | path, edits[{old_string,new_string,replace_all?}] | ghi | old_string phải duy nhất (trừ replace_all); lỗi trả nguyên văn cho model sửa |
| `write_file` | path, content | ghi | tạo mới hoặc ghi đè toàn bộ |
| `delete_file` | path | ghi | tool mới phía server |
| `rename_file` | from, to | ghi | tool mới phía server |
| `run_command` | command | lệnh | danh sách trắng; kết quả kèm tóm tắt `docKetQuaTest` |
| `todo_write` | todos[{content,status}] | không tác dụng phụ | phát `ke-hoach` |

Chế độ `hoi` chỉ phơi các tool đọc + `todo_write`. Lỗi tham số ⇒ `KetQuaTool{ok:false, choModel:"<lỗi cụ thể + cách sửa>"}`
(model tự sửa), không ném.

**System prompt (`loiNhac.ts`):** tiếng Anh (tool-use), yêu cầu trả lời bằng ngôn ngữ người dùng; quy tắc: đọc trước khi sửa,
dùng `todo_write` cho việc ≥ 3 bước, chạy test sau khi sửa nếu dự án có test, KHÔNG sửa tệp test để làm test xanh trừ khi
được yêu cầu, báo cáo trung thực khi không xong. Ngữ cảnh dự án: tên, gốc tương đối, cây 2 tầng (≤ 80 mục), tệp quy ước nếu có
(Đợt 2 mở rộng), danh sách lệnh được phép.

## 4. Phía server

**Tool mới (writeHandlers):** `delete_file`, `rename_file` — cùng 4 hàng rào của `applyDiff.phanQuyet` (chính sách đường,
hộp cát + băm, git bẩn) cho MỌI đường liên quan (rename: cả nguồn và đích; đích phải chưa tồn tại); thao tác đĩa qua MỘT cửa
mới trong `readToolsProgramming.ts` (`xoaConfined`, `doiTenConfined`) + cập nhật census `programmingFileIo`. Preview hiển thị
được trên thẻ duyệt. `edit_file`/`write_file` phía server = tính `modified` rồi đi `apply_diff` (`original` = nội dung đĩa hiện
tại đọc qua hộp cát; tạo mới `original:""`).

**Checkpoint (`server/services/ai/checkpointAgent.ts`):** trước mỗi lượt ghi (cả HITL lẫn tự động), chụp trạng thái các đường
bị chạm (nội dung hoặc "không tồn tại") vào `tmp/ai-checkpoints/<runId>/<seq>/` (gốc cấu hình `AI_CHECKPOINT_DIR`, ngoài thư mục
dự án) + manifest JSON (đường, băm trước, băm sau sau khi ghi). Hoàn tác (một checkpoint hoặc cả lượt chạy, theo thứ tự ngược):
chỉ khi băm hiện tại == băm sau (không ai sửa tiếp), khôi phục qua chính tool ghi (`apply_diff`/`delete_file`/tạo lại) với
`reason:"AI_AGENT_HOAN_TAC"` — tức hoàn tác cũng đi cửa ghi + audit. Xung đột ⇒ liệt kê, không ghi đè. Snapshot không dùng git
(dự án không có git cũng hoàn tác được; hook repo chặn stash). **Có checkpoint ⇒ gỡ chặn Q1 cho chế độ `tu-dong`? KHÔNG tự động:**
Q1 giữ nguyên tới khi cổng hoàn tác đo đạt; mở bằng quyết định ghi trong tài liệu kết quả.
**Sửa sau rà bảo mật a5f56d089 (2026-10-17):** kho mặc định KHÔNG còn là `<cwd>/tmp/ai-checkpoints` (nằm trong gốc dự án "repo" ⇒
agent ghi được manifest) mà là thư mục dữ liệu ứng dụng (`%LOCALAPPDATA%/avi-aoi-management/ai-checkpoints`, POSIX
`$XDG_STATE_HOME|~/.local/state/avi-aoi-management/ai-checkpoints`); kho (mặc định hay `AI_CHECKPOINT_DIR`) chồng lấn repo chính /
gốc hộp cát / dự án đăng ký ⇒ `KHO_KHONG_HOP_LE`; cửa giam giữ của tool coi kho là CẤM (`CHECKPOINT_STORE`). Manifest ký
HMAC-SHA256 (khoá HKDF từ `SECRET_ENCRYPTION_KEY`, vắng ⇒ `JWT_SECRET`); chữ ký sai/thiếu ⇒ `CHU_KY_SAI`, không khoá ⇒
`KHONG_CO_KHOA` ⇒ không ghi.

**BoThucThiMayChu (`server/services/ai/agent/boThucThiMayChu.ts`):** đọc ⇒ `executeDecision` (read_file/list_files/grep_repo
sẵn có; `find_files` mới là tool đọc). Ghi ⇒ `executeDecision` tạo pending action ⇒ chụp checkpoint ⇒
- `sua`: phát `can-duyet` (kèm `pendingAction` để UI dùng lại `TheDuyetDiff`), chờ quyết định (Promise trong bộ nhớ, đánh thức
  bởi `aiCopilot.confirmAction`/`cancelAction` thông qua một bus sự kiện nhỏ, + kiểm định kỳ `getAction` phòng lỡ sự kiện; hết
  hạn TTL 5 phút ⇒ coi như bác "hết hạn");
- `tu-dong`: gọi `confirmAction(..., {reason:"AI_AGENT_TU_DONG"})` ngay (giữ mọi hàng rào + kill-switch + Q1). **Lệnh** (sửa sau rà
  bảo mật a5f56d089) chỉ tự chạy qua ĐÚNG cổng vòng tự động cũ: `AI_CODING_AUTOLOOP=1` + tập kiểm chứng (`NHAN_KIEM_CHUNG`) + không
  `ghiDia`; Q1 xét theo các đường lệnh chạm (ô đường trong argv; "." khi lệnh phạm vi gốc hoặc npm/npx tự tìm dự án theo cwd);
  ngoài tập ⇒ lỗi cho model "cần duyệt tay", không đề xuất. Đọc kill-switch hỏng ⇒ coi như bật.
Kết quả thật đọc bằng `daBiTuChoiGhi`/`note` (không tin `ok:true`).

**Mô hình (`goiModelMayChu`):** `aiGgufEngine.chatCompletionStream` với `tools` (native) + `signal`, ưu tiên `tuong-tac`
(Đợt 0.3), nghĩ bật với ngân sách server (12k) — ablation nghĩ bật/tắt là một phép đo của Đợt 1. Model theo cấu hình
(`GGUF_CODE_MODEL`).

**Quản lý lượt chạy (`server/services/ai/agent/quanLyLuotChay.ts`) + migration 0390 `ai_agent_runs`:** id uuid, userId, projectId,
cheDo, cauHoi, trangThai (`dang-chay|cho-duyet|xong|huy|loi|gian-doan`), lyDoDung, soLuot, token vào/ra/nghĩ, sự kiện (jsonb, cắt
trần), checkpoint ids, createdAt/updatedAt. Lượt chạy sống trong bộ nhớ tiến trình; restart ⇒ hàng còn `dang-chay` đổi thành
`gian-doan` lúc boot (checkpoint vẫn hoàn tác được). Một người dùng tối đa 1 lượt chạy song song (model 1 slot).

**API:** `POST /api/ai/agent/runs` (SSE: tạo + phát sự kiện), `GET /api/ai/agent/runs/:id/events?tu=<n>` (SSE nối lại, phát lại
bộ đệm), `POST /api/ai/agent/runs/:id/huy`, tRPC `aiAgent.{danhSach, chiTiet, hoanTac(runId|checkpointId), duyet(id, chon), bac(id, lyDo)}`
(duyệt có thể dùng lại `aiCopilot.confirmAction`; `bac` cần lý do để model đọc). Xác thực + quyền như route lập trình
(`ai_repo_read`; ghi cần quyền tool; `tu-dong` cần `ai_repo_exec`). Huỷ khi client bỏ đi KHÔNG huỷ lượt chạy (khác đường SSE cũ) —
lượt chạy tiếp tục và nối lại được; nút Dừng mới huỷ.

## 5. Giao diện trình duyệt (tối thiểu cho Đợt 1; hoàn thiện ở Đợt 3)

Bộ chọn chế độ **Hỏi / Sửa (duyệt từng bước) / Tự động** trong ô chat; chế độ agent dùng API mới. Dòng thời gian: tin nhắn,
gọi tool (thu gọn, mở được), kết quả, thẻ duyệt (dùng lại `TheDuyetDiff` cho từng pending action, kèm nút Bác + lý do), bảng kế
hoạch (todo) dính trên đầu, thanh trạng thái "đang chờ lượt model". Kết thúc: tóm tắt + danh sách tệp đã đổi + nút **Hoàn tác
lượt chạy**. i18n vi/en/zh.

## 6. Bộ đo

- **Bộ F** `scripts/ai-eval/codegen-chay-duoc/agent-f/`: ≥ 6 bài (2 TS/Node · 2 Python · 2 C#), mỗi bài một dự án nhỏ commit sẵn
  trong `sandbox-projects/agent-f/<bai>/` + bộ test ẨN do máy chạy sau lượt agent (test ẩn đặt ngoài dự án, chép vào lúc chấm);
  test hiển thị trong dự án được phép đọc. Bài đòi ≥ 2 tệp và ≥ 1 tệp mới. Chấm: test ẩn xanh + tệp test hiển thị không bị sửa.
  Kiểm thước: lời giải mẫu ⇒ 6/6, dự án gốc ⇒ 0/6.
- **A2 qua agent:** `agentic.mjs --duong agent` gọi API mới, chế độ `tu-dong` trên dự án hộp cát.
- Đặt lại dự án bằng `git checkout -- <dir>` + `git clean -fd -- <dir>` chỉ trong thư mục bài của worktree đo.

## 7. Thứ tự thi công

T1 `shared/agentCore` (thuần, lưới với model/bộ thực thi giả) → song song T2 tool `delete_file`/`rename_file`/`find_files` +
census, T3 checkpoint/hoàn tác, T6 bộ F + harness → T4 bộ thực thi máy chủ + mô hình + quản lý lượt chạy + API + mig 0390 →
T5 UI → đo cổng.
