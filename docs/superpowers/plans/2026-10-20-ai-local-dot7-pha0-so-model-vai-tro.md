# Đợt 7 · Pha 7.0 — Sổ model + Vai trò + Định tuyến tầng 1–3 · Kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gọi model theo VAI TRÒ (`code.plc`, `extract`…) qua một sổ trong CSDL, ngày đầu hành vi y nguyên `.env`.

**Architecture:** Bảng sổ (mig 0400) + ảnh chụp trong bộ nhớ làm mới mỗi 15 s; bộ định tuyến THUẦN đọc ảnh chụp
(tầng 1 tường minh · 2 phạm vi · 3 tín hiệu); `modelResolver.resolveLogicalModel` nhận tên vai trò; `/v1/models`
liệt kê vai trò. Gán seed theo kiểu **theo-env** (`envKey`) ⇒ tương đương bằng cấu trúc. Gán cố định vào khe nặng mà
server chưa giữ ⇒ rơi về dự phòng (hoán đổi thật là pha 7.1).

**Tech Stack:** TypeScript, drizzle-orm/pg, postgres.js, vitest, tRPC, zod.

**Spec:** `docs/superpowers/specs/2026-10-20-ai-local-da-model-va-luong-tu-dong-design.md` §3.1–3.4, §6 (7.0).

## Global Constraints
- Dải migration AI Local mới: **0400–0419**. DDL chạy bằng owner `aoi` qua `scripts/apply-migration-0400.mjs --test-only|--dev-only|--both`, có nghiệm thu bằng vai `avi_app`; GRANT `SELECT, INSERT, UPDATE, DELETE` cho `avi_app`.
- Không FUNCTION/TRIGGER trong 0400 (nếu buộc phải có: `SET search_path = pg_catalog, public, pg_temp` + tên `public.`).
- Cột camelCase có nháy kép (khuôn 0390). `timestamp` như 0390.
- Tên tệp GGUF chỉ xuất hiện trong sổ; tên vai trò khớp `^[a-z][a-z0-9]*(\.[a-z0-9-]+)?$`.
- Tên logic cũ (`chat`/`code`/`coder`/`fast`/`fim`/`infill`/`embed*`) và đường passthrough tên tệp **không đổi hành vi**.
- `.env` repo chính chỉ chủ dự án sửa — không thêm khoá bắt buộc; mọi khoá mới có mặc định an toàn.
- Gán `active` trỏ profile cố định cần `evalRunId` (cổng đo) và giấy phép ≠ `unknown`; gán theo-env không cần.

## Review Focus
1. CSDL chưa lên / bảng chưa áp lúc khởi động ⇒ ảnh chụp rỗng ⇒ mọi tên vai trò phải phân giải theo env mặc định, không ném, không 500.
2. Client gửi `model: "code.plc"` khi vai trò không tồn tại trong sổ ⇒ phải rơi về mặc định của tầng tương ứng, **không** bị coi là tên tệp (passthrough) rồi nạp hỏng.
3. Gán cố định vào profile khe `nang` khác model server đang giữ ⇒ không được nạp model 30B thứ hai trong tiến trình; rơi dự phòng + lý do `khe-nang-chua-hoan-doi`.
4. Hai gán cùng (vai trò, phạm vi, chế độ) còn hiệu lực ⇒ CSDL chặn (UNIQUE một phần), không để định tuyến tự chọn ngẫu nhiên.
5. Tệp model bị xoá khỏi kho sau khi đã có gán ⇒ artifact `missing`, định tuyến bỏ qua profile đó và đi dự phòng.

---

### Task 1: Từ vựng vai trò + tín hiệu tất định (thuần)

**Files:** Create `shared/aiRoles.ts` · Test `shared/aiRoles.test.ts`

**Interfaces — Produces:**
- `type VaiTro = string` (đã kiểm hình dạng) · `const VAI_TRO_GOC: readonly { id: string; moTa: string; envKey: EnvKeyModel; taskKind: "chat"|"code"|"fast"|"fim"|"embed"|"vision" }[]`
- `type EnvKeyModel = "GGUF_DEFAULT_MODEL"|"GGUF_CODE_MODEL"|"GGUF_FAST_MODEL"|"GGUF_FIM_MODEL"|"GGUF_EMBED_MODEL"|"GGUF_VISION_MODEL"|"GGUF_RERANKER_MODEL"`
- `laTenVaiTro(s: unknown): s is string` · `laTenLogicCu(s: string): boolean`
- `vaiTroTuTinHieu(t: { loaiDuAn?: string; duoiTep?: string; ngonNgu?: string }): { vaiTro: string; bangChung: string } | null`

