// scripts/sim-factory/seed-esop.mjs
// ─────────────────────────────────────────────────────────────────────────────
// doc 48 R2 — SEED NỘI DUNG e-SOP + CHẠY MỘT PHIÊN THỰC THI ĐẦU-CUỐI (LDS-L5 §6.2,
// doc 44 W6-1 / gap G5.14).
//
// VẤN ĐỀ (audit L5): tính năng e-SOP (UI soạn + viewer + bảng sops/sop_steps/
//   sop_executions + router sop.*) ĐÃ dựng đủ nhưng 0 nội dung, 0 phiên thực thi
//   → không thể DEMO "e-SOP execution". Script này bơm nội dung THẬT + chạy 1 phiên
//   qua ĐÚNG máy-trạng-thái thật (start → confirm-step → finish).
//
// HONEST / CÁCH LÀM:
//   • Nội dung SOP là quy trình sản xuất THẬT (SMT changeover, hiệu chuẩn AOI, kiểm
//     profile lò reflow, kiểm trạm ESD, kiểm sản phẩm đầu FAI) — mỗi SOP 6-7 bước có
//     thứ tự, checklist bắt buộc (requires_confirm) + cổng quét vật tư (expected_input).
//   • PHIÊN THỰC THI dùng ĐÚNG hàm service THẬT (server/services/sopService.ts):
//     startExecution / confirmStep / finishExecution — CHÍNH máy-trạng-thái mà router
//     sop.* gọi (cổng-xác-nhận cưỡng chế bằng sopExecutionLogic thuần). KHÔNG chèn tay
//     hàng execution để vượt cổng. Script chạy bằng tsx nên import trực tiếp .ts được
//     (đúng cách như scripts/run-vision-validation.mjs).
//   • NHÃN "SIM": mọi SOP có code tiền tố `SIM-SOP-` + mô tả gắn "[SIM] doc-48 R2".
//     ĐẢO NGƯỢC hoàn toàn bằng `--purge` (xoá theo nhãn code).
//
// VAI TRÒ DB (quan trọng): .env hiện trỏ DATABASE_URL → role `avi_app` (WORM,
//   append-only — KHÔNG UPDATE/DELETE được). Seed cần DML đầy đủ nên script GHI ĐÈ
//   DATABASE_URL sang role `aoi` (đúng như các sim seed khác — "sim seeds as aoi
//   role") TRƯỚC khi service.getDb() (lazy) kết nối. Override chỉ ảnh hưởng TIẾN TRÌNH
//   NÀY, không đụng server đang chạy (:3000, tiến trình khác).
//
// KHÔNG đụng server/ hay client/ CODE (chỉ script này + package.json). KHÔNG git.
//
// Chạy:
//   npm run sim:esop                 (purge SIM cũ → tạo 5 SOP → chạy 1 phiên đầu-cuối)
//   npm run sim:esop -- --purge      (chỉ xoá sạch dữ-liệu e-SOP có nhãn SIM)
//   npm run sim:esop -- --no-run     (tạo SOP nhưng KHÔNG chạy phiên thực thi)
//   npm run sim:esop -- --db-url postgresql://aoi:aoi@127.0.0.1:5434/aoi_management
// ─────────────────────────────────────────────────────────────────────────────
import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

// ── args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const getOpt = (f, dflt) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
const PURGE_ONLY = hasFlag("--purge");
const NO_RUN = hasFlag("--no-run");

// ── Nạp .env (các biến phụ) rồi GHI ĐÈ DATABASE_URL sang role aoi (DML đầy đủ). ──
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) dotenv.config({ path: envPath });
const SEED_URL = getOpt(
  "--db-url",
  process.env.SEED_DATABASE_URL || "postgresql://aoi:aoi@127.0.0.1:5434/aoi_management",
);
// Quan trọng: đặt TRƯỚC khi import service — getDb() đọc process.env.DATABASE_URL lúc
// gọi (lazy) nên phiên service trong tiến trình này sẽ dùng role aoi.
process.env.DATABASE_URL = SEED_URL;

function maskUrl(url) {
  try { const u = new URL(url); if (u.password) u.password = "***"; return u.toString(); }
  catch { return String(url).replace(/\/\/[^@]*@/, "//***@"); }
}

