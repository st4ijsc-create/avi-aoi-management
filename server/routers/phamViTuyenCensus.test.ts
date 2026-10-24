/**
 * ★★★ 2026-08-18 — **CỔNG ĐIỀU TRA DÂN SỐ PHẠM VI ĐỌC, PHẦN TUYẾN EXPRESS.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO CÓ CỔNG THỨ HAI — VÀ VÌ SAO NÓ KHÔNG PHẢI "MỘT LƯỚI NỮA CHO MỘT BỀ MẶT NỮA"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `phamViDocCensus.test.ts` canh lượng từ trên **2.209 thủ tục tRPC** và tuyên bố ba điều nó chứng
 * minh được. Ngày 2026-08-18 một lượt đo trên **HTTP THẬT** tìm ra lỗ **THỨ CHÍN** của cùng bề mặt
 * dữ liệu ấy — `GET /api/public/products/:productCode/reference-image-file` — và cổng kia **không
 * thể** đỏ vì nó: tuyến ấy là `app.get(…)`, không nằm trong 2.209, không nằm trong sổ nợ.
 *
 * ⇒ File này canh **cùng một lượng từ**, trên tập còn lại:
 *
 *     ∀ tuyến `app.get/post/…("/…", …)` dưới `server/**`: nó phải rơi vào **ĐÚNG MỘT** nhóm, và
 *     nhóm **A** (chạm dữ liệu tenant mà không tầng nào lọc) chỉ được chứa mục **đã có tên trong
 *     `phamViTuyenBaseline.ts`**.
 *
 * ⚠⚠ Bộ suy là **CHUNG MỘT** với cổng tRPC (`quetPhamViDoc` trả cả `thuTuc` lẫn `tuyen` từ MỘT
 *    lượt quét). Hai bản luật cho cùng câu hỏi *"cái gì là dữ liệu tenant"* là cách chúng lệch
 *    nhau, và **bản lỏng hơn sẽ quyết định ai thấy gì**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ CỔNG XANH **KHÔNG** CHỨNG MINH KHÔNG CÒN RÒ RỈ. Ba thứ nó KHÔNG nói được, ghi ra ở đây:
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   (1) **Nó không phát biểu gì ở tầng HTTP.** Đây là một lưới **TĨNH trên cây cú pháp**: nó đọc
 *       mã, không gửi một gói tin nào. Nó chứng minh *"thân handler CÓ đưa danh tính vào lượt đọc
 *       dữ liệu"*, **không** chứng minh *"máy nhà máy A nhận 403"*. Phép đo HTTP thật vẫn là việc
 *       của người, và §6 dưới đây neo vào đúng cái tuyến đã được đo tay.
 *   (2) **Nó mù với tuyến TĨNH.** `app.use("/uploads", express.static(…))` phục vụ byte tệp,
 *       không qua một lượt đọc bảng nào — §1 ghim danh sách ấy để nó không im lặng lớn thêm.
 *   (3) **83 mục trong sổ là NỢ**, không phải 83 quyết định "chỗ này rò cũng được". §3 in con số
 *       ấy mỗi lượt chạy để không ai quên. (88 → 83 ngày 2026-08-18 khi năm tuyến ảnh được trả —
 *       xem `phamViTuyenBaseline.ts`; con số đến từ một lượt CHẠY LẠI bộ suy, không từ phép trừ.)
 */
import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { writeFileSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  quetPhamViDoc,
  nhomTuyenCua,
  khoaTuyen,
  nhomCua,
  khoaCua,
  type NhomTuyen,
  type TuyenExpress,
} from "./phamViDocScan";
import { MIEN_TRU_TUYEN_CO_CHU_Y, NO_PHAM_VI_TUYEN } from "./phamViTuyenBaseline";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const GOC_REPO = join(TEST_DIR, "..", "..");

const QUET = quetPhamViDoc(GOC_REPO);
const NHOM = new Map<NhomTuyen, TuyenExpress[]>();
for (const t of QUET.tuyen) {
  const n = nhomTuyenCua(t);
  NHOM.set(n, [...(NHOM.get(n) ?? []), t]);
}
const cua = (n: NhomTuyen): TuyenExpress[] => NHOM.get(n) ?? [];

/**
 * ★★★ CON SỐ GHIM (đo 2026-08-18, sau khi trả 3 mục — xem docblock `phamViTuyenBaseline.ts`).
 *
 * ⚠ Đổi một số ở đây là một **lời khai**, không phải một lượt bảo trì. Năm con số bị ràng buộc bởi
 * `A + C + D + S + U === tổng`, nên không sửa lén được một ô.
 *
 * ★★★ ĐỢT 42 (QA Đợt 41 D-4 lỗ #2) — **A: 83 → 81 · S: 15 → 17.** Hai tuyến cockpit của `moduleReads.ts`
 * (`GET /machines/:id/detail`, `GET /robots/:id/detail`) nay truyền phạm vi KHOÁ (`req.apiPrincipal.tenantScope`,
 * trục ② của `resolveTenantFactoryScope`) vào `machineDetail`/`robotDetail`. Đo trước vá qua HTTP thật
 * (`.qa-dot41/api-vai/http-v1.json`): khoá `factoryCode=SIM-FAC` đọc `/machines/257/detail` (NM18) ⇒ 200.
 * Lưới: `server/api/v1/moduleReadsCockpitPhamVi.db.test.ts` (3 hình dạng khoá × máy/robot A·B·mồ côi).
 * ⚠ Bản vá ĐẦU nhận `req` trần vào helper ⇒ bộ suy vẫn xếp A (mù) — sửa lại nhận `req.apiPrincipal?.tenantScope`
 *   (cùng hình `/ecosystem/kpi`) thì hai tuyến mới rời nhóm A. Một lưới mù không phải lưới (G108).
 * ⚠⚠ Đo trên HEAD SẠCH (`6eec818f`, `.qa-dot42/census-truoc.log`): §1 (`index.ts:650` ≠ `:653` ghim) và §3
 *   (D 72 · tong 224) ĐÃ ĐỎ TRƯỚC đợt này — độ trôi của lô khác. Tôi chỉ đổi A/S đúng **2** phần của mình,
 *   **để nguyên** D/tong/§1 cho bên đó ký (cùng luật Đợt 40 ở `phamViDocCensus.test.ts`).
 */