Vai trò gốc (id → envKey · taskKind): `chat`→DEFAULT·chat · `chat.ops`→FAST·fast · `code.software`→CODE·code ·
`code.plc`→CODE·code · `extract`→FAST·fast · `classify`→FAST·fast · `summarize`→DEFAULT·chat · `vision`→VISION·vision ·
`embed`→EMBED·embed · `rerank`→RERANKER·embed · `fim`→FIM·fim.

Tín hiệu `code.plc`: `loaiDuAn ∈ {plc}`; `duoiTep ∈ {.st,.scl,.awl,.il,.iecst,.pou}` (không phân biệt hoa thường);
`ngonNgu ∈ {st, iec-st, structured-text, scl, il}`. Tín hiệu `code.software`: `loaiDuAn ∈ {web, dotnet, python, node}`.
Khác ⇒ `null`.

- [ ] Viết test: `laTenVaiTro("code.plc")===true`, `laTenVaiTro("../x")===false`, `laTenVaiTro("Code")===false`; `laTenLogicCu("coder")===true`, `laTenLogicCu("code.plc")===false`; `vaiTroTuTinHieu({duoiTep:".SCL"})` → `{vaiTro:"code.plc", bangChung:"đuôi tệp .scl"}`; `vaiTroTuTinHieu({ngonNgu:"typescript"})===null`; mỗi id trong `VAI_TRO_GOC` qua `laTenVaiTro` và không trùng.
- [ ] Chạy `npx vitest run shared/aiRoles.test.ts` → FAIL (chưa có module).
- [ ] Hiện thực.
- [ ] Chạy lại → PASS. Commit `feat(ai-local): tu vung vai tro model + tin hieu tat dinh (dot 7.0)`.

### Task 2: Migration 0400 + schema drizzle + script áp

**Files:** Create `drizzle/0400_ai_model_registry.sql`, `drizzle/schema/aiModelRegistry.ts`, `scripts/apply-migration-0400.mjs` · Modify `drizzle/schema/index.ts` (thêm `export * from "./aiModelRegistry"`)

