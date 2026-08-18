// G4-B nhiệm vụ 1 + 3 · G4-C — canh việc INDEX PLAYBOOK, canh RANH GIỚI NHÁP ↔ ĐÃ DUYỆT.
//
// Ba thứ được canh ở đây trả lời ba câu hỏi khác nhau:
//   1. 6 playbook `.yaml` có THẬT SỰ vào kho không (trước G4-B: 0 chunk, vì chunker chỉ đi `.md`),
//      và văn bản sinh ra có mang phần "các bước" + nhánh chẩn đoán không — chứ không phải chỉ
//      mang tiêu đề rỗng ruột.
//   2. ⚠⚠ Thư mục NHÁP (`knowledge/drafts/**`) **KHÔNG** được lọt vào chỉ mục.
//   3. ★ G4-C — thẻ ĐÃ DUYỆT (`knowledge/operational-approved/**`) **PHẢI** có mặt trong chỉ mục,
//      và **không** thẻ nào trong chỉ mục còn tự khai `trang_thai: nhap`.
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★ G4-C — VÌ SAO NỬA (3) PHẢI TỒN TẠI, VÀ VÌ SAO KHÔNG ĐƯỢC CHỈ SỬA NỬA (2).
// ══════════════════════════════════════════════════════════════════════════════════════════════
// Bản G4-B của cổng này khẳng định: "phải CÓ nháp trên đĩa, nếu không cổng xanh RỖNG" —
//     assert.ok(draftFiles.length > 0, "knowledge/drafts rỗng — cổng này sẽ xanh RỖNG");
// Điều kiện tiên quyết ấy ĐÚNG khi 20 thẻ còn nằm ở nháp. Sau khi chủ dự án duyệt (2026-08-17) và
// 20 thẻ được CHUYỂN sang `knowledge/operational-approved/`, thư mục nháp còn đúng một `_README.md`
// — và dòng khẳng định trên biến thành **cổng đỏ vì việc đã làm ĐÚNG**.
//
// ⚠⚠ Cách sửa SAI (và là cách hấp dẫn nhất): xoá dòng ấy đi. Làm thế thì cổng vẫn "xanh", nhưng nó
//   không còn canh gì cả: một thư mục nháp rỗng + một chỉ mục rỗng thẻ duyệt sẽ xanh y hệt một hệ
//   chạy đúng. Đó chính là lớp lỗi "glob rỗng ⇒ cổng khai xanh" mà repo này đã dính nhiều lần.
//
// ⇒ Điều kiện tiên quyết được **DỜI**, không **XOÁ**: nửa "cấm" (drafts ⇒ 0 chunk) nay được phép
//   vacuous, còn nửa **KHẲNG ĐỊNH** (approved ⇒ có mặt ĐỦ trong chỉ mục, đúng sourceType, đủ số
//   file) gánh vai trò "phải có gì đó thật để đo". Cổng nay phát biểu:
//
//       "Thư mục nháp CÓ THỂ rỗng. Nhưng MỌI thẻ đã duyệt PHẢI có mặt trong chỉ mục,
//        và KHÔNG chunk nào trong chỉ mục được mang trang_thai: nhap."
//
// Ba đột biến phải làm cổng ĐỎ (đã nghiệm thu G4-C): gỡ một thẻ khỏi chỉ mục · làm nửa khẳng định
// vacuous (dọn rỗng operational-approved) · đưa thẻ vào chỉ mục mà vẫn để `trang_thai: nhap`.
//
// Chạy: node scripts/ai-kb/buildPlaybookChunks.test.mjs
// (Không thuộc bộ vitest — vitest.config.ts chỉ glob *.test.ts; đây là test chạy SCRIPT dựng kho
// thật qua child_process, theo đúng lệ của scripts/ai-kb/*.test.mjs.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { playbookToText, playbookTitle, pickLang } from "./_playbook-text.mjs";