// ★★★ ĐỢT 49 (mục E) — **D 71→72 · tong 223→224**, và bề mặt tĩnh ghim `index.ts:653` → `:650`.
// Cùng một gốc với census thủ tục (xem docblock GHIM ở `phamViDocCensus.test.ts`): số ghim được
// cộng tay trên chú thích chứ không đo lại. Bằng chứng cho riêng dòng `:653`: `app.use("/uploads",
// express.static(uploadsRoot))` là CÙNG MỘT tuyến, chỉ bị dời 3 dòng lên khi vùng trên nó gọn lại
// giữa `2cb1f771` và `34c4be3d` (đo: chuỗi mốc trong `index.ts` ở dòng 609 tại `2cb1f771`, dòng 606
// tại `34c4be3d`/`d7a6a6c7`/HEAD). Không có tuyến tĩnh nào MỚI được mở ra web — điều mà ô ghim này
// sinh ra để bắt. `git diff d7a6a6c7..HEAD -- server/` RỖNG ⇒ độ lệch có từ trước baseline.
// ★★★ 2026-09-15 (QA lần 11, PH-23) — **A: 81 → 80 · S: 17 → 18.** `GET /ecosystem/hierarchy`
// (`moduleReads.ts`) nay chiếu phạm vi của KHOÁ (`req.apiPrincipal.tenantScope` → trục ② của
// `resolveTenantFactoryScope`) xuống `buildHierarchy`, đúng khuôn `GET /ecosystem/kpi` ngay bên
// dưới nó. Đây là bề mặt SONG SINH của thủ tục tRPC `commandCenter.hierarchy`: cùng một hàm tổng
// hợp, cùng một lỗ "phạm vi lấy từ lời tự khai của người gọi" — vá một bề mặt mà bỏ bề mặt kia
// thì lỗ vẫn mở, chỉ đổi cổng vào. Đó là toàn bộ delta của lượt này: **A −1, S +1, tổng KHÔNG đổi.**
// ★★★ 2026-09-27 (doc 80 Đợt 1 Task 8, khai ở final wave item 1) — **D: 72 → 73 · tong: 224 → 225.**
// Tuyến MỚI duy nhất không-GET của cả hai dải Đợt 1 (`a0f1d50fe..773ee78fc`, `d40237783..HEAD`):
// `POST /api/ai/programming-copilot/stream` (`server/routes/aiStreamingApi.ts`, thân ở
// `programmingCopilotStream.ts`) — bản SSE của thủ tục tRPC `programming.copilotGenerate`.
// Nhóm D là "mọi tuyến không-GET" (`phamViDocScan.nhomTuyenCua`), nên số này ĐO ĐƯỢC, không cộng tay.
// Vì sao tuyến ấy không phải một lỗ phạm vi mới: (1) danh tính PHIÊN qua `thuXacThucRest` (401 khi vắng);
// (2) giấy phép — nhánh `/api/ai` chặn `MOD_AI` ở `_core/index.ts`, và tuyến tự đòi thêm `MOD_ENGINEERING`
// bằng `isModuleLicensed` (đúng động cơ của `moduleProcedure` mà `copilotGenerate` đi qua); (3) RBAC
// `checkPermission(machine_monitoring/canView)` — cùng cặp với `copilotGenerate`; (4) dữ liệu tenant chỉ
// tới qua `retrieveContext` của CHÍNH pipeline `generateProgram` dùng chung với thủ tục tRPC (đã đếm
// trong census thủ tục), tuyến không đọc bảng nào khác. Lưới hành vi: `programmingCopilotStream.test.ts`.
// (Đợt 1B `/api/ot/ingest` chỉ thay một tuyến inline có sẵn ⇒ 0 delta — đo ở `773ee78fc` và `d40237783`.)
// ★★★ 2026-10-10 (doc 81 Đợt 5 task E2, item 26) — **C 38 → 37 · S 18 → 19.** `GET /orchestration/runs/:id` (api/v1)
// nay đưa phạm vi KHOÁ (`req.apiPrincipal?.tenantScope` → `orchestrationScopeOf` → `runVisibleTo`) vào lượt đọc: run ngoài
// phạm vi ⇒ 404 Y HỆT run không tồn tại. Lưới: `server/routers/orchestrationScope.dot5.db.test.ts` (khoá NULL/factory/global).
// Chỉ đúng MỘT tuyến của lượt này đổi nhóm; A/D/U/tong giữ nguyên.
// ★★★ 2026-10-12 (doc 81 Đợt 9 task S2) — **D 73 → 79 · tong 225 → 231.** Sáu tuyến MỚI, đều POST, đều trong
// `server/api/v1/edgeNodeRoutes.ts`: `/edge/node/pull`, `/edge/node/runs/:runId/{claim,progress,complete,release,interrupted}`
// — giao thức thực thi run của MỘT nút biên. Đo: chạy bộ suy trên cây làm việc trước/sau (chỉ D đổi, +6; A/C/S/U giữ nguyên).
// Vì sao không phải lỗ phạm vi mới: (1) danh tính là KHOÁ CỦA NÚT (`requireEdgeNode` — chỉ băm SHA-256 trong
// `edge_node_credentials`, thu hồi ⇒ 401), không phải khoá API hay phiên; (2) mọi run id được so với PHÂN CÔNG của chính nút ấy
// (`orchestration_run_edge_assignments.edgeNodeId`) VÀ phạm vi nhà máy của nút (`runInNodeScope`) — run của nút khác / ngoài
// nhà máy / không tồn tại ⇒ CÙNG một 404; (3) tuyến không trả dữ liệu tenant nào ngoài định nghĩa run đã giao cho nút.
// Lưới hành vi: `server/services/edge/edgeExecution.s12.dot9.db.test.ts` + `edgeExecution.s4.e2e.dot9.db.test.ts`.
// ★★★ 2026-10-13 (doc 81 Đợt 10 integration, task B) — **D 79 → 87 · tong 231 → 239.** Tám tuyến MỚI, đều POST, đều trong
// `server/api/v1/edgeNodeRoutes.ts` (giao thức v2 của nút biên, chỉ-v2): `/edge/node/{config,heartbeat,program-checks,telemetry,
// robots/state,locks/events}` + `/edge/node/runs/:runId/{authorize,report}`. Đo: bộ suy chạy trên cây làm việc tích hợp — chỉ D
// đổi (+8); A/C/S/U giữ nguyên (sáu tuyến Đợt 9 chỉ đổi thân sang `byVersion`, không thêm tuyến). Vì sao không phải lỗ phạm vi mới:
// (1) danh tính là KHOÁ CỦA NÚT (`requireEdgeNode`, cùng Đợt 9); (2) authorize / report: run id phải là của PHÂN CÔNG của chính
// nút VÀ trong phạm vi nhà máy của nút (`runInNodeScope`) — census `orchestrationScopeCensus.dot5` ghim đúng hai điều kiện đó
// cho `edgeAuthorizeCentral` / `edgeReportsCentral`; (3) config chỉ mang thiết bị nút SỞ HỮU ∩ nhà máy của nút (R-10-am),
// telemetry / robots/state / program-checks / locks/events chỉ nhận bản ghi của thiết bị nút sở hữu (khác ⇒ đếm notOwned +
// EDGE_ANOMALY), heartbeat chỉ ghi bản ghi của chính nút; không tuyến nào trả dữ liệu tenant ngoài thiết bị đã giao cho nút.
// Lưới hành vi: `server/services/edge/edge{Config,Authorize,Authorize.failclosed,Reports,Ingest,Commands}.dot10.db.test.ts`.
// ★★★ 2026-10-17 (AI Local Đợt 1 / 3c / 4A — nhánh `feat/ai-local-7-tang`, đo MỘT lần trên cây làm việc của nhánh so với
// gốc `8be43f65a`) — **C 37 → 40 · D 87 → 91 · tong 239 → 246 · A/S/U giữ nguyên.** Đo: chạy `quetPhamViDoc` trên cả hai cây,
// diff danh sách (nhóm, khoá) — đúng BẢY tuyến mới, không tuyến cũ nào đổi nhóm:
//   C (GET): `aiAgentApi.ts#GET /api/ai/agent/runs/:id/events` (Đợt 1 — SSE của lượt chạy; `thuXacThucRest` + lượt phải của
//     CHÍNH người hỏi: `ql.layLuotChay(runId, userId)` / `docHangLuotChay(userId, runId)`, khác ⇒ 404);
//     `aiXemTruocApi.ts#GET /api/ai/preview/:projectId` + `…/*` (Đợt 3c — `thuXacThucRest` + `ai_repo_read/canView` +
//     `phanGiaiGoc` theo người hỏi + `tt.chuSoHuu === userId`, khác ⇒ 404; trả 302 + vé một lần, không đọc bảng tenant nào).
//   D (POST): `aiAgentApi.ts#POST /api/ai/agent/runs` + `…/:id/huy` (Đợt 1 — phiên; huỷ chỉ lượt của chính người hỏi);
//     `aiGatewayTokenThietBi.ts#POST /api/ai/gateway-token/thiet-bi` + `…/doi` (Đợt 4A — device flow RFC 8628: xin mã / đổi mã
//     lấy token; danh tính là `device_code` bí mật + người DUYỆT trên web qua tRPC `aiGatewayToken.quyetThietBi`; có trần lượt).
// Không tuyến nào chạm dữ liệu tenant/nhà máy ⇒ không mục nào vào A, sổ nợ không thêm dòng. Cả bảy sau cổng giấy phép `/api/ai`.
// ★★★ 2026-10-17 (AI Local Đợt 4B-server, cùng nhánh) — **D 91 → 94 · tong 246 → 249 · A/C/S/U giữ nguyên.** Đo: chạy bộ suy
// trước/sau khi thêm `server/routes/aiGatewayTokenBearerApi.ts` — đúng BA tuyến mới, đều POST, không tuyến cũ nào đổi nhóm:
//   `POST /api/ai/client-apply/bat-dau` + `…/chot` (sổ kiểm toán lượt áp tệp ở client — gọi ĐÚNG `batDauApDungOClient` /
//     `chotApDungOClient` của tRPC `aiCopilot.*`; danh tính = CHỦ token `avgw_` tra theo băm, phạm vi `apply`,
//     `ai_repo_read/canView` kiểm lại mỗi lượt; chốt lượt của người khác bị chính dịch vụ từ chối — `row.userId !== user.id`);
//   `POST /api/ai/gateway-token/tu-thu-hoi` (thu hồi CHÍNH token đang trình, tra theo băm; chỉ có thể THU HẸP quyền).
// Không tuyến nào đọc dữ liệu tenant/nhà máy ⇒ không mục nào vào A, sổ nợ không thêm dòng. Cả ba sau cổng giấy phép `/api/ai`.
// ★★★ 2026-10-17 (AI Local Đợt 5.1 phía VSCode, cùng nhánh) — **D 94 → 95 · tong 249 → 250 · A/C/S/U giữ nguyên.** Đo: chạy
// lưới trước/sau khi thêm MỘT tuyến vào `server/routes/aiGatewayTokenBearerApi.ts` — đúng một tuyến mới, POST, không tuyến cũ
// nào đổi nhóm: `POST /api/ai/client-feedback` (👍/👎 + lý do cho câu trả lời cuối của lượt agent CHẠY CỤC BỘ trong
// extension; danh tính = CHỦ token `avgw_` tra theo băm, phạm vi `chat`, `ai_repo_read/canView` kiểm lại mỗi lượt; chỉ GHI
// một hàng `ai_agent_feedback` của CHÍNH chủ token — `nguon = 'vscode'`, khoá (người, lượt client, khối) — và trả lại đúng
// hàng ấy; không đọc dữ liệu tenant/nhà máy nào). Không mục nào vào A, sổ nợ không thêm dòng. Sau cổng giấy phép `/api/ai`.
// ★★ 2026-10-20 (AI Local Đợt 8.1 Task 4b — webhook Luồng AI) — **D 95 → 96 · tong 250 → 251 · A/C/S/U giữ nguyên.** Đo: chạy
// lưới trước/sau khi thêm `server/routes/flowWebhookApi.ts` — đúng MỘT tuyến mới, POST, không tuyến cũ nào đổi nhóm:
// `POST /api/flow/webhook/:flowId/:nodeId` (kích hoạt một lượt Luồng AI; danh tính = token THEO LUỒNG `x-flow-token`, CSDL chỉ
// giữ sha256 ở `ai_flow_webhooks` (mig 0402), so thời gian hằng; chỉ đọc `ai_flows`/`ai_flow_versions`/`ai_flow_webhooks` — sổ
// máy, không bảng tenant — và ghi một lượt `ai_flow_runs`). Không mục nào vào A, sổ nợ không thêm dòng. Cổng giấy phép MOD_AI
// gắn TRONG tuyến (`chanTuyenAiTheoGiayPhep()`, tuyến không nằm dưới `/api/ai`).
/** Bề mặt tĩnh được ghim theo NỘI DUNG (tệp — dòng gắn), đã sắp xếp; số dòng KHÔNG nằm trong ghim. Sinh từ bộ quét 2026-10-24 (HAI mục như cũ). */
const NOI_DUNG_TUYEN_TINH: readonly string[] = [
  'server/_core/index.ts — app.use("/uploads", express.static(uploadsRoot))',
  'server/_core/vite.ts — app.use(express.static(distPath))',
];