Bảng (khác spec §3.3 ở 2 điểm, ghi lại vào spec: gán có `envKey` thay cho profile khi theo-env; lịch sử bằng `retiredAt` thay vì sửa tại chỗ):
- `ai_model_artifacts(id varchar(96) PK, "filePath" varchar(260) NOT NULL UNIQUE, sha256 varchar(64), family varchar(48) NOT NULL, "paramsTotalB" numeric, "paramsActiveB" numeric, quant varchar(24), "ctxNative" int, license varchar(48) NOT NULL DEFAULT 'unknown', "sizeBytes" bigint, "vramWeightsMb" int, modalities text[] NOT NULL DEFAULT '{text}', "loai" varchar(16) NOT NULL DEFAULT 'sinh-chu', status varchar(16) NOT NULL DEFAULT 'available', "createdAt", "updatedAt")` — CHECK status ∈ {available,missing,quarantined}; loai ∈ {sinh-chu,nhung,xep-hang,chieu-thi-giac}; filePath không chứa `/` `\` `..`.
- `ai_serving_profiles(id varchar(96) PK, "artifactId" FK, "slotClass" varchar(8) NOT NULL, ctx int NOT NULL, "serverArgs" jsonb '{}', sampling jsonb '{}', thinking varchar(8) DEFAULT 'auto', "vramEstMb" int, enabled bool DEFAULT true, "createdAt")` — CHECK slotClass ∈ {nang,nho,sidecar}; thinking ∈ {on,off,auto}; ctx 512..262144.
- `ai_roles(id varchar(48) PK, "moTa" text NOT NULL, "evalSuite" varchar(64), examples text[] NOT NULL DEFAULT '{}', "envKey" varchar(32) NOT NULL, "taskKind" varchar(16) NOT NULL)` — CHECK id hình dạng vai trò.
- `ai_model_bindings(id bigserial PK, "roleId" FK, "scopeKind" varchar(8) NOT NULL, "scopeId" varchar(64), "profileId" FK NULL, "envKey" varchar(32) NULL, fallback text[] NOT NULL DEFAULT '{}', "evalRunId" bigint NULL, mode varchar(8) NOT NULL DEFAULT 'active', "createdBy" int NULL REFERENCES users, "createdAt", "retiredAt" timestamp NULL)` — CHECK đúng một trong (profileId, envKey); scopeKind ∈ {global,tenant,project,flow}; scopeId NULL ⇔ global; mode ∈ {active,shadow,thu}; UNIQUE một phần `("roleId","scopeKind",COALESCE("scopeId",''),mode) WHERE "retiredAt" IS NULL`.
- `ai_model_eval_runs(id bigserial PK, "profileId" varchar(96) NOT NULL, suite varchar(64) NOT NULL, "nTasks" int, "nPass" int, "nRuns" int, "p50Ms" int, "p90Ms" int, detail jsonb, "gitSha" varchar(40), "createdAt")`.
- Seed (ON CONFLICT DO NOTHING): 11 vai trò của Task 1; 11 gán `global/active` theo-env (`envKey` = cột của vai trò).

- [ ] Viết SQL + schema + script (khuôn `apply-migration-0398.mjs` + `apply-migration-dot10-common.mjs`). Nghiệm thu: (a) 5 bảng, CHECK đúng tên; (b) quyền avi_app S/I/U/D có, TRUNCATE không; (c) giao dịch hoàn tác: gán có cả profileId lẫn envKey ⇒ 23514; gán global có scopeId ⇒ 23514; hai gán active cùng (vai trò, global) chưa retire ⇒ 23505; vai trò `../x` ⇒ 23514; filePath `a/b.gguf` ⇒ 23514; (d) 11 vai trò + 11 gán seed; `__applied_migrations` 1 hàng.
- [ ] `node scripts/apply-migration-0400.mjs --test-only` → nghiệm thu đạt. Rồi `--dev-only`.
- [ ] `npx tsc --noEmit -p tsconfig.json` cho các tệp mới (hoặc lưới schema census nếu có đỏ). Commit `feat(ai-local): mig 0400 so model + vai tro + gan (dot 7.0)`.

### Task 3: Ảnh chụp sổ + bộ định tuyến vai trò (thuần) + nạp từ CSDL

**Files:** Create `server/services/ai/soModel/dinhTuyenVaiTro.ts`, `server/services/ai/soModel/anhSoModel.ts` · Test `server/services/ai/soModel/dinhTuyenVaiTro.test.ts`, `server/services/ai/soModel/anhSoModel.db.test.ts`

**Interfaces — Produces:**
```ts
export interface AnhSoModel {           // anhSoModel.ts
  taiLuc: number;                       // 0 = chưa nạp lần nào
  vaiTro: Map<string, { envKey: EnvKeyModel; taskKind: string }>;
  profile: Map<string, { artifactFile: string; slotClass: "nang"|"nho"|"sidecar"; artifactStatus: string; license: string; enabled: boolean }>;
  gan: { roleId: string; scopeKind: "global"|"tenant"|"project"|"flow"; scopeId: string|null; profileId: string|null; envKey: EnvKeyModel|null; fallback: string[]; mode: "active"|"shadow"|"thu" }[];
}
export const ANH_RONG: AnhSoModel;
export function layAnhSoModel(): AnhSoModel;                  // đồng bộ, không ném
export async function napAnhSoModel(db?): Promise<AnhSoModel>; // đọc 4 bảng, chỉ gán retiredAt IS NULL
export function khoiChayDongBoSoModel(nhipMs?: number): void; // nạp ngay (không chờ) + mỗi 15 s, unref, lỗi ⇒ giữ ảnh cũ + log 1 lần
// dinhTuyenVaiTro.ts
export interface YeuCauDinhTuyen { vaiTro?: string; phamVi?: { tenantId?: string; projectId?: string; flowId?: string }; tinHieu?: { loaiDuAn?: string; duoiTep?: string; ngonNgu?: string } }
export interface KetQuaDinhTuyen { vaiTro: string; model: string | undefined; nguon: "gan-env"|"gan-profile"|"du-phong"|"mac-dinh-env"; phamVi: "flow"|"project"|"tenant"|"global"|null; lyDo: { tang: 1|2|3|5; bangChung: string } }
export function dinhTuyenVaiTro(yc: YeuCauDinhTuyen, anh: AnhSoModel, env: NodeJS.ProcessEnv, vaiTroMacDinh?: string): KetQuaDinhTuyen
```
Luật: vai trò = `yc.vaiTro` hợp lệ (tầng 1) ?? `vaiTroTuTinHieu` (tầng 3) ?? `vaiTroMacDinh ?? "chat"` (tầng 5). Chọn gán `active` theo thứ tự flow > project > tenant > global (tầng 2 ghi `phamVi`). Gán theo-env ⇒ `model = toBasename(env[envKey])`, rỗng ⇒ theo `resolveTaskModel` của taskKind. Gán profile ⇒ dùng được khi `enabled && artifactStatus==="available"` và (slotClass ≠ `nang` hoặc `toBasename(artifactFile) === toBasename(env.LLAMA_SERVER_MODEL)`); không dùng được ⇒ thử lần lượt `fallback[]` cùng điều kiện ⇒ hết ⇒ mặc định env của vai trò, `nguon:"du-phong"`, bằng chứng chứa `khe-nang-chua-hoan-doi` hoặc `artifact-missing`. Vai trò không có trong ảnh (kể cả ảnh rỗng) ⇒ map qua `VAI_TRO_GOC`; không có nốt ⇒ `chat`.

- [ ] Test thuần (ảnh dựng tay): ảnh rỗng + `vaiTro:"code.plc"` ⇒ model = basename `GGUF_CODE_MODEL`; gán project `code.plc`→profile `nho` available ⇒ dùng profile, `phamVi:"project"`; cùng gán nhưng khe `nang` khác `LLAMA_SERVER_MODEL` ⇒ `nguon:"du-phong"`, bằng chứng chứa `khe-nang-chua-hoan-doi`; artifact `missing` + fallback hợp lệ ⇒ fallback; gán `thu` bị bỏ qua; `tinHieu:{duoiTep:".st"}` không vaiTro ⇒ `code.plc`, `tang:3`; `vaiTro:"../x"` ⇒ coi như không khai; **bất biến tương đương:** với ảnh seed (11 gán theo-env global) và env bất kỳ trong 4 bộ env mẫu, `dinhTuyenVaiTro({vaiTro:r.id})` = `resolveTaskModel(map taskKind)` cho mọi vai trò gốc có taskKind ∈ {chat→default, code, fast, fim}.
- [ ] Test DB (`*.db.test.ts`, khuôn `motionLockAuthority.dot10.db.test.ts`): sau mig 0400 trên `_test`, `napAnhSoModel()` trả 11 vai trò, 11 gán, `taiLuc>0`; gán đã `retiredAt` không có trong ảnh.
- [ ] FAIL → hiện thực → PASS. Commit `feat(ai-local): dinh tuyen vai tro tang 1-3 + anh chup so model (dot 7.0)`.

### Task 4: Đồng bộ kho model → `ai_model_artifacts`

**Files:** Create `server/services/ai/soModel/dongBoKhoModel.ts` · Test `server/services/ai/soModel/dongBoKhoModel.test.ts`

**Interfaces:** Consumes `lietKeModelTrongKho`, `docMetaGgufMacDinh` (`doiModelLlamaServer.ts`). Produces
`suyRaArtifact(tenTep: string, kichThuoc: number): { id; family; quant; loai; paramsTotalB?; paramsActiveB? }` (thuần) và
`dongBoKhoModel(deps?: { thuMuc?: string; db?; liet?: typeof lietKeModelTrongKho }): Promise<{ them: number; capNhat: number; mat: number }>`.

`suyRaArtifact`: id = basename chữ thường, ký tự ngoài `[a-z0-9.-]` → `-`, cắt 96; family = phần trước số tham số đầu tiên (`Qwen3.6-35B-A3B` → `qwen3.6`); `(\d+(?:\.\d+)?)B` → paramsTotalB; `A(\d+(?:\.\d+)?)B` → paramsActiveB; quant = đuôi `Q\d_K_[A-Z]+|Q\d_\d|Q8_0|F16|f16|UD-Q\d_K_XL`; loai từ cùng luật `phanLoai` (mmproj→chieu-thi-giac, embed→nhung, rerank→xep-hang). License KHÔNG đoán (để `unknown`; người khai ở 7.4).
Upsert theo `filePath`; tệp có trong bảng mà không còn trên đĩa ⇒ `status='missing'`; xuất hiện lại ⇒ `available`. Không bao giờ ném (lỗi ⇒ kết quả 0 + log).

- [ ] Test `suyRaArtifact("Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf", 1)` ⇒ family `qwen3.6`, total 35, active 3, quant `UD-Q4_K_XL`, loai `sinh-chu`; `"Qwen3-Embedding-0.6B-f16.gguf"` ⇒ loai `nhung`, total 0.6; `"Qwen3-VL-8B-mmproj-F16.gguf"` ⇒ `chieu-thi-giac`; id không chứa `/`, ≤ 96 ký tự. Test `dongBoKhoModel` với `liet` giả + DB `_test`: lần 1 thêm 2; bỏ 1 tệp ⇒ `mat:1` và status `missing`.
- [ ] FAIL → hiện thực → PASS. Commit `feat(ai-local): dong bo kho GGUF vao so model (dot 7.0)`.

### Task 5: Nối dây — resolver, `/v1/models`, khởi động, tRPC

**Files:** Modify `server/services/ai/modelResolver.ts` (`resolveLogicalModel`), `server/routes/openaiGateway.ts` (`/models`, `inferTaskFromLabel`), `server/_core/index.ts` + `server/worker.ts` (khởi động), `server/routers/aiGgufRouter.ts` (3 thủ tục) · Test `server/services/ai/modelResolver.vaiTro.test.ts`, mở rộng test gateway hiện có cho `/models`.

**Interfaces:** Consumes Task 3 (`dinhTuyenVaiTro`, `layAnhSoModel`, `khoiChayDongBoSoModel`), Task 4 (`dongBoKhoModel`).
- `resolveLogicalModel(requested)`: nhánh tên cũ giữ nguyên **từng byte**; trước nhánh passthrough: nếu `laTenVaiTro(key)` và (`key` có trong ảnh **hoặc** trong `VAI_TRO_GOC`) ⇒ `dinhTuyenVaiTro({vaiTro:key}, layAnhSoModel(), process.env).model`. Tên không phải vai trò ⇒ passthrough như cũ.
- `/v1/models`: giữ 5 mục cũ đúng thứ tự; nối thêm mỗi vai trò trong (ảnh ∪ `VAI_TRO_GOC`) không trùng tên cũ, `root` = model phân giải, thêm trường `kind:"role"`.
- `inferTaskFromLabel`: `code.*` ⇒ `"code"`.
- Khởi động: sau `khoiChayDongBoLuaChonModel()` gọi `khoiChayDongBoSoModel()`; ở `index.ts` (không ở worker) chạy nền `dongBoKhoModel()` một lần, không chặn boot.
- tRPC (`adminDoiModel`): `soModelTongQuan` (query: ảnh + artifacts + profiles + gán còn hiệu lực + kết quả `dinhTuyenVaiTro` cho mỗi vai trò global); `soModelDongBoKho` (mutation); `soModelDatGan` (mutation, zod: roleId hợp lệ, scopeKind/scopeId, đúng một trong profileId|envKey, mode) — retire gán cũ cùng khoá rồi chèn trong MỘT giao dịch; từ chối `mode:"active"` + profileId khi profile không có `ai_model_eval_runs` nào hoặc license `unknown` (mã `PRECONDITION_FAILED`, thông điệp tiếng Việt nói rõ cổng nào); ghi audit `aiGguf.soModelDatGan`; nạp lại ảnh ngay.

- [ ] Test: `resolveLogicalModel("code.plc")` với ảnh rỗng = `codeModelBasename()`; `resolveLogicalModel("Qwen3-4B-Instruct-2507-UD-Q4_K_XL")` = chính nó (passthrough không đổi); `resolveLogicalModel("fim")` không đổi (bảng test cũ xanh nguyên); `/v1/models` có `chat` ở vị trí 0 và có `code.plc` với `kind:"role"`; thủ tục `soModelDatGan` active+profile không eval ⇒ `PRECONDITION_FAILED`.
- [ ] Chạy lưới liên quan: `npx vitest run server/services/ai server/routes/openaiGateway server/routers/aiGgufRouter shared/aiRoles` + census `server/_core` + `server/services/vram` (điểm khởi động/spawn có thể bị census đếm) → xanh; đỏ có sẵn trên main thì đo trên main để phân biệt.
- [ ] Sống: `node scripts/apply-migration-0400.mjs --dev-only` đã chạy; khởi động server worktree :3010 (`.env` bản chép, ghi đè đường tuyệt đối), `curl /v1/models` có vai trò; `POST /v1/chat/completions` `model:"code.plc"` trả lời từ model đang ở :8091 (không nạp model thứ hai — kiểm log `[llama-server]`).
- [ ] Commit `feat(ai-local): noi so model vao resolver + /v1/models + tRPC (dot 7.0)`.

### Task 6: Tài liệu và cổng

**Files:** Modify spec §3.3 (2 điểm khác), §8 (ghi D1–D5 đã trả lời + khuyến nghị model D5); `docs/superpowers/plans/2026-10-14-ai-local-hoan-thien-7-tang.md` (thêm Đợt 7, Đợt 8, phụ thuộc).

- [ ] Ghi kết quả cổng 7.0 (lưới tương đương 100 %; H không tụt — H 12×3 chỉ chạy nếu 7.0 đổi đường sinh chữ; ở 7.0 đường cũ không đổi byte ⇒ ghi "không áp dụng, lý do") vào spec §6.
- [ ] Commit `docs(ai-local): dot 7/8 vao ke hoach 7 tang + cong 7.0`.