console.log(
  "\n══════════════════════════════════════════════════════════════════\n" +
  "[sim/esop] SEED e-SOP (nội dung THẬT, nhãn \"SIM\") + 1 PHIÊN THỰC THI\n" +
  `           doc 48 R2 · LDS-L5 §6.2 · target DB: ${maskUrl(SEED_URL)}\n` +
  `           mode     : ${PURGE_ONLY ? "PURGE-ONLY (xoá dữ-liệu e-SOP nhãn SIM)" : (NO_RUN ? "SEED SOP (không chạy phiên)" : "SEED SOP + chạy 1 phiên đầu-cuối")}\n` +
  "           state-machine: service THẬT startExecution/confirmStep/finishExecution\n" +
  "══════════════════════════════════════════════════════════════════\n",
);

// ── Import service THẬT (qua tsx). Cùng code router sop.* gọi. ─────────────────
const svc = await import("../../server/services/sopService.ts");

// ── Raw client (aoi) cho resolve / purge / đếm (service không có các hàm này). ─
const sql = postgres(SEED_URL, { max: 3, onnotice: () => {} });

const tally = {};
const add = (t, n) => { tally[t] = (tally[t] ?? 0) + n; };

const SIM_TAG = "[SIM] doc-48 R2 — nội dung e-SOP mô phỏng, gắn nhãn SIM, đảo ngược bằng `npm run sim:esop -- --purge`.";
const SIM_CODE_PREFIX = "SIM-SOP-";