// ★ 2026-10-24 — A 80→71 · S 19→28 (chín tuyến `moduleReads.ts`: safety/events|zones, fleet/tasks|zones, programs, programs/:id/deployments, anomaly/events, twin/scene-graph, pdm/risk).
// ★ 2026-10-24 nhóm 1 (equipment + assets + gateways + state): A 71→60 · S 28→39.
// ★ 2026-10-24 nhóm 2 (orders + genealogy + lines): A 60→53 · S 39→46.
// ★ 2026-10-24 nhóm 3 (events + metrics + advice + pdmHealth + compliance): A 53→47 · S 46→52.
// ★ 2026-10-24 /api/external nhóm ①: A 47→44 · S 52→55.
// ★ 2026-10-24 /api/external nhóm ②: A 44→41 · S 55→58 (3 tuyến alerts/bulletins đã trích sang routes/externalAlertApi.ts và lọc theo phạm vi).
// ★ 2026-10-24 /api/external nhóm ③: A 41→29 · S 58→70 (12 tuyến: stations/:id + 6 nhánh, resolve-topic, workstations, workstations/:id, products, products/:id).
// ★ 2026-10-24 /api/external nhóm ④: A 29→25 · S 70→74 (hierarchy/{tree,factory/:factoryId,mqtt-topics,summary}); dashboard/summary + statistics/measurement-points đã trích sang cùng tệp, còn nợ → nhóm ⑤.
// ★ 2026-10-24 /api/external nhóm ⑤: A 25→5 · S 74→94 (20 tuyến tổng hợp). A=5 còn lại ĐÚNG là năm MIỄN TRỪ CÓ CHỦ Ý (standards/device-types|alarm-taxonomy, twin/models, edge/download, reports/artifacts) — sổ nợ tuyến /api/* RỖNG.
const GHIM = { A: 5, C: 40, D: 96, S: 94, U: 16, tong: 251 } as const;

