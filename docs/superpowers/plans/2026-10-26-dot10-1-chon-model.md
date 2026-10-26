# Đợt 10.1 — Chọn model theo yêu cầu (A1 danh mục · A2 hợp đồng `chonModel` · A4 sửa `ai.agent`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Máy chủ trả một danh mục model chọn được (vai trò · hồ sơ Local · model ngoài khi bật) và mọi bề mặt nhận một trường `chonModel` thống nhất; giá trị lạ bị từ chối thay vì coi là tên tệp GGUF.

**Architecture:** Một module mới `server/services/ai/chonModel/` gồm `danhMuc.ts` (A1) và `giaiChonModel.ts` (A2) — cả hai THUẦN theo ảnh sổ model (`layAnhSoModel()`) + phụ thuộc tiêm được; một router mới `aiChonModelRouter.ts` (KHÔNG sửa `aiGgufRouter.ts`/`datGan.ts` — luong-ui đang sửa). Các bề mặt (/v1, KB ask/stream, lượt agent, node Luồng `ai.*`) gọi `giaiChonModel` khi có `chonModel`; vắng/`auto` ⇒ đường hiện nay bit-đối-bit. Model ngoài (`loai:"ngoai"`) chỉ có điểm nối kiểu (`NguonModelNgoai`) — 10.3 cài đặt.

**Tech Stack:** TypeScript, tRPC, Express, vitest, drizzle (đọc), không migration.

**Spec:** `docs/superpowers/specs/2026-10-26-ai-local-chon-model-va-kiem-dinh-ngoai-design.md` §4 (A1, A2, A4); A3 (UI) thuộc 10.2/luong-ui. Ràng buộc kiem-dinh cho model ngoài (§C tin dieu-phoi 2026-10-26): "auto" KHÔNG BAO GIỜ chọn ngoài; `ngoai:…` của nhà máy tắt ⇒ NOT_FOUND.

## Global Constraints

- KHÔNG sửa `server/services/ai/soModel/datGan.ts` và thủ tục `soModelDatGan` / tệp `server/routers/aiGgufRouter.ts` cho tới khi lô luong-ui gộp.
- Không migration (10.1 không cần bảng mới).
- Định dạng `ma` (cố định, mọi bề mặt dùng chung): `auto` · `vai-tro:<idVaiTro>` · `ho-so:<profileId>` · `ngoai:<nhaCungCap>:<model>`.
- Không lộ đường dẫn tệp, cổng, khoá trong danh mục (chỉ `ma`, `nhan`, `moTa`, trạng thái).
- Giá trị `chonModel` lạ ⇒ `appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "chonModel", reason: "chonModelKhongHopLe" }, …)`; `ngoai:` không có trong danh mục của nhà máy người gọi ⇒ NOT_FOUND (cùng câu như ngoài phạm vi).
- `auto` / vắng ⇒ hành vi hiện nay KHÔNG đổi một byte (lưới cũ giữ xanh).
- Mọi `throw` mới dùng `appError` (rawErrorCensus 462 không tăng).
- Census: thủ tục mới phải qua `congGiayPhepAiCensus` (MOD_AI) và `phamViDocCensus`; ghi số mới có lý do + ngày ngay trong tệp census.

## Review Focus