// ── ĐỊNH NGHĨA SOP (nội dung sản xuất THẬT) ───────────────────────────────────
// Mỗi SOP: code (nhãn SIM), title, description, ngữ cảnh (stationCode/productCode →
// resolve id lúc chạy, null nếu không thấy), và các bước có thứ tự.
// step: { text, confirm?, scan? }  — confirm=true → requires_confirm; scan="TOKEN"
// → expected_input (cổng quét, token đơn không khoảng trắng để khớp normalizeInput).
const SOP_DEFS = [
  {
    code: `${SIM_CODE_PREFIX}SMT-CHANGEOVER`,
    title: "Đổi hàng dây chuyền SMT (SMT line changeover)",
    description: "Quy trình đổi sản phẩm trên dây chuyền dán bề mặt: dừng an toàn, thay feeder/stencil, nạp chương trình, chạy first-article. " + SIM_TAG,
    stationCode: "SIM-L1-SPI-ST",
    steps: [
      { text: "Nhận work order mới. Đối chiếu BOM và setup-sheet feeder của sản phẩm kế tiếp; in nhãn lot mới." },
      { text: "Dừng băng tải cuối lô hiện tại, thực hiện khoá-treo an toàn (LOTO) máy P&P và lò reflow.\n- [ ] Băng tải đã dừng\n- [ ] LOTO đã gắn", confirm: true },
      { text: "Tháo feeder cart cũ, lắp feeder cart đã kit cho sản phẩm mới; quét mã cart để xác thực đúng bộ.", confirm: true, scan: "FDR-CART-B12" },
      { text: "Thay stencil đúng mã cho sản phẩm mới; kiểm tra căng lưới và vệ sinh; quét mã stencil.", confirm: true, scan: "STC-MAIN-07" },
      { text: "Nạp chương trình P&P + recipe in kem thiếc cho sản phẩm mới; kiểm nozzle và áp lực dao gạt.\n- [ ] Đúng program\n- [ ] Nozzle sạch/đủ", confirm: true },
      { text: "Chạy 3 board thử; kiểm SPI + AOI board đầu; xác nhận first-article PASS trước khi vào loạt.", confirm: true },
      { text: "Ghi thời điểm hoàn tất changeover, tháo LOTO và mở lại băng tải vào sản xuất loạt." },
    ],
  },
  {
    code: `${SIM_CODE_PREFIX}AOI-DAILYCAL`,
    title: "Hiệu chuẩn AOI hằng ngày (AOI daily calibration)",
    description: "Kiểm tra và hiệu chuẩn máy AOI đầu ca: vệ sinh quang học, hiệu chuẩn camera bằng golden board, kiểm độ lặp lại đo. " + SIM_TAG,
    stationCode: "SIM-L1-AOI-ST",
    steps: [
      { text: "Bật máy AOI và để ổn định nhiệt độ/nguồn sáng tối thiểu 15 phút trước khi hiệu chuẩn." },
      { text: "Vệ sinh mặt kính camera và tấm nền; kiểm tra dàn đèn LED không có điểm chết.\n- [ ] Kính sạch, không bụi/vân tay\n- [ ] Đèn LED sáng đều 4 phía", confirm: true },
      { text: "Đặt tấm chuẩn hiệu chuẩn (golden calibration board) vào băng tải và quét mã tấm chuẩn.", confirm: true, scan: "CAL-AOI-STD" },
      { text: "Chạy chương trình hiệu chuẩn camera (offset dx/dy, scale, xoay). Xác nhận sai số dư ≤ 15µm.", confirm: true },
      { text: "Kiểm tra độ lặp lại đo chiều cao/thể tích (Gage R&R nhanh). Xác nhận %GRR ≤ 10%.", confirm: true },
      { text: "Kiểm tra đầu đọc barcode và cảm biến cường độ sáng đạt ngưỡng tham chiếu.", confirm: true },
      { text: "Lưu báo cáo hiệu chuẩn vào hệ thống và dán nhãn ngày/ca lên máy." },
    ],
  },
  {
    code: `${SIM_CODE_PREFIX}REFLOW-PROFILE`,
    title: "Kiểm tra profile lò reflow (Reflow oven profile verification)",
    description: "Xác minh profile nhiệt lò reflow cho sản phẩm bằng board profiler: gắn thermocouple, đo peak/TAL/ramp, so spec paste. " + SIM_TAG,
    stationCode: null,
    steps: [
      { text: "Chuẩn bị máy profiler (KIC/Datapaq); gắn tối thiểu 3 thermocouple lên board mẫu tại các điểm khối nhiệt lớn/nhỏ." },
      { text: "Chọn đúng profile recipe cho sản phẩm/loại kem thiếc; quét mã recipe để xác thực.", confirm: true, scan: "RFL-PBF-01" },
      { text: "Cho board profiler chạy qua lò ở tốc độ băng tải sản xuất; thu thập dữ liệu nhiệt full-pass.", confirm: true },
      { text: "Đánh giá peak temp (235–245°C), TAL (60–90s trên 217°C), ramp-rate (≤3°C/s). Xác nhận nằm trong cửa sổ.\n- [ ] Peak đạt\n- [ ] TAL đạt\n- [ ] Ramp đạt", confirm: true },
      { text: "So sánh với cửa sổ quy trình của nhà cung cấp kem thiếc; xác nhận đạt toàn bộ zone.", confirm: true },
      { text: "Lưu profile đã đo kèm chữ ký kỹ sư quá trình; đính vào hồ sơ sản phẩm." },
    ],
  },
  {
    code: `${SIM_CODE_PREFIX}ESD-CHECK`,
    title: "Kiểm tra trạm ESD đầu ca (ESD workstation check)",
    description: "Kiểm tra tiếp địa và kiểm soát tĩnh điện tại trạm thao tác tay đầu ca: dây đeo cổ tay, thảm, ionizer. " + SIM_TAG,
    stationCode: "SIM-L1-ASSY-ST",
    steps: [
      { text: "Đeo dây đeo cổ tay ESD và đo bằng thiết bị kiểm tra: điện trở trong dải 0.8–1.2 MΩ.", confirm: true },
      { text: "Kiểm tra thảm bàn và thảm sàn nối đất; điện trở điểm-tới-đất < 1×10⁹ Ω.\n- [ ] Thảm bàn OK\n- [ ] Thảm sàn OK", confirm: true },
      { text: "Kiểm ionizer đang bật và cân bằng ion trong ±50V; vệ sinh đầu phát nếu cần.", confirm: true },
      { text: "Ghi nhận kết quả tự kiểm ESD của ca vào máy đọc; quét thẻ kết quả kiểm định ngày.", confirm: true, scan: "ESD-PASS-DAILY" },
      { text: "Dán nhật ký kiểm ESD ca lên bảng trạm và thông báo giám sát nếu có hạng mục FAIL." },
    ],
  },
  {
    code: `${SIM_CODE_PREFIX}FAI`,
    title: "Kiểm tra sản phẩm đầu (First-article inspection)",
    description: "Kiểm tra sản phẩm đầu sau changeover trước khi release loạt: đối chiếu BOM, đo kích thước control-plan, kiểm mối hàn IPC-A-610. " + SIM_TAG,
    stationCode: "SIM-L1-AOI-ST",
    steps: [
      { text: "Lấy board đầu tiên chạy ra sau changeover; ghi thời gian và người thực hiện FAI." },
      { text: "Quét serial/lot in trên board và đối chiếu đúng mã sản phẩm của work order.", confirm: true },
      { text: "Đo các kích thước quan trọng theo control-plan bằng thước cặp/kính đo; xác nhận trong dung sai.", confirm: true },
      { text: "Kiểm mối hàn dưới kính hiển vi theo IPC-A-610 Class 2 (cầu chì, thiếu thiếc, tombstone).\n- [ ] Không cầu thiếc\n- [ ] Đủ thiếc chân\n- [ ] Không tombstone", confirm: true },
      { text: "Kiểm phân cực và marking của linh kiện phân cực (diode, tụ hoá, IC pin-1).", confirm: true },
      { text: "Dán tem FAI, kỹ sư/QA ký duyệt; xác nhận release chính thức cho sản xuất loạt.", confirm: true },
    ],
  },
];