describe("§1 — CẦU CHÌ: bộ suy có thật sự nhìn thấy tuyến không", () => {
  it("★ không có ô MÙ nào (mỗi ô mù là một tuyến KHÔNG AI CANH)", () => {
    expect(
      QUET.mu,
      "Bộ suy tự khai là không còn đủ. Một `app.get(<biểu thức>, …)` không đặt tên được là một\n" +
        "tuyến nằm ngoài phép đếm — đọc từng dòng, đừng nới lượng từ.",
    ).toEqual([]);
  });

  it("quét trúng đủ tuyến (chống 'xanh vì quét trúng 0 thứ')", () => {
    // Ngưỡng đặt THẤP HƠN hẳn số đo (223) — nó chỉ bắt cái chết hẳn (đổi khung web, đổi hình dạng
    // đăng ký tuyến), không bắt độ trôi bình thường.
    expect(QUET.tuyen.length).toBeGreaterThan(180);
    // Chiều DƯƠNG: phải thấy CẢ tuyến gắn thẳng vào `app` LẪN tuyến của `express.Router()` con —
    // mất một trong hai nghĩa là bộ suy chỉ nhìn được một nửa cây.
    expect(new Set(QUET.tuyen.map((t) => t.bien)).size).toBeGreaterThan(1);
    expect(new Set(QUET.tuyen.map((t) => t.file)).size).toBeGreaterThan(8);
  });

  it("★ KHOÁ DUY NHẤT — hai tuyến không được cùng một khoá", () => {
    const khoa = QUET.tuyen.map(khoaTuyen);
    const trung = [...new Set(khoa.filter((k, i) => khoa.indexOf(k) !== i))];
    expect(trung, "Khoá trùng ⇒ sổ nợ gộp nhiều tuyến thành một mục.").toEqual([]);
  });

  it("★★ BỀ MẶT TĨNH được GHIM — bộ suy KHÔNG phát biểu được gì về nó", () => {
    // `express.static` phục vụ byte tệp thẳng từ đĩa: không lượt đọc bảng nào, nên MỌI vị từ ở đây
    // đều mù với nó. Ghim danh sách để một lượt gắn thư mục MỚI ra web phải được ký tên.
    // ★ 2026-10-24: ghim nay theo NỘI DUNG dòng (xem NOI_DUNG_TUYEN_TINH) — các ghi chú "609 → … → 686" dưới đây là LỊCH SỬ của thời ghim theo số dòng.
    // ⚠⚠ SỬA 2026-08-18 — câu cũ ở đây ghi: *"`/uploads` đang phục vụ ảnh kiểm của MỌI nhà máy mà
    //    không một phép xác thực nào — món nợ CÓ THẬT, chỉ là món nợ cổng này không đo được"*.
    //    Món nợ ấy nay **đã được vá**: một middleware cổng ảnh (`server/routes/_congAnh.ts`) đứng
    //    TRƯỚC cả handler resize lẫn `express.static`, sau cờ `ANH_CONG_MO`.
    // ⚠ Con số ghim đổi **609 → 642 → 652 → 653** vì các lượt vá chèn thêm dòng lên phía trên,
    //   KHÔNG phải vì một thư mục mới được gắn ra web: danh sách vẫn đúng HAI mục như cũ. Đây là
    //   con số ĐO ĐƯỢC từ bộ quét, không phải một con số nới ra cho lưới xanh.
    // ⚠ 2026-08-19 (cổng giấy phép MOD_AI): **+1 dòng** — một `import` cho middleware
    //   `chanTuyenAiTheoGiayPhep` ở đầu `server/_core/index.ts`. Không một `express.static` nào
    //   được thêm/bớt; hai mục dưới đây **y nguyên**, chỉ trôi số dòng.
    // ⚠⚠ Bộ suy vẫn **mù** với bề mặt tĩnh (nó phục vụ byte tệp, không đọc bảng nào) — cổng này vì
    //   thế KHÔNG chứng minh được `/uploads` đã có phòng vệ, **kể cả sau lượt uỷ quyền theo đường
    //   dẫn ngày 2026-08-18**. Phép chứng minh nằm ở ba chỗ KHÁC, và đây là chỗ trỏ tới chúng:
    //   `server/routes/uyQuyenAnhHinhDang.test.ts` (hình dạng + traversal, thuần),
    //   `server/routes/uyQuyenAnhPhamVi.db.test.ts` (âm đối xứng, CSDL thật), và một lượt HTTP
    //   THẬT bằng socket thô (ghi trong báo cáo). Ghim danh sách để một lượt gắn thư mục MỚI ra
    //   web vẫn phải được ký tên.
    // ⚠ 2026-10-17 (AI Local nhánh `feat/ai-local-7-tang`): **650 → 664** — +5 dòng `import` (registerAiAgentRoutes,
    //   registerAiXemTruocRoutes, laOriginXemTruoc, registerAiGatewayTokenThietBiRoutes, danhDauGianDoanKhiBoot) + 9 dòng ở
    //   middleware CORS phía trên (`xuLyCorsCongOpenAi` Đợt 4A, chặn phản chiếu origin xem trước Đợt 3c). Đo: diff `tuyenTinh`
    //   gốc `8be43f65a` ↔ nhánh — vẫn đúng HAI mục, cùng `app.use("/uploads", express.static(uploadsRoot))`; không thư mục mới.
    // ⚠ Đợt 4B-server: **664 → 665** — +1 dòng `import { registerAiGatewayTokenBearerRoutes }` cạnh import device flow.
    //   Vẫn đúng HAI mục, cùng `app.use("/uploads", express.static(uploadsRoot))`; không thư mục mới.
    // ⚠ Đợt 6 (đổi model): **665 → 674** — +1 import `khoiChayDongBoLuaChonModel` + 8 dòng (docblock + lời gọi) ở thân
    //   module điểm vào. Vẫn đúng HAI mục, cùng `app.use("/uploads", express.static(uploadsRoot))`; không thư mục mới.
    // ⚠ Đợt 7.1 (khe nặng): **680 → 682** — +1 import `batTuDoiKheNang` + 1 lời gọi ở thân module điểm vào.
    // ⚠ Đợt 8.1 (Luồng AI, webhook): **682 → 684** — +1 import `registerFlowWebhookRoutes` + 1 dòng chú thích cạnh
    //   `rawUploadPaths` (webhook tự đọc thân 256 KB). Vẫn đúng HAI mục, cùng `app.use("/uploads", express.static(uploadsRoot))`.
    // ⚠ Rà bảo mật 2026-10-24 (trần batch + giới hạn theo thủ tục tRPC): **684 → 686** — +2 dòng `import` (`trpcGioiHanThuTucMiddleware`,
    //   `requireFreshTotp/requirePerCallFreshTotp`); hai dòng `app.use("/api/trpc", …)` mới nằm SAU dòng ghim. Vẫn đúng HAI mục, cùng `app.use("/uploads", express.static(uploadsRoot))`.
    // ⚠ Đợt 7.0 (sổ model): **674 → 680** — +2 import (`khoiChayDongBoSoModel`, `dongBoKhoModel`) + 4 dòng (chú thích + hai
    //   lời gọi) ở thân module điểm vào. Vẫn đúng HAI mục, cùng `app.use("/uploads", express.static(uploadsRoot))`.
    // ★ 2026-10-24 (dieu-phoi duyệt): ghim theo NỘI DUNG dòng, KHÔNG theo số dòng. `tuyenTinh` có dạng "<tệp>:<dòng> — <nội dung>"; bỏ phần ":<dòng>" rồi so cả danh sách:
    //   mỗi mục ghim phải xuất hiện ĐÚNG MỘT lần (0 hoặc >1 ⇒ đỏ với diff nêu rõ), thêm/bớt/sửa nội dung một dòng `express.static` ⇒ đỏ; chỉ DỊCH dòng thì xanh.
    expect(
      QUET.tuyenTinh.map((s) => s.replace(/^([^:]+):\d+ — /, "$1 — ")).sort(),
      "bề mặt tĩnh đổi: mỗi mục ghim phải xuất hiện ĐÚNG MỘT lần; một thư mục MỚI ra web phải được ký tên",
    ).toEqual(NOI_DUNG_TUYEN_TINH);

  });
});