const ROOT = process.cwd();
const CHUNKS_FILE = path.join(ROOT, "knowledge", "chunks.jsonl");
const WORKFLOWS_DIR = path.join(ROOT, "knowledge", "workflows");
const DRAFTS_DIR = path.join(ROOT, "knowledge", "drafts");
const APPROVED_DIR = path.join(ROOT, "knowledge", "operational-approved");
const APPROVED_PREFIX = "knowledge/operational-approved/";
const CHUNKER = path.join(ROOT, "scripts", "ai-kb", "build-knowledge-chunks.mjs");

const normPath = (p) => String(p).replace(/\\/g, "/");
/** `trang_thai` khai trong front-matter, hoặc null nếu không có front-matter. */
function trangThaiOf(fileText) {
  const fm = fileText.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const m = fm[1].match(/^trang_thai:\s*(\S+)\s*$/m);
  return m ? m[1] : null;
}

function readChunks() {
  return fs
    .readFileSync(CHUNKS_FILE, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}
function runChunker() {
  return execFileSync(process.execPath, [CHUNKER], { cwd: ROOT, encoding: "utf8" });
}

test("playbookToText: sinh được các BƯỚC, không phải chỉ tiêu đề", () => {
  const pb = parseYaml(
    fs.readFileSync(path.join(WORKFLOWS_DIR, "ng-burst-response.playbook.yaml"), "utf8"),
  );
  const vi = playbookToText(pb, "vi");
  assert.ok(vi, "không sinh được văn bản VI");
  assert.match(vi, /Các bước thực hiện:/);
  // Các bước phải được ĐÁNH SỐ — nếu chỉ nối text lại thì mất cấu trúc quy trình.
  assert.match(vi, /\n1\. \[/);
  assert.match(vi, /\n2\. \[/);
  // Bước navigate phải mang route để người đọc biết mở màn hình nào.
  assert.ok(vi.includes("/mqtt-alerts"), "thiếu route của bước navigate");
  assert.match(vi, /Màn hình liên quan:/);
  // ★ Nhánh rẽ là phần CHẨN ĐOÁN ("lỗi giả" vs "lỗi thật") — mất nó là mất đúng phần trả lời
  //   "nguyên nhân thường gặp".
  assert.ok(vi.includes("false_call"), "mất nhánh chẩn đoán false_call");
  assert.ok(vi.includes("real_defect"), "mất nhánh chẩn đoán real_defect");
  // Quyền yêu cầu phải hiện ra (người vận hành cần biết mình có làm được bước tool không).
  assert.ok(vi.includes("mqtt_alerts"), "thiếu quyền yêu cầu");
});

test("playbookToText: KHÔNG trộn ngôn ngữ trong một chunk", () => {
  const pb = parseYaml(
    fs.readFileSync(path.join(WORKFLOWS_DIR, "ng-burst-response.playbook.yaml"), "utf8"),
  );
  const vi = playbookToText(pb, "vi");
  const en = playbookToText(pb, "en");
  const viStepText = "Xác nhận hiện trạng";
  const enStepText = "Confirm the situation";
  assert.ok(vi.includes(viStepText));
  assert.ok(!vi.includes(enStepText), "thân bài VI lẫn câu tiếng Anh ⇒ vector bị pha loãng");
  assert.ok(en.includes(enStepText));
  assert.ok(!en.includes(viStepText), "thân bài EN lẫn câu tiếng Việt");
});

test("playbookToText: playbook méo KHÔNG ném, trả null", () => {
  assert.equal(playbookToText(null, "vi"), null);
  assert.equal(playbookToText({}, "vi"), null);
  assert.equal(playbookToText({ title: { vi: "x" }, steps: [] }, "vi"), null);
  // có title nhưng mọi bước thiếu text ⇒ vẫn null (không sinh chunk rỗng ruột)
  assert.equal(playbookToText({ title: { vi: "x" }, steps: [{ type: "guidance" }] }, "vi"), null);
  assert.equal(pickLang(undefined, "vi"), null);
});

test("★ chunker index ĐỦ 6 playbook, sourceType 'playbook', có cả VI lẫn EN", () => {
  runChunker();
  const chunks = readChunks();
  const pbChunks = chunks.filter((c) => c.sourceType === "playbook");

  const yamlFiles = fs.readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith(".playbook.yaml"));
  assert.ok(yamlFiles.length >= 6, `chỉ thấy ${yamlFiles.length} playbook trên đĩa`);
  assert.ok(pbChunks.length > 0, "★ HỒI QUY: 0 chunk playbook — chunker lại bỏ qua .yaml");

  // Mỗi file yaml phải có ít nhất một chunk.
  const covered = new Set(pbChunks.map((c) => c.sourcePath));
  for (const f of yamlFiles) {
    const rel = `knowledge/workflows/${f}`;
    assert.ok(covered.has(rel), `playbook không được index: ${rel}`);
  }
  // Mỗi playbook phải có cả chunk VI và chunk EN.
  for (const f of yamlFiles) {
    const rel = `knowledge/workflows/${f}`;
    const mine = pbChunks.filter((c) => c.sourcePath === rel);
    assert.ok(
      mine.some((c) => /^Playbook: /.test(c.title)),
      `thiếu chunk VI: ${rel}`,
    );
    assert.ok(
      mine.some((c) => /^Playbook \(en\): /.test(c.title)),
      `thiếu chunk EN: ${rel}`,
    );
  }
  // id duy nhất + hash có mặt (điều kiện để embed-incremental tái dùng đúng).
  const ids = new Set();
  for (const c of pbChunks) {
    assert.ok(!ids.has(c.id), `id playbook trùng: ${c.id}`);
    ids.add(c.id);
    assert.ok(typeof c.hash === "string" && c.hash.length === 64, `hash sai: ${c.id}`);
  }
});

test("⚠⚠ CỔNG NHÁP: knowledge/drafts/** KHÔNG BAO GIỜ vào chỉ mục (thư mục ĐƯỢC PHÉP rỗng)", () => {
  // ★ G4-C — điều kiện tiên quyết "phải CÓ nháp trên đĩa" đã được DỜI sang test khẳng định phía
  //   dưới. Ở đây nó không còn đúng: duyệt xong thì nháp rỗng là trạng thái MONG MUỐN.
  const draftFiles = fs.existsSync(DRAFTS_DIR)
    ? fs.readdirSync(DRAFTS_DIR, { recursive: true }).filter((f) => String(f).endsWith(".md"))
    : [];

  const chunks = readChunks();
  const leaked = chunks.filter((c) => normPath(c.sourcePath).includes("knowledge/drafts"));
  assert.equal(
    leaked.length,
    0,
    `★ ${leaked.length} chunk NHÁP lọt vào kho: ${leaked.slice(0, 3).map((c) => c.sourcePath).join(", ")}`,
  );

  // Nháp CÒN LẠI (nếu có) phải TỰ KHAI là nháp — để nếu có ngày ai đó chép nhầm sang thư mục được
  // index thì ít nhất người đọc còn thấy dòng trạng thái.
  for (const f of draftFiles) {
    const txt = fs.readFileSync(path.join(DRAFTS_DIR, String(f)), "utf8");
    assert.match(txt, /^---\r?\n[\s\S]*?trang_thai:\s*nhap/m, `nháp thiếu 'trang_thai: nhap': ${f}`);
  }
});

test("★★ G4-C CỔNG ĐÃ DUYỆT: mọi thẻ operational-approved PHẢI có mặt trong chỉ mục", () => {
  // ── Nửa KHẲNG ĐỊNH. Đây là chỗ gánh vai trò "có gì đó thật để đo" sau khi nửa cấm ở trên được
  //    phép vacuous. Nếu thư mục này rỗng thì KHÔNG phải "không có gì để canh" — mà là 20 thẻ chủ
  //    dự án đã duyệt vừa biến mất khỏi trợ lý.
  assert.ok(fs.existsSync(APPROVED_DIR), "★ không có knowledge/operational-approved — thẻ đã duyệt biến mất");
  const files = fs.readdirSync(APPROVED_DIR).filter((f) => f.endsWith(".md") && !f.startsWith("_"));
  assert.ok(files.length > 0, "★ knowledge/operational-approved RỖNG — không còn thẻ duyệt nào trong chỉ mục");

  const chunks = readChunks();
  const approvedChunks = chunks.filter((c) => normPath(c.sourcePath).startsWith(APPROVED_PREFIX));
  const covered = new Set(approvedChunks.map((c) => normPath(c.sourcePath)));

  // TỪNG file một — không dùng phép so tổng số, vì "20 chunk" có thể đến từ 10 file × 2 phần và
  // vẫn để 10 thẻ vô hình.
  for (const f of files) {
    assert.ok(
      covered.has(`${APPROVED_PREFIX}${f}`),
      `★ thẻ ĐÃ DUYỆT không vào được chỉ mục: ${APPROVED_PREFIX}${f} — chunker có còn quét thư mục này không?`,
    );
  }
  assert.equal(
    covered.size,
    files.length,
    `★ ${files.length} thẻ trên đĩa nhưng ${covered.size} thẻ trong chỉ mục`,
  );

  // sourceType phải là "operational" — đó là điều kiện để SOURCE_TYPE_WEIGHTS (1,15) và đường
  // deep-link của aiOperationalGrounding áp lên chúng. Rơi về "domain"/mặc định là một hồi quy
  // ÂM THẦM: chunk vẫn có, chỉ là bị xếp thấp hơn.
  const wrongType = approvedChunks.filter((c) => c.sourceType !== "operational");
  assert.equal(
    wrongType.length,
    0,
    `★ ${wrongType.length} chunk thẻ duyệt sai sourceType: ${[...new Set(wrongType.map((c) => c.sourceType))].join(", ")}`,
  );

  // Mỗi thẻ phải mang dòng meta Route/Permission (bằng chứng nó đi qua ĐÚNG nhánh operational của
  // chunker, không phải nhánh markdown trần).
  for (const c of approvedChunks) {
    assert.match(c.text, /^Route: .+ \| Permission: .+ \| Role: /, `thiếu dòng meta: ${c.id}`);
  }
});

test("★★ G4-C: KHÔNG chunk nào trong chỉ mục đến từ file còn khai `trang_thai: nhap`", () => {
  // Đột biến bắt được ở đây: chép một bản nháp sang thư mục được quét mà QUÊN đổi trạng thái.
  // Không kiểm theo THƯ MỤC mà theo NỘI DUNG FILE — một file nháp đặt ở bất kỳ đâu trong đường
  // quét đều bị bắt, kể cả thư mục sau này mới thêm vào chunker.
  const chunks = readChunks();
  const mdSources = [...new Set(chunks.map((c) => normPath(c.sourcePath)))].filter((p) => p.endsWith(".md"));

  const viPham = [];
  for (const rel of mdSources) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue; // kho cũ hơn đĩa — không phải việc của cổng này
    if (trangThaiOf(fs.readFileSync(abs, "utf8")) === "nhap") viPham.push(rel);
  }
  assert.deepEqual(
    viPham,
    [],
    `★ ${viPham.length} file NHÁP đã vào chỉ mục: ${viPham.slice(0, 5).join(", ")}`,
  );

  // Và điều kiện tiên quyết của CHÍNH test này: phải thật sự có file khai `da_duyet` trong chỉ mục,
  // nếu không "không ai khai nhap" là một sự thật rỗng.
  const daDuyet = mdSources.filter((rel) => {
    const abs = path.join(ROOT, rel);
    return fs.existsSync(abs) && trangThaiOf(fs.readFileSync(abs, "utf8")) === "da_duyet";
  });
  assert.ok(
    daDuyet.length > 0,
    "★ chỉ mục không có file nào khai `trang_thai: da_duyet` — test này đang xanh RỖNG",
  );
});

test("playbookTitle: VI không mang hậu tố ngôn ngữ, EN thì có", () => {
  const pb = { id: "x", title: { vi: "Xử lý NG", en: "NG handling" } };
  assert.equal(playbookTitle(pb, "vi"), "Playbook: Xử lý NG");
  assert.equal(playbookTitle(pb, "en"), "Playbook (en): NG handling");
});