1. Hồ sơ đủ điều kiện nhưng đang `enabled=false` hoặc `artifactStatus≠available` ⇒ phải là `trangThai:"tat"` và `giaiChonModel` từ chối (không âm thầm rơi về mặc định).
2. `vai-tro:` một vai không sinh chữ (`embed`, `rerank`, `vision`, `fim`) trên bề mặt chat ⇒ BAD_REQUEST, không gọi engine với model nhúng.
3. Node Luồng xuất/nhập gói sang nhà máy khác giữ `ho-so:<id>` không tồn tại ở đó ⇒ lỗi rõ lúc chạy (BAD_REQUEST), không rơi mặc định im lặng.
4. /v1 trước đây nhận tên tệp GGUF trần (`kiemModelV1` nhánh 4) — client cũ gửi tên tệp ⇒ nay 400 `model_not_found` KÈM danh sách dạng hợp lệ; mọi bên gọi trong repo (extension, scripts/ai-eval, mẫu cấu hình) đổi trong cùng lô (Task 4 Step 1b); tên logic cũ (`chat`, `code`, `fast`, `fim`, `embed`) và id hồ sơ trần vẫn qua.
6. /v1 `model:"ngoai:…"` (10.3): đi qua CÙNG cổng `goiAiNgoai`; nhà máy lấy từ chủ của API key — key không gắn nhà máy / chủ không xác định ⇒ NOT_FOUND (10.3 Task 8 sở hữu ca này; 10.1 chỉ trả NOT_FOUND vì danh mục ngoài rỗng).
5. `chonModel:"auto"` trên node Luồng có vai mặc định nhẹ ⇒ vẫn `khongDoiKhe:true` (không kéo đổi khe nặng giữa lượt nền).

---

### Task 1: Danh mục model (A1) — service thuần

**Files:**
- Create: `server/services/ai/chonModel/kieu.ts`, `server/services/ai/chonModel/danhMuc.ts`
- Test: `server/services/ai/chonModel/danhMuc.test.ts`

**Interfaces:**
- Produces (`kieu.ts`):
  - `type LoaiMuc = "auto" | "vai-tro" | "ho-so" | "ngoai"`
  - `type TrangThaiMuc = "san-sang" | "can-doi-khe" | "tat"`
  - `interface MucModel { ma: string; loai: LoaiMuc; nhan: string; moTa: string; trangThai: TrangThaiMuc; uocTinhDoiKheGiay?: number; nhaCungCap?: string }`
  - `interface NguonModelNgoai { layModelDaBat(factoryId: number | null): Promise<Array<{ nhaCungCap: string; model: string; nhan: string }>> }` — mặc định trả `[]` (10.3 thay).
  - `interface PhuThuocDanhMuc { anh: AnhSoModel; hoSoCoDo: ReadonlySet<string>; kheDangGiu: string | null; uocTinhDoiKheGiay: () => Promise<number | null>; ngoai: NguonModelNgoai }`
- Produces (`danhMuc.ts`): `layDanhMucModel(factoryId: number | null, dep: PhuThuocDanhMuc): Promise<MucModel[]>`; `uocTinhDoiKheTuSuKien(db): Promise<number | null>` (trung vị `detail.ms` của 20 sự kiện `vram_events` `event='doi_khe'` gần nhất ÷ 1000, làm tròn; không có ⇒ null); `layPhuThuocDanhMucMacDinh(db): Promise<PhuThuocDanhMuc>` (anh = `layAnhSoModel()`, hoSoCoDo = `selectDistinct profileId` từ `ai_model_eval_runs` như `aiGgufRouter.ts:376`, kheDangGiu = `nguCanhKhe().kheDangGiu`).