describe("§2 — MỖI TUYẾN VÀO ĐÚNG MỘT NHÓM", () => {
  it("★ tổng năm nhóm = tổng tuyến (không mục nào rơi ra ngoài, không mục nào đếm hai lần)", () => {
    const tong = (["A", "C", "D", "S", "U"] as const).reduce((s, n) => s + cua(n).length, 0);
    expect(tong).toBe(QUET.tuyen.length);
  });

  it("`nhomTuyenCua` là hàm TOÀN PHẦN — không tuyến nào cho nhóm ngoài tập", () => {
    const la = QUET.tuyen.filter((t) => !["A", "C", "D", "S", "U"].includes(nhomTuyenCua(t)));
    expect(la.map(khoaTuyen)).toEqual([]);
  });
});

describe("§3 — CON SỐ GHIM", () => {
  it("★ số từng nhóm ĐÚNG BẰNG số đã ghim", () => {
    const dem = {
      A: cua("A").length,
      C: cua("C").length,
      D: cua("D").length,
      S: cua("S").length,
      U: cua("U").length,
      tong: QUET.tuyen.length,
    };
    expect(
      dem,
      "Dân số tuyến đã đổi. Sửa `GHIM` cho khớp SỐ ĐO ĐƯỢC và ghi lý do — đừng sửa cho xanh.",
    ).toEqual(GHIM);
  });
});

describe("§4 — RÒ RỈ MỚI ⇒ ĐỎ (lý do tồn tại của cổng này)", () => {
  it("★★★ mọi tuyến nhóm (A) phải đã có tên trong SỔ NỢ", () => {
    const so = new Set([...NO_PHAM_VI_TUYEN, ...Object.keys(MIEN_TRU_TUYEN_CO_CHU_Y)]);
    const moi = cua("A")
      .filter((t) => !so.has(khoaTuyen(t)))
      .map(
        (t) =>
          `${khoaTuyen(t)} (dòng ${t.dong}; chạm: ${t.bangChung.join(", ") || "bảng tenant trực tiếp"})`,
      );
    expect(
      moi,
      "MỘT TUYẾN EXPRESS ĐỌC DỮ LIỆU TENANT MỚI KHÔNG CÓ BỘ LỌC PHẠM VI.\n" +
        "Hệ này KHÔNG có danh tính ngầm (RLS ở tầng CSDL nằm im — xem `phamViDocScan.ts`), nên một\n" +
        "handler không đưa danh tính ĐÃ XÁC THỰC vào lượt đọc thì KHÔNG tầng nào lọc được nó.\n" +
        "Ba hình dạng danh tính hợp lệ của tuyến REST — CHỌN ĐÚNG CÁI CỦA BỀ MẶT MÌNH:\n" +
        "  • phiên/JWT  → `phamViGoiNgoai(req)` + `nguoiXemCuaPhamVi()` (`server/routes/_phamViNgoai.ts`)\n" +
        "  • khoá API   → `req.apiPrincipal.tenantScope` (mẫu: `api/export/biRouter.ts`)\n" +
        "  • khoá MÁY   → `phamViNhaMayCuaMay()` (`server/routers/publicProductScope.ts`)\n" +
        "CẤM lấy danh tính từ `req.query`/`req.body` — đó là lời TỰ KHAI của người gọi.",
    ).toEqual([]);
  });
});

describe("§5 — SỔ NỢ KHÔNG ĐƯỢC HOÁ THẠCH", () => {
  it("★★ MIỄN TRỪ CÓ CHỦ Ý (tuyến): còn tồn tại · còn nhóm (A) · lý do thật có ngày duyệt · không trùng sổ nợ · ghim số = 5", () => {
    const nhomTheoKhoa = new Map(QUET.tuyen.map((t) => [khoaTuyen(t), nhomTuyenCua(t)]));
    const loi: string[] = [];
    for (const [k, lyDo] of Object.entries(MIEN_TRU_TUYEN_CO_CHU_Y)) {
      if (!nhomTheoKhoa.has(k)) loi.push(`${k} — không còn là tuyến`);
      else if (nhomTheoKhoa.get(k) !== "A") loi.push(`${k} — nay là nhóm ${nhomTheoKhoa.get(k)}: gỡ khỏi miễn trừ`);
      if (NO_PHAM_VI_TUYEN.includes(k)) loi.push(`${k} — vừa nợ vừa miễn trừ`);
      if (lyDo.trim().length < 20 || !/\d{4}-\d{2}-\d{2}/.test(lyDo)) loi.push(`${k} — lý do thiếu/không có ngày duyệt`);
    }
    expect(loi).toEqual([]);
    expect(Object.keys(MIEN_TRU_TUYEN_CO_CHU_Y).length, "thêm miễn trừ = quyết định, ghi lý do ở đây").toBe(5);
  });

  it("★ mọi mục trong sổ vẫn còn là một tuyến CÓ THẬT", () => {
    const co = new Set(QUET.tuyen.map(khoaTuyen));
    const chet = NO_PHAM_VI_TUYEN.filter((k) => !co.has(k));
    expect(chet, "Sổ nợ giữ mục không còn tồn tại — xoá nó đi.").toEqual([]);
  });

  it("★★ mọi mục trong sổ vẫn ĐANG ở nhóm (A) — vá rồi thì phải GỠ DÒNG", () => {
    const nhomTheoKhoa = new Map(QUET.tuyen.map((t) => [khoaTuyen(t), nhomTuyenCua(t)]));
    const daVa = NO_PHAM_VI_TUYEN.filter(
      (k) => nhomTheoKhoa.has(k) && nhomTheoKhoa.get(k) !== "A",
    ).map((k) => `${k} → nay là nhóm ${nhomTheoKhoa.get(k)}`);
    expect(
      daVa,
      "Mục này đã được vá nhưng còn tên trong sổ nợ. Xoá dòng của nó khỏi `phamViTuyenBaseline.ts`\n" +
        "và giảm `GHIM.A` cho khớp — trả nợ phải NHÌN THẤY ĐƯỢC trong diff.",
    ).toEqual([]);
  });

  it("sổ nợ GOM THEO FILE, mỗi file một khối liền mạch, trong khối đã sắp xếp, không lặp", () => {
    const fileCua = (k: string): string => k.split("#")[0] ?? "";
    const thuTuFile: string[] = [];
    for (const k of NO_PHAM_VI_TUYEN) {
      const f = fileCua(k);
      if (thuTuFile[thuTuFile.length - 1] !== f) thuTuFile.push(f);
    }
    expect(
      [...new Set(thuTuFile)].length,
      "một file xuất hiện ở HAI khối rời nhau — gom chúng lại.",
    ).toBe(thuTuFile.length);
    for (const f of thuTuFile) {
      const khoi = NO_PHAM_VI_TUYEN.filter((k) => fileCua(k) === f);
      expect([...khoi].sort(), `khối \`${f}\` chưa sắp xếp`).toEqual(khoi);
    }
    expect(new Set(NO_PHAM_VI_TUYEN).size).toBe(NO_PHAM_VI_TUYEN.length);
  });
});