// SOP sẽ được chạy phiên thực thi đầu-cuối (nhiều loại bước: info + confirm + scan-gate).
const RUN_SOP_CODE = `${SIM_CODE_PREFIX}AOI-DAILYCAL`;

// ═══════════════════════════════════════════════════════════════════════════
// PURGE — xoá dữ-liệu e-SOP mang nhãn SIM (executions → steps → sops; tôn trọng FK
// RESTRICT trên sop_executions.sop_id).
// ═══════════════════════════════════════════════════════════════════════════
async function purgeSim() {
  const ex = await sql`DELETE FROM sop_executions WHERE sop_id IN (SELECT id FROM sops WHERE code LIKE ${SIM_CODE_PREFIX + "%"})`;
  add("sop_executions(-)", ex.count || 0);
  const stp = await sql`DELETE FROM sop_steps WHERE sop_id IN (SELECT id FROM sops WHERE code LIKE ${SIM_CODE_PREFIX + "%"})`;
  add("sop_steps(-)", stp.count || 0);
  const sp = await sql`DELETE FROM sops WHERE code LIKE ${SIM_CODE_PREFIX + "%"}`;
  add("sops(-)", sp.count || 0);
}

async function counts() {
  const c = async (t) => (await sql`SELECT count(*)::int AS n FROM ${sql(t)}`)[0].n;
  return { sops: await c("sops"), sop_steps: await c("sop_steps"), sop_executions: await c("sop_executions") };
}

async function resolveIds() {
  const one = async (q) => (await q)[0] ?? null;
  const author =
    (await one(sql`SELECT id, username FROM users WHERE username = 'engineer1' AND "isActive" = true LIMIT 1`)) ||
    (await one(sql`SELECT id, username FROM users WHERE role = 'admin' AND "isActive" = true ORDER BY id LIMIT 1`)) ||
    (await one(sql`SELECT id, username FROM users ORDER BY id LIMIT 1`));
  const operator =
    (await one(sql`SELECT id, username FROM users WHERE username = 'operator1' AND role = 'operator' AND "isActive" = true LIMIT 1`)) ||
    (await one(sql`SELECT id, username FROM users WHERE role = 'operator' AND "isActive" = true ORDER BY id LIMIT 1`));
  const line = await one(sql`SELECT id, code FROM production_lines WHERE code = 'SIM-L1' LIMIT 1`);
  return { author, operator, line };
}

async function stationIdByCode(code) {
  if (!code) return null;
  const [row] = await sql`SELECT id FROM stations WHERE code = ${code} LIMIT 1`;
  return row?.id ?? null;
}