- [ ] **Step 1: Test** `danhMuc.test.ts` (ảnh sổ dựng tay, không DB):
  - mục đầu `{ ma:"auto", loai:"auto", trangThai:"san-sang" }`;
  - đúng 11 mục `vai-tro:*` theo `VAI_TRO_GOC` (id, `nhan`=id, `moTa`=moTa của vai);
  - hồ sơ `p35` (nang, available, license "apache-2.0", có trong hoSoCoDo, đang giữ) ⇒ `{ ma:"ho-so:p35", trangThai:"san-sang" }`; hồ sơ `p27` nang chưa giữ ⇒ `trangThai:"can-doi-khe", uocTinhDoiKheGiay: 45` (dep trả 45);
  - hồ sơ license `"unknown"` hoặc không có lượt đo ⇒ KHÔNG có trong danh mục; `enabled:false` / `artifactStatus:"missing"` ⇒ có, `trangThai:"tat"`;
  - không mục nào chứa `artifactFile`, `:\`, `/`, `8091` trong bất kỳ trường nào (`JSON.stringify` không khớp `/[\\/]|:\d{2,5}\b|\.gguf/`);
  - `ngoai.layModelDaBat` trả `[{nhaCungCap:"anthropic",model:"claude-opus-5-5",nhan:"Claude Opus 5.5"}]` ⇒ mục `{ ma:"ngoai:anthropic:claude-opus-5-5", loai:"ngoai", nhaCungCap:"anthropic", trangThai:"san-sang" }`; trả `[]` ⇒ không mục ngoài.
- [ ] **Step 2: Chạy** `npx vitest run server/services/ai/chonModel/danhMuc.test.ts` — FAIL (module chưa có).
- [ ] **Step 3: Cài** `kieu.ts` + `danhMuc.ts` theo Interfaces. `nhan` hồ sơ = profile id (không phải tên tệp).
- [ ] **Step 4: Chạy lại** — PASS. Thêm ca `uocTinhDoiKheTuSuKien` với db giả (3 sự kiện 40 000 / 50 000 / 60 000 ms ⇒ 50).
- [ ] **Step 5: Commit** `feat(chon-model): danh muc model chon duoc (A1) - auto/vai-tro/ho-so/ngoai, khong lo duong dan`

### Task 2: Thủ tục `aiChonModel.danhMuc` (tRPC, MOD_AI, không cần admin)

**Files:**
- Create: `server/routers/aiChonModelRouter.ts`
- Modify: `server/routers.ts` (mount `aiChonModel: aiChonModelRouter` cạnh `aiGguf`), `server/routers/congGiayPhepAiCensus.test.ts` (GHIM), `server/routers/phamViDocCensus.test.ts` (GHIM)
- Test: `server/routers/aiChonModelRouter.test.ts`

**Interfaces:**
- Consumes: `layDanhMucModel`, `layPhuThuocDanhMucMacDinh` (Task 1); `phamViCua(ctx)` (`server/routers/_phamViNguoiXem.ts:38`) để lấy nhà máy người gọi.
- Produces: `aiChonModel.danhMuc` — `moduleProcedure("MOD_AI").query(): MucModel[]`. Nhà máy người gọi: nhà máy đầu của phạm vi (`null` nếu admin không gắn nhà máy ⇒ không có mục ngoài).

- [ ] **Step 1: Test** gọi qua `appRouter.createCaller`: người dùng engineer có MOD_AI ⇒ mảng có `auto` + 11 vai; người dùng không có MOD_AI ⇒ FORBIDDEN; không có đầu vào nào (input rỗng).
- [ ] **Step 2: Chạy** — FAIL.
- [ ] **Step 3: Cài** router + mount.
- [ ] **Step 4: Chạy** test + `npx vitest run server/routers/congGiayPhepAiCensus.test.ts server/routers/phamViDocCensus.test.ts`; cập nhật GHIM theo số census báo (dự kiến `tong`/`beMatAi`/`aiCoCong` +1; phamViDoc `C` +1, `tong` +1), mỗi số kèm chú thích `2026-10-26 Đợt 10.1 aiChonModel.danhMuc`.
- [ ] **Step 5: Commit** `feat(chon-model): thu tuc aiChonModel.danhMuc (MOD_AI) + census`

### Task 3: Hợp đồng `giaiChonModel` (A2)

**Files:**
- Create: `server/services/ai/chonModel/giaiChonModel.ts`
- Test: `server/services/ai/chonModel/giaiChonModel.test.ts`

**Interfaces:**
- Consumes: `dinhTuyenVaiTro(yc, anh, env)` (`soModel/dinhTuyenVaiTro.ts:133`), `laVaiTroSinhChu` (:78), `VAI_TRO_NHE_KHONG_DOI_KHE` (:87), `nguCanhKhe()` (`modelResolver.ts:237`), `MucModel`/`PhuThuocDanhMuc` (Task 1).
- Produces:
  - `type DichChon = { loai: "local"; modelId: string | undefined; vaiTro: string; nguon: string; phamVi: string | null; canDoiKhe: boolean; uocTinhDoiKheGiay?: number } | { loai: "ngoai"; nhaCungCap: string; model: string }`
  - `interface NguCanhChon { phamVi?: YeuCauDinhTuyen["phamVi"]; khongDoiKhe?: boolean; factoryId: number | null; beMatChu: boolean /* true = chat/agent/coding/node sinh chữ */ }`
  - `giaiChonModel(chonModel: string | undefined, ngu: NguCanhChon, dep: PhuThuocDanhMuc): Promise<DichChon | null>` — `null` ⇔ vắng / `"auto"` (người gọi giữ đường hiện nay).

- [ ] **Step 1: Test** (bảng ca, ảnh sổ dựng tay):
  - `undefined`, `""`, `"auto"` ⇒ `null`;
  - `"vai-tro:code.plc"` + `phamVi:{flowId:"f1",beMat:"luong"}` ⇒ `{loai:"local", vaiTro:"code.plc"}` và `modelId`/`nguon` BẰNG kết quả `dinhTuyenVaiTro` cùng tham số (gán theo phạm vi thắng mặc định);
  - `"vai-tro:embed"` với `beMatChu:true` ⇒ ném `BAD_REQUEST` reason `chonModelKhongSinhChu`;
  - `"ho-so:p35"` đang giữ ⇒ `{loai:"local", modelId:"<artifactFile của p35>", nguon:"chon-tuong-minh", canDoiKhe:false}`; `"ho-so:p27"` nang chưa giữ ⇒ `canDoiKhe:true, uocTinhDoiKheGiay:45`;
  - `"ho-so:p-unknown-license"` / `"ho-so:khong-co"` / `"ho-so:p-tat"` ⇒ BAD_REQUEST `chonModelKhongHopLe`;
  - `"Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf"`, `"code"`, `"../x"`, `"vai-tro:"` ⇒ BAD_REQUEST (không còn tên tệp trần);
  - `"ngoai:anthropic:claude-opus-5-5"` khi `ngoai.layModelDaBat(factoryId)` có mục đó ⇒ `{loai:"ngoai", nhaCungCap:"anthropic", model:"claude-opus-5-5"}`; khi không có (nhà máy tắt / factoryId null) ⇒ `NOT_FOUND` reason `modelNgoaiKhongTonTaiHoacNgoaiPhamVi`; `"ngoai:anthropic:claude-gia-hop-le"` (khớp `CHON_MODEL_RE` nhưng KHÔNG có trong `layModelDaBat`) ⇒ NOT_FOUND (không tin regex — rà kiem-dinh mục 13);
  - `khong-bao-gio-ra-ngoai` (rà kiem-dinh mục 6): với MỌI vai trong `VAI_TRO_GOC` (`vai-tro:<id>`, bỏ vai không sinh chữ khi `beMatChu`) và MỌI hồ sơ trong danh mục dựng tay, kể cả khi `ngoai.layModelDaBat` trả danh sách KHÔNG rỗng và ảnh sổ có gán vai trỏ tới chuỗi trông như `ngoai:…` ⇒ kết quả luôn `loai:"local"` hoặc ném; `auto` luôn `null`;
  - `uoc-tinh-vang`: `uocTinhDoiKheGiay` dep trả `null` ⇒ `canDoiKhe:true` và KHÔNG có trường `uocTinhDoiKheGiay` (UI 10.2 ghi "chưa đo", không bịa số — dieu-phoi).
- [ ] **Step 2: Chạy** `npx vitest run server/services/ai/chonModel/giaiChonModel.test.ts` — FAIL.
- [ ] **Step 3: Cài**. `vai-tro:` truyền `khongDoiKhe` = `ngu.khongDoiKhe ?? VAI_TRO_NHE_KHONG_DOI_KHE.has(vaiTro)` khi `phamVi.beMat==="luong"`, và `...nguCanhKhe()`. `ho-so:` hợp lệ ⇔ có trong danh mục (Task 1) với `trangThai≠"tat"`.
- [ ] **Step 4: Chạy** — PASS.
- [ ] **Step 5: Commit** `feat(chon-model): hop dong giaiChonModel (A2) - gia tri la => BAD_REQUEST, ngoai khong bat => NOT_FOUND`

### Task 4: Nối `chonModel` vào bề mặt máy chủ

**Files:**
- Modify: `server/services/ai/kiemModelV1.ts` (bỏ nhánh 4 "tên tệp trần"), `server/routes/openaiGateway.ts:1026-1046` (nhận `ma` danh mục qua `body.model`), `server/routes/aiLocalKnowledgeApi.ts:111` `parseContext` (thêm `chonModel`), `server/services/aiLocalKnowledgeService.ts` (`KbQueryContext.chonModel?: string`; nhánh coding `aiLocalKnowledgeCoding.ts:481` và nhánh không-coding `modelTraLoiKb`), `server/routes/aiAgentApi.ts:80-97` + `server/services/ai/agent/quanLyLuotChay.ts:591-617` (body `chonModel`), `server/services/flow/nut/ai.ts` (`goiAi` đọc `thamSo.chonModel`), `server/services/flow/nut/sinhMa.ts`, `server/services/flow/dangKyNut.ts:28-40` (`VetModel.nhaCungCap?: string`)
- Test: `server/services/ai/kiemModelV1.test.ts` (sửa ca nhánh 4), `server/routes/openaiGateway.chonModel.test.ts`, `server/routes/aiLocalKnowledgeApi.chonModel.test.ts`, `server/services/ai/agent/quanLyLuotChay.chonModel.test.ts`, `server/services/flow/nut/ai.chonModel.test.ts`

**Interfaces:**
- Consumes: `giaiChonModel` (Task 3), `layPhuThuocDanhMucMacDinh` (Task 1).
- Produces: hằng `CHON_MODEL_RE = /^(auto|vai-tro:[a-z][a-z0-9]*(\.[a-z0-9-]+)?|ho-so:[A-Za-z0-9._@-]{1,96}|ngoai:[a-z0-9-]{1,32}:[A-Za-z0-9._:-]{1,96})$/` trong `chonModel/kieu.ts` (parseContext + zod dùng chung). Mọi bề mặt: `DichChon.loai==="ngoai"` ⇒ ném `appError("BAD_REQUEST","OPERATION_FAILED",{operation:"chonModel",reason:"modelNgoaiChuaCaiDat"})` (10.3 thay bằng cổng ngoài).

- [ ] **Step 1: Test** (mỗi bề mặt một tệp, engine/llama-server giả như lưới hiện có):
  - /v1: `model:"vai-tro:code.plc"` ⇒ engine nhận `modelId` = kết quả định tuyến; `model:"ho-so:p35"` ⇒ đúng tệp; `model:"Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf"` (tên tệp trần) ⇒ 400 `model_not_found`; `model:"chat"` / `"code"` / `"auto"` / id hồ sơ trần ⇒ như cũ.
  - KB: `context.chonModel:"vai-tro:code.plc"` ⇒ `modelVaiTro.vaiTro==="code.plc"` ở nhánh coding; giá trị không khớp `CHON_MODEL_RE` ⇒ bị `parseContext` bỏ (whitelist); vắng ⇒ `modelVaiTro` như cũ.
  - Agent: `POST /api/ai/agent/runs` `chonModel:"ho-so:p27"` ⇒ `taoGoiModelMayChu` nhận `modelId` của p27; vắng ⇒ `chuanBiLuotChayTheoVaiTro` như cũ.
  - Luồng: `ai.tom-tat` `thamSo.chonModel:"vai-tro:chat"` ⇒ `resolve` có `phamVi:{flowId,beMat:"luong"}`, `khongDoiKhe:true`; vết `buoc.model` có `nguon`; `thamSo.chonModel:"Qwen.gguf"` ⇒ node lỗi `BAD_REQUEST`.
  - Mọi bề mặt: `chonModel:"ngoai:anthropic:x"` ⇒ NOT_FOUND (danh mục ngoài rỗng ở 10.1).
  - /v1 từ chối tên tệp trần: thân lỗi 400 nêu giá trị HỢP LỆ (`"auto"`, tên logic `chat|code|fast|fim|embed`, `vai-tro:<id>`, `ho-so:<id>`, và gợi ý `GET /v1/models`) — test kiểm chuỗi lỗi chứa `vai-tro:` và `ho-so:` (dieu-phoi).
- [ ] **Step 1b: Kiểm kê bên gọi TRƯỚC khi bỏ nhánh 4** (điều kiện dieu-phoi): `rg -n "\.gguf" ` trên extension (`aviAiLocal.agentModel` mặc định + `package.json` contributes + README), `scripts/ai-eval/**`, `.env.example`, cấu hình mẫu, `docs/**` (chỉ hướng dẫn đang dùng, không sửa tài liệu lịch sử) — lọc nơi tên tệp GGUF được GỬI làm `model` tới /v1; đổi từng nơi sang `ho-so:<id>`/tên logic TRONG CÙNG lô commit; ghi bảng "nơi gọi → giá trị mới" vào thân commit. Extension: chỉ đổi mã nguồn mặc định + migration cấu hình người dùng (giá trị cũ kết thúc `.gguf` ⇒ đọc thành `auto` + cảnh báo một lần) — đóng gói/cài extension do luong-ui (chủ extension) — báo họ trước khi đụng tệp extension.
- [ ] **Step 2: Chạy** từng tệp — FAIL.
- [ ] **Step 3: Cài** theo Files; ghi `vaiTro/model/nguon/nhaCungCap` vào vết như `ai.ts:70-92`.
- [ ] **Step 4: Chạy** test mới + lưới cũ của các bề mặt: `npx vitest run server/routes/openaiGateway server/routes/aiLocalKnowledge server/services/ai/agent server/services/flow server/services/ai/kiemModelV1` — PASS.
- [ ] **Step 5: Commit** `feat(chon-model): chonModel cho /v1, KB, agent, node Luong - auto/vang giu duong cu`

### Task 5: A4 — `ai.agent` đi đúng phạm vi + chú thích cờ

**Files:**
- Modify: `server/services/flow/nut/agent.ts:39-45` (nhận `ngu`; `resolveLogicalModel(vaiTro, { phamVi:{ flowId: ngu.flowId, beMat:"luong" }, khongDoiKhe:true })`; nếu `thamSo.chonModel` ⇒ `giaiChonModel`; gọi `ngu.ghiModel?.(await diemModel(vaiTro, ngu))` như `goiAiCoVet`), `server/services/aiLocalKnowledgeCoding.ts:475` (chú thích: `AI_TRO_LY_THEO_VAI_TRO` mặc định BẬT, khớp `vaiTroTacNhan.ts:37-38`)
- Test: `server/services/flow/nut/agent.phamVi.test.ts`

**Interfaces:** Consumes `diemModel(vaiTro, ngu)` (`ai.ts:70`), `giaiChonModel` (Task 3).

- [ ] **Step 1: Test** ảnh sổ có gán `code.plc` phạm vi `flow:f1` ⇒ node `ai.agent` trong luồng `f1` dùng model của gán phạm vi (không phải gán global); khe nặng giữ model khác + vai nhẹ ⇒ không đổi khe (`khongDoiKhe:true` tới `dinhTuyenVaiTro`); `ngu.ghiModel` được gọi đúng 1 lần mỗi lượt model với `vaiTro` đúng.
- [ ] **Step 2: Chạy** — FAIL (hôm nay bỏ phạm vi).
- [ ] **Step 3: Cài**.
- [ ] **Step 4: Chạy** test + `npx vitest run server/services/flow` — PASS; đột biến bỏ `phamVi` ⇒ ca 1 đỏ.
- [ ] **Step 5: Commit** `fix(luong): ai.agent dinh tuyen dung pham vi flow + khongDoiKhe + vet model (A4); chu thich co tro-ly theo vai tro`

### Task 6: Lưới trọn + báo

- [ ] `npx vitest run server/services/ai server/routes server/routers server/services/flow ensus` — xanh; số GHIM census đã đổi kèm lý do.
- [ ] Gửi dieu-phoi tip + danh sách thay đổi hợp đồng cho luong-ui (10.2): định dạng `ma`, `aiChonModel.danhMuc`, trường `chonModel` theo bề mặt (/v1 dùng `model`).