describe("§6 — BỐN CA CHUẨN ĐÃ ĐƯỢC VÁ (hoàn nguyên bản vá ⇒ ĐỎ)", () => {
  /**
   * Ca đầu là tuyến đã được **đo tay trên HTTP thật** (cổng 3111, 2026-08-18): trước bản vá, máy
   * của nhà máy A tải được ảnh sản phẩm của nhà máy B — **200 · image/png**. Ba ca sau là phần nợ
   * mà lượt tạo sổ này trả; hai trong số đó trả về `machines.apiKey`, tức một BÍ MẬT.
   */
  const CA_CHUAN = [
    "server/_core/index.ts#GET /api/public/products/:productCode/reference-image-file",
    "server/_core/index.ts#GET /api/external/machines",
    "server/_core/index.ts#GET /api/external/machines/by-code/:code",
    "server/routes/externalStationApi.ts#GET /api/external/stations",
  ] as const;

  for (const k of CA_CHUAN) {
    it(`${k} — chạm dữ liệu tenant VÀ đã đưa danh tính vào lượt đọc`, () => {
      const t = QUET.tuyen.find((x) => khoaTuyen(x) === k);
      expect(t, `không còn thấy tuyến \`${k}\` — nó bị đổi tên/gỡ bỏ?`).toBeDefined();
      // Hai vế TÁCH RỜI có chủ ý: "vá" bằng cách làm tuyến thôi chạm dữ liệu tenant ⇒ vế đầu ĐỎ,
      // chứ không lặng lẽ xanh nhờ vế sau.
      expect(t?.chamTenant, "ca chuẩn phải VẪN chạm dữ liệu tenant — nếu không, vị từ đã trôi").toBe(true);
      expect(t?.danhTinhRoiTay, "danh tính phải ĐI VÀO lượt đọc (hoàn nguyên bản vá ⇒ ĐỎ)").toBe(true);
      expect(nhomTuyenCua(t as TuyenExpress)).toBe("S");
    });
  }

  it("★★ nhóm (S) ĐÚNG BẰNG tập đã ký — không tuyến nào lẻn vào", () => {
    // ⇐ ĐỎ theo hai chiều. THÊM một tên ⇒ hoặc là một lượt trả nợ (mừng — ký vào đây và xoá dòng
    //   khỏi sổ), hoặc là một lượt XANH GIẢ. Vị từ `danhTinhRoiTay` đòi danh tính đi vào một lời
    //   gọi **NẰM TRÊN ĐƯỜNG ĐỌC** (BẬC 2 ở `phamViDocScan.danhTinhRoiTayRest`) — luật ấy sinh ra
    //   từ một đột biến ĐÃ CHẠY và ĐÃ bắt được một lượt xanh giả; nhưng nó vẫn không phân biệt
    //   được *"đọc có cổng"* với *"đọc rồi lọc SAI trục"*. Cả 15 mục dưới đây đã được đọc TAY từng
    //   dòng ngày 2026-08-18 và xác nhận là thu hẹp THẬT.
    // ★ 2026-08-18 — NĂM mục ảnh chuyển từ nhóm A sang đây (10 → 15). Cả năm còn được kiểm bằng
    //   một lượt **HTTP THẬT** (`aoi_management_test`, cổng 3099): tài khoản nhà máy A nhận
    //   `403 · application/json · image_factory_scope_denied` trên đường dẫn của nhà máy B, và
    //   `200 · image/png` trên đường dẫn của chính A. Xem `phamViTuyenBaseline.ts`.
    expect(cua("S").map(khoaTuyen).sort()).toEqual([
      // ★ 2026-10-24 /api/external nhóm ⑤: 20 tuyến tổng hợp (inspections analytics ×13, oee|fleet|safety|pdm|alerts summary, dashboard/summary, statistics/measurement-points) lọc theo phạm vi người gọi; stationId ngoài phạm vi ⇒ 403. Lưới: externalTongHopPhamVi.db.test.ts.
      // ★ 2026-10-24 /api/external nhóm ④: hierarchy/{tree, factory/:factoryId, mqtt-topics, summary} (trích sang routes/externalHierarchyApi.ts) lọc theo nhà máy được gán. Lưới: externalHierarchyPhamVi.db.test.ts.
      // ★ 2026-10-24 /api/external nhóm ③: stations/:id + 6 nhánh + resolve-topic + workstations(+/:id) (trích sang routes/externalStationApi.ts) và products(+/:id) lọc theo phạm vi người gọi. Lưới: externalStationPhamVi.db.test.ts, externalInspectionPhamVi.db.test.ts.
      // ★ 2026-10-24 /api/external nhóm ②: alerts · alerts/:alertId · bulletins (trích sang routes/externalAlertApi.ts) lọc theo phạm vi người gọi. Lưới: routes/externalAlertPhamVi.db.test.ts.
      // ★ 2026-10-24 /api/external nhóm ①: inspections/images|measurements|events lọc theo máy trong nhà máy được gán (master key không đổi), kèm scopeApplied. Lưới: routes/externalInspectionPhamVi.db.test.ts.
      // ★ 2026-10-24 nhóm 3 (events/metrics/advice/pdmHealth/compliance): sự kiện, chỉ số, đề xuất, sức khoẻ và đếm tuân thủ chỉ trong phạm vi khoá (phamViKhoa.ts). Lưới: eventsMetricsAdvicePdmPhamViKhoa.db.test.ts.
      // ★ 2026-10-24 nhóm 2 (orders/genealogy/lines): lệnh sản xuất, truy xuất đơn vị và chuyền của nhà máy khác ⇒ 404; danh sách lọc theo phạm vi khoá (phamViKhoa.ts). Lưới: ordersGenealogyLinesPhamViKhoa.db.test.ts.
      // ★ 2026-10-24 nhóm 1 (equipment/assets/state): khoá API một nhà máy chỉ chạm máy/tài sản/nút biên của nhà máy mình (phamViKhoa.ts). Lưới: equipmentAssetsStatePhamViKhoa.db.test.ts.
      // ★ 2026-09-15 (PH-23) — bề mặt SONG SINH của `/ecosystem/kpi`, và nó nằm ngay TRÊN kpi
      //   trong cùng file mà bị bỏ quên suốt từ 2026-08-18: cùng `req.apiPrincipal.tenantScope`
      //   → `resolveTenantCodeFactoryIds` → tham số `tenant` của `buildHierarchy`.
      // ★ Đợt 42 — hai tuyến cockpit: `machineDetail(id, phamViCuaKhoa(req.apiPrincipal?.tenantScope))`.
      // ★ 2026-10-24 — chín tuyến còn lại cùng lớp (khoá của nhà máy A đọc nhà máy B): `dieuKienKhoa` (cột định vị → `dieuKienViTriTrongPhamVi`, trục ②) hoặc `canTrongPhamVi` (id từ client).
      //   Lưới: `server/api/v1/moduleReadsPhamViKhoa.db.test.ts`.
      // ★ 2026-10-10 (doc 81 Đợt 5 E2) — `runVisibleTo(view.run, orchestrationScopeOf(req.apiPrincipal?.tenantScope))`.
      // ⚠ `reportArtifactRoutes.ts#GET /api/reports/artifacts/:id/download` **KHÔNG** ở đây, và nó
      //   CÓ lọc theo người xem. Nó nằm trong SỔ NỢ vì `chamTenant` của nó bật do bao đóng của hàm
      //   XÁC THỰC (`api_keys` mang `factoryCode`), còn `report_artifacts` thì không thuộc tenant
      //   nên `getDownloadTarget` không nằm trên đường đọc mà vị từ đo được. Xem chú thích tại chỗ
      //   trong `phamViTuyenBaseline.ts`.
      "server/_core/index.ts#GET /api/aoi/download/:packageId",
      "server/_core/index.ts#GET /api/aoi/image/:packageId/:fileName",
      "server/_core/index.ts#GET /api/external/machines",
      "server/_core/index.ts#GET /api/external/machines/by-code/:code",
      "server/_core/index.ts#GET /api/inspection/:id/images",
      "server/_core/index.ts#GET /api/measurement-point/:id/reference-image",
      "server/_core/index.ts#GET /api/product-model/:id/reference-images",
      "server/_core/index.ts#GET /api/public/products/:productCode/reference-image-file",
      "server/api/export/biRouter.ts#GET /datasets",
      "server/api/export/biRouter.ts#GET /datasets/:name",
      "server/api/export/exportRouter.ts#GET /^\\/(yield|oee|defect-pareto)\\.(csv|json|xlsx)$/",
      "server/api/export/exportRouter.ts#GET /^\\/inspections\\.(csv|json|xlsx|pdf)$/",
      "server/api/export/exportRouter.ts#GET /^\\/measurements\\.(csv|json|xlsx|pdf)$/",
      "server/api/v1/advice.ts#GET /recommendations",
      "server/api/v1/assets.ts#GET /assets",
      "server/api/v1/assets.ts#GET /assets/:id",
      "server/api/v1/assets.ts#GET /assets/:id/config-drift",
      "server/api/v1/assets.ts#GET /assets/:id/health",
      "server/api/v1/assets.ts#GET /assets/:id/tags",
      "server/api/v1/assets.ts#GET /gateways/:id/status",
      "server/api/v1/events.ts#GET /events",
      "server/api/v1/genealogyApi.ts#GET /genealogy/:unitId",
      "server/api/v1/lines.ts#GET /lines",
      "server/api/v1/lines.ts#GET /lines/:id/stages",
      "server/api/v1/lines.ts#GET /lines/:id/state",
      "server/api/v1/metricsApi.ts#GET /metrics/:metric",
      "server/api/v1/moduleReads.ts#GET /anomaly/events",
      "server/api/v1/moduleReads.ts#GET /ecosystem/hierarchy",
      "server/api/v1/moduleReads.ts#GET /ecosystem/kpi",
      "server/api/v1/moduleReads.ts#GET /fleet/tasks",
      "server/api/v1/moduleReads.ts#GET /fleet/zones",
      "server/api/v1/moduleReads.ts#GET /machines/:id/detail",
      "server/api/v1/moduleReads.ts#GET /pdm/risk",
      "server/api/v1/moduleReads.ts#GET /programs",
      "server/api/v1/moduleReads.ts#GET /programs/:id/deployments",
      "server/api/v1/moduleReads.ts#GET /robots/:id/detail",
      "server/api/v1/moduleReads.ts#GET /safety/events",
      "server/api/v1/moduleReads.ts#GET /safety/zones",
      "server/api/v1/moduleReads.ts#GET /standards/compliance",
      "server/api/v1/moduleReads.ts#GET /twin/scene-graph",
      "server/api/v1/ordersLifecycle.ts#GET /orders",
      "server/api/v1/ordersLifecycle.ts#GET /orders/:id",
      "server/api/v1/ordersLifecycle.ts#GET /orders/:id/trace",
      "server/api/v1/pdmHealth.ts#GET /health/assets/:id",
      "server/api/v1/pdmHealth.ts#GET /predictions",
      "server/api/v1/router.ts#GET /equipment",
      "server/api/v1/router.ts#GET /equipment/:id/capabilities",
      "server/api/v1/router.ts#GET /equipment/:id/state",
      "server/api/v1/router.ts#GET /equipment/:id/telemetry",
      "server/api/v1/router.ts#GET /orchestration/runs/:id",
      "server/api/v1/state.ts#GET /state/*",
      "server/routes/externalAlertApi.ts#GET /api/external/alerts",
      "server/routes/externalAlertApi.ts#GET /api/external/alerts/:alertId",
      "server/routes/externalAlertApi.ts#GET /api/external/bulletins",
      "server/routes/externalHierarchyApi.ts#GET /api/external/dashboard/summary",
      "server/routes/externalHierarchyApi.ts#GET /api/external/hierarchy/factory/:factoryId",
      "server/routes/externalHierarchyApi.ts#GET /api/external/hierarchy/mqtt-topics",
      "server/routes/externalHierarchyApi.ts#GET /api/external/hierarchy/summary",
      "server/routes/externalHierarchyApi.ts#GET /api/external/hierarchy/tree",
      "server/routes/externalHierarchyApi.ts#GET /api/external/statistics/measurement-points",
      "server/routes/externalInspectionApi.ts#GET /api/external/alerts/summary",
      "server/routes/externalInspectionApi.ts#GET /api/external/fleet/summary",
      "server/routes/externalInspectionApi.ts#GET /api/external/inspections/ai-analysis",
      "server/routes/externalInspectionApi.ts#GET /api/external/inspections/cause-effect",
      "server/routes/externalInspectionApi.ts#GET /api/external/inspections/check-sheet",
      "server/routes/externalInspectionApi.ts#GET /api/external/inspections/control-chart",
      "server/routes/externalInspectionApi.ts#GET /api/external/inspections/defect-pareto",
      "server/routes/externalInspectionApi.ts#GET /api/external/inspections/diagnostics",
      "server/routes/externalInspectionApi.ts#GET /api/external/inspections/events",
      "server/routes/externalInspectionApi.ts#GET /api/external/inspections/fail-history",
      "server/routes/externalInspectionApi.ts#GET /api/external/inspections/histogram",
      "server/routes/externalInspectionApi.ts#GET /api/external/inspections/images",
      "server/routes/externalInspectionApi.ts#GET /api/external/inspections/measurements",
      "server/routes/externalInspectionApi.ts#GET /api/external/inspections/scatter",
      "server/routes/externalInspectionApi.ts#GET /api/external/inspections/stratification",
      "server/routes/externalInspectionApi.ts#GET /api/external/inspections/summary",
      "server/routes/externalInspectionApi.ts#GET /api/external/inspections/trend",
      "server/routes/externalInspectionApi.ts#GET /api/external/inspections/yield-comparison",
      "server/routes/externalInspectionApi.ts#GET /api/external/oee/summary",
      "server/routes/externalInspectionApi.ts#GET /api/external/pdm/summary",
      "server/routes/externalInspectionApi.ts#GET /api/external/products",
      "server/routes/externalInspectionApi.ts#GET /api/external/products/:id",
      "server/routes/externalInspectionApi.ts#GET /api/external/safety/summary",
      "server/routes/externalStationApi.ts#GET /api/external/stations",
      "server/routes/externalStationApi.ts#GET /api/external/stations/:id",
      "server/routes/externalStationApi.ts#GET /api/external/stations/:id/fail-history",
      "server/routes/externalStationApi.ts#GET /api/external/stations/:id/inspection-points",
      "server/routes/externalStationApi.ts#GET /api/external/stations/:id/measurement-stats",
      "server/routes/externalStationApi.ts#GET /api/external/stations/:id/point-detail",
      "server/routes/externalStationApi.ts#GET /api/external/stations/:id/products",
      "server/routes/externalStationApi.ts#GET /api/external/stations/:id/statistics",
      "server/routes/externalStationApi.ts#GET /api/external/stations/resolve-topic",
      "server/routes/externalStationApi.ts#GET /api/external/workstations",
      "server/routes/externalStationApi.ts#GET /api/external/workstations/:id",
    ]);
  });
});