async function productIdByCode(code) {
  if (!code) return null;
  const [row] = await sql`SELECT id FROM product_models WHERE code = ${code} LIMIT 1`;
  return row?.id ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  const before = await counts();
  console.log(`[sim/esop] counts trước: sops=${before.sops} sop_steps=${before.sop_steps} sop_executions=${before.sop_executions}`);

  // Idempotent: luôn purge nhãn SIM trước.
  await purgeSim();
  console.log(`[sim/esop] purge SIM: -${tally["sops(-)"] || 0} sops, -${tally["sop_steps(-)"] || 0} steps, -${tally["sop_executions(-)"] || 0} executions`);
  if (PURGE_ONLY) {
    const after = await counts();
    console.log(`\n[sim/esop] PURGE-ONLY xong. counts sau: sops=${after.sops} sop_steps=${after.sop_steps} sop_executions=${after.sop_executions}`);
    return;
  }

  const { author, operator, line } = await resolveIds();
  console.log(`[sim/esop] author=${author ? `#${author.id} ${author.username}` : "null"} · operator=${operator ? `#${operator.id} ${operator.username}` : "null"} · line=${line ? `#${line.id} ${line.code}` : "null"}`);

  // ── Tạo SOP qua service THẬT: createSop (draft) → setSopStatus('active') ──────
  const createdSops = [];
  for (const def of SOP_DEFS) {
    const stationId = await stationIdByCode(def.stationCode);
    const productModelId = await productIdByCode(def.productCode);
    const steps = def.steps.map((s, i) => ({
      stepNo: i + 1,
      text: s.text,
      requiresConfirm: !!s.confirm || !!s.scan,
      expectedInput: s.scan ?? null,
      mediaRef: null,
    }));
    // Tạo bản nháp qua service (versioning + chèn bước thật).
    const draft = await svc.createSop({
      code: def.code,
      title: def.title,
      description: def.description,
      productModelId,
      stationId,
      version: 1,
      status: "draft",
      steps,
      createdBy: author?.id ?? null,
    });
    // Phát hành: draft → active (đúng chuyển-trạng-thái publish, tự retire bản cũ cùng code).
    const activated = await svc.setSopStatus(draft.id, "active");
    createdSops.push({
      id: draft.id, code: def.code, title: def.title, version: draft.version,
      status: activated?.status ?? "?", stepCount: steps.length, stationId, productModelId,
      requiredCount: steps.filter((s) => s.requiresConfirm).length,
      scanCount: steps.filter((s) => s.expectedInput).length,
    });
    add("sops(+)", 1);
    add("sop_steps(+)", steps.length);
  }

  console.log("\n[sim/esop] SOP đã tạo & kích hoạt (active):");
  for (const s of createdSops) {
    console.log(`  #${s.id} ${s.code} v${s.version} [${s.status}] — ${s.stepCount} bước (${s.requiredCount} bắt buộc, ${s.scanCount} cổng-quét)${s.stationId ? ` · station#${s.stationId}` : ""}`);
    console.log(`        "${s.title}"`);
  }

  if (NO_RUN) {
    const after = await counts();
    console.log(`\n[sim/esop] --no-run: bỏ qua phiên thực thi. counts sau: sops=${after.sops} sop_steps=${after.sop_steps} sop_executions=${after.sop_executions}`);
    return;
  }

  // ── CHẠY 1 PHIÊN THỰC THI ĐẦU-CUỐI qua service THẬT ───────────────────────────
  const runSop = createdSops.find((s) => s.code === RUN_SOP_CODE) ?? createdSops[0];
  const full = await svc.getSop(runSop.id); // lấy bước thật (đã sắp thứ tự) để quét
  const opId = operator?.id ?? null;
  const unitSerial = `SIM-ESOP-AOICAL-${new Date().toISOString().slice(0, 10)}`;

  console.log(`\n[sim/esop] ══ PHIÊN THỰC THI ĐẦU-CUỐI (state-machine THẬT) ══`);
  console.log(`[sim/esop] SOP: #${runSop.id} ${runSop.code} v${runSop.version} — "${runSop.title}"`);
  console.log(`[sim/esop] operator=${opId ? `#${opId} ${operator.username}` : "null"} · station#${runSop.stationId ?? "-"} · line#${line?.id ?? "-"} · unit="${unitSerial}"`);

  // 1) start
  const exec = await svc.startExecution({
    sopId: runSop.id,
    unitSerial,
    lineId: line?.id ?? null,
    stationId: runSop.stationId ?? null,
    operatorId: opId,
  });
  add("sop_executions(+)", 1);
  console.log(`  ▶ startExecution → execution #${exec.id} status=${exec.status}`);

  // 2) proof: finish khi chưa xác nhận → phải INCOMPLETE (cổng finish thật).
  const preFinish = await svc.finishExecution(exec.id);
  console.log(`  🔒 finish sớm (chưa đủ bước) → ok=${preFinish.ok} code=${preFinish.code} (đúng: cổng chặn)`);

  // 3) confirm từng bước theo thứ tự (info + confirm + scan-gate).
  const steps = [...full.steps].sort((a, b) => a.stepNo - b.stepNo);
  for (const st of steps) {
    if (st.expectedInput) {
      // proof: quét SAI trước → phải INPUT_MISMATCH (cổng-quét thật, không phải dấu cao su).
      const wrong = await svc.confirmStep(exec.id, st.stepNo, "CAL-WRONG-999", opId);
      console.log(`  ✗ bước ${st.stepNo} quét SAI "CAL-WRONG-999" → ok=${wrong.ok} code=${wrong.code} (đúng: từ chối)`);
      // quét ĐÚNG.
      const ok = await svc.confirmStep(exec.id, st.stepNo, st.expectedInput, opId);
      console.log(`  ✓ bước ${st.stepNo} quét ĐÚNG "${st.expectedInput}" → ok=${ok.ok} code=${ok.code} · bắt-buộc đã thỏa ${ok.progress?.satisfiedRequired}/${ok.progress?.requiredSteps}`);
    } else {
      const kind = st.requiresConfirm ? "confirm" : "info  ";
      const r = await svc.confirmStep(exec.id, st.stepNo, null, opId);
      console.log(`  ✓ bước ${st.stepNo} (${kind}) → ok=${r.ok} code=${r.code} · bắt-buộc đã thỏa ${r.progress?.satisfiedRequired}/${r.progress?.requiredSteps}`);
    }
  }

  // 4) finish (giờ đủ điều kiện) → completed.
  const done = await svc.finishExecution(exec.id);
  console.log(`  ⏹ finishExecution → ok=${done.ok} code=${done.code} status=${done.execution?.status} finishedAt=${done.execution?.finishedAt ? new Date(done.execution.finishedAt).toISOString() : "null"}`);

  // 5) đọc lại phiên (fresh) để chốt hồ sơ.
  const finalExec = await svc.getExecution(exec.id);
  const confs = finalExec?.stepConfirmations ?? [];
  console.log(`\n[sim/esop] Hồ sơ phiên #${exec.id}: status=${finalExec?.status} · ${confs.length} xác-nhận-bước ghi vào genealogy con người · complete=${finalExec?.progress?.complete}`);
  console.log(`[sim/esop] step_confirmations: ${confs.map((c) => `#${c.stepNo}${c.input ? `(${c.input})` : ""}@${new Date(c.confirmedAt).toISOString().slice(11, 19)}`).join("  ")}`);

  return { execId: exec.id, runSop, finalStatus: finalExec?.status, confCount: confs.length };
}

// ── run ────────────────────────────────────────────────────────────────────────
let exitCode = 0;
let result = null;
try {
  result = await main();
} catch (e) {
  exitCode = 1;
  console.error("\n[sim/esop] LỖI:", e?.stack || e?.message || e);
} finally {
  const after = await counts().catch(() => null);
  console.log("\n[sim/esop] ── TALLY ──");
  for (const [k, v] of Object.entries(tally)) console.log(`  ${k}: ${v}`);
  if (after) console.log(`[sim/esop] counts DB (toàn bộ, gồm cả không-SIM): sops=${after.sops} sop_steps=${after.sop_steps} sop_executions=${after.sop_executions}`);
  if (result?.execId) console.log(`[sim/esop] ✅ Phiên đầu-cuối #${result.execId} (${result.runSop.code}) → ${result.finalStatus}, ${result.confCount} bước xác nhận.`);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(exitCode);
}