describe("§7 — ĐỘT BIẾN THẬT: cổng có ĐỎ khi thêm một tuyến đọc tenant KHÔNG LỌC không", () => {
  /**
   * ⚠⚠ Không có ô này thì §4 xanh **không chứng minh gì**: một vị từ luôn trả "không có mục mới"
   * cũng cho đúng màu ấy. Nên ô này **ghi thật một tuyến rò ra đĩa**, chạy lại **đúng** bộ suy đang
   * canh sản phẩm, rồi đòi nó bị bắt — **và đòi thông điệp gọi ĐÍCH DANH tuyến ấy**.
   *
   * Ba lời khai, phá ba kiểu vá-cổng-cho-xanh khác nhau:
   *   (a) tuyến mới rơi vào nhóm **A** — vị từ nhận ra hình dạng rò;
   *   (b) nó **không** có tên trong sổ nợ ⇒ §4 ĐỎ, và tên nó có mặt trong danh sách §4 in ra;
   *   (c) bản ĐỐI CHỨNG **có** phạm vi người gọi rơi vào nhóm **S** — chống "vá quá tay": một cổng
   *       bắt TẤT CẢ cũng thoả (a) và (b), nhưng sẽ làm hỏng (c).
   */
  const FILE_DOT_BIEN = join(GOC_REPO, "server", "routes", "__dotBienTuyenPhamVi.ts");
  const MA = `import type { Express, Request, Response } from "express";
import * as db from "../db";

/** Tệp ĐỘT BIẾN do \`phamViTuyenCensus.test.ts\` §7 sinh ra và tự xoá. KHÔNG gắn vào app thật. */
export function dangKyDotBienTuyen(app: Express): void {
  // (a)(b) — ĐỌC toàn đội máy, KHÔNG một phép thu hẹp nào: đúng hình dạng của lỗ thứ chín.
  app.get("/api/__dot-bien/ro-ri", async (_req: Request, res: Response) => {
    res.json({ machines: await db.getMachines() });
  });
  // (c) — ĐỐI CHỨNG: cùng lượt đọc, có phạm vi người gọi ⇒ phải KHÔNG bị bắt.
  app.get("/api/__dot-bien/da-loc", async (req: Request, res: Response) => {
    const { phamViGoiNgoai, nguoiXemCuaPhamVi } = await import("./_phamViNgoai");
    const phamVi = phamViGoiNgoai(req);
    res.json({ machines: await db.getMachines(nguoiXemCuaPhamVi(phamVi)) });
  });
}
`;

  it("★★★ tuyến rò MỚI ⇒ nhóm A + KHÔNG có trong sổ nợ; bản đã lọc ⇒ nhóm S", () => {
    expect(existsSync(FILE_DOT_BIEN), "file đột biến còn sót từ lượt trước — dọn đi trước khi chạy").toBe(false);
    try {
      // Tệp ẢO (không ghi đĩa): ghi tệp tạm vào server/routes/ làm các lưới quét khác nổ ENOENT khi chạy song song.
      const lai = quetPhamViDoc(GOC_REPO, { "server/routes/__dotBienTuyenPhamVi.ts": MA });
      const tim = (duong: string): TuyenExpress | undefined =>
        lai.tuyen.find((t) => t.file.endsWith("__dotBienTuyenPhamVi.ts") && t.duong === duong);

      const roRi = tim("/api/__dot-bien/ro-ri");
      expect(roRi, "bộ suy KHÔNG THẤY tuyến mới — lượng từ đã thủng, mọi ô khác vô nghĩa").toBeDefined();
      expect(roRi?.chamTenant, "tuyến rò phải được nhận ra là chạm dữ liệu tenant").toBe(true);
      expect(nhomTuyenCua(roRi as TuyenExpress)).toBe("A");
      expect(NO_PHAM_VI_TUYEN).not.toContain(khoaTuyen(roRi as TuyenExpress));

      // ⚠ Cầu chì chống "ĐỎ nhưng không nói được ĐỎ Ở ĐÂU": dựng lại đúng danh sách mà §4 in ra và
      //   đòi tên tuyến rò có mặt trong đó. Một cổng đỏ mà không gọi đích danh thì người sau sẽ
      //   tắt nó đi thay vì đi sửa.
      const so = new Set(NO_PHAM_VI_TUYEN);
      const moi = lai.tuyen
        .filter((t) => nhomTuyenCua(t) === "A" && !so.has(khoaTuyen(t)))
        .map(khoaTuyen);
      expect(moi).toContain(khoaTuyen(roRi as TuyenExpress));

      const daLoc = tim("/api/__dot-bien/da-loc");
      expect(daLoc).toBeDefined();
      expect(daLoc?.chamTenant, "bản đối chứng phải VẪN chạm dữ liệu tenant").toBe(true);
      expect(nhomTuyenCua(daLoc as TuyenExpress), "CHỐNG VÁ QUÁ TAY: có phạm vi ⇒ KHÔNG bị bắt").toBe("S");
    } finally {
      rmSync(FILE_DOT_BIEN, { force: true });
    }
    expect(existsSync(FILE_DOT_BIEN), "phép đột biến phải tự dọn — file rò không được ở lại cây").toBe(false);
  }, 180_000);
});

describe("§8 — NHÓM (U): lượt UỶ QUYỀN là một PHÉP NỐI CÓ KIỂM CHỨNG, không phải một cái nhãn", () => {
  /**
   * 16 tuyến `/api/machine/**` và `/api/public/**` chỉ dựng `createContext({req,res})` rồi gọi
   * `appRouter.createCaller(ctx).x.y(…)`. Phán quyết phạm vi của chúng **ĐÚNG BẰNG** phán quyết
   * của thủ tục đích — đã được đếm trong 2.209. Nếu không nối lại, nhóm (U) chỉ là một chỗ trốn.
   */
  const nhomThuTuc = new Map(QUET.thuTuc.map((t) => [khoaCua(t), nhomCua(t)]));

  it("★★ mọi đích uỷ quyền GIẢI ĐƯỢC về một thủ tục tRPC CÓ THẬT", () => {
    const hong = cua("U")
      .flatMap((t) => t.uyQuyen.map((k) => ({ t, k })))
      .filter(({ k }) => !nhomThuTuc.has(k))
      .map(({ t, k }) => `${khoaTuyen(t)} → ${k}`);
    expect(
      hong,
      "Bản đồ alias `appRouter` không giải được đích này ⇒ tuyến ấy đang ở nhóm (U) mà KHÔNG ai\n" +
        "biết nó uỷ quyền cho cái gì — tức (U) trở thành chỗ trốn. Xem `giaiAlias` ở `phamViDocScan.ts`.",
    ).toEqual([]);
  });

  it("★★★ tuyến UỶ QUYỀN cho một thủ tục nhóm (A) phải là tập ĐÃ KÝ", () => {
    // Đây là lời khai QUAN TRỌNG NHẤT của §8: một tuyến REST rò **qua** một món nợ tRPC đã có tên
    // trong `phamViDocBaseline.ts`. Không ghim thì lỗ ấy có hai lớp vỏ (REST → tRPC) và không sổ
    // nào nói ra được rằng nó **cũng** lộ ra ngoài qua HTTP thuần.
    const roQuaUyQuyen = cua("U")
      .filter((t) => t.uyQuyen.some((k) => nhomThuTuc.get(k) === "A"))
      .map((t) => `${khoaTuyen(t)} → ${t.uyQuyen.filter((k) => nhomThuTuc.get(k) === "A").join(", ")}`)
      .sort();
    expect(roQuaUyQuyen).toEqual([
      "server/_core/index.ts#GET /api/machine/config → server/routers/hierarchyRouters.ts#machineRouter.config",
    ]);
  });

  it("★ số tuyến uỷ quyền ĐÚNG BẰNG số đã ghim (thêm một proxy mới phải được ký)", () => {
    expect(cua("U").length).toBe(GHIM.U);
  });
});
