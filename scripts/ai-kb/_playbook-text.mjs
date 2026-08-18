/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * G4-B nhiệm vụ 1 — LÀM PHẲNG PLAYBOOK `.yaml` THÀNH VĂN BẢN CHO KHO TRI THỨC.
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ⚠ VÌ SAO CÓ FILE NÀY: `knowledge/workflows/*.playbook.yaml` là **6 quy trình ứng cứu sự cố do
 * người soạn** (NG burst · xử lý NG · rà soát SPC critical · lắp máy mới · đổi recipe · tạo điểm
 * đo) — nội dung giá trị nhất của cả kho cho câu hỏi "đang hỏng thì làm gì". Chúng có **0 chunk**:
 * `collectMarkdownFiles()` trong `build-knowledge-chunks.mjs` chỉ nhận đuôi `.md`, nên toàn bộ
 * nhóm này **vô hình với trợ lý** kể từ khi được viết ra.
 *
 * Tách khỏi `build-knowledge-chunks.mjs` để test được: file kia gọi `run()` ngay khi nạp module,
 * nên `import` nó trong một test là chạy nguyên đợt dựng kho.
 *
 * ── QUYẾT ĐỊNH: MỖI NGÔN NGỮ MỘT CHUNK RIÊNG, KHÔNG TRỘN ───────────────────────────────────────
 * Playbook là tam ngữ (vi/en/zh). Nhét cả ba vào một chunk thì vector nhúng bị **pha loãng** — một
 * đoạn nửa Việt nửa Anh không nằm gần truy vấn thuần Việt lẫn truy vấn thuần Anh. Vì vậy: một chunk
 * VI và một chunk EN cho mỗi playbook (zh chỉ giữ ở dòng tiêu đề làm mỏ neo, vì kho không có ca
 * tiếng Trung và không đáng trả thêm chi phí nhúng).
 */

/** Lấy chuỗi theo ngôn ngữ từ ô đa ngữ `{vi,en,zh}`; suy biến về `vi` rồi `en` rồi chuỗi trần. */
export function pickLang(node, lang) {
  if (node == null) return null;
  if (typeof node === "string") return node;
  if (typeof node !== "object") return null;
  return node[lang] ?? node.vi ?? node.en ?? null;
}

const STEP_LABEL = {
  vi: {
    guidance: "hướng dẫn",
    navigate: "mở màn hình",
    branch: "phân nhánh — chọn tình huống",
    tool: "gọi công cụ",
    prefill: "điền sẵn biểu mẫu",
    confirm: "chốt lại",
  },
  en: {
    guidance: "guidance",
    navigate: "open screen",
    branch: "branch — pick the situation",
    tool: "call tool",
    prefill: "prefill form",
    confirm: "wrap up",
  },
};

const HEAD = {
  vi: {
    kind: "Quy trình ứng cứu (playbook) do người soạn",
    when: "Khi nào dùng",
    group: "Nhóm",
    perm: "Quyền yêu cầu",
    steps: "Các bước thực hiện",
    screens: "Màn hình liên quan",
    none: "không yêu cầu quyền đặc biệt",
  },
  en: {
    kind: "Authored incident-response playbook",
    when: "When to use",
    group: "Category",
    perm: "Required permission",
    steps: "Steps",
    screens: "Related screens",
    none: "no special permission required",
  },
};

/**
 * Làm phẳng MỘT playbook đã parse thành văn bản một ngôn ngữ.
 * Trả `null` khi playbook không có bước nào đọc được ở ngôn ngữ ấy — người gọi bỏ qua, KHÔNG sinh
 * ra một chunk rỗng (một chunk rỗng vẫn tốn một vector và vẫn cạnh tranh thứ hạng).
 */
export function playbookToText(pb, lang = "vi") {
  if (!pb || typeof pb !== "object") return null;
  const L = HEAD[lang] ?? HEAD.vi;
  const labels = STEP_LABEL[lang] ?? STEP_LABEL.vi;

  const titleL = pickLang(pb.title, lang);
  if (!titleL) return null;

  const steps = Array.isArray(pb.steps) ? pb.steps : [];
  const stepLines = [];
  const routes = [];
  let n = 0;
  for (const s of steps) {
    if (!s || typeof s !== "object") continue;
    const body = pickLang(s.text, lang);
    if (!body) continue;
    n += 1;
    const kind = labels[s.type] ?? s.type ?? "";
    const where = s.route ? ` \`${s.route}\`` : "";
    if (s.route) routes.push(s.route);
    stepLines.push(`${n}. [${kind}${where}] ${body}`);

    // Nhánh rẽ là NỘI DUNG CHẨN ĐOÁN (lỗi giả vs lỗi thật…), không phải siêu dữ liệu —
    // bỏ nó đi là bỏ đúng phần trả lời "nguyên nhân thường gặp".
    if (Array.isArray(s.branch)) {
      for (const b of s.branch) {
        const bt = pickLang(b?.text, lang);
        if (bt) stepLines.push(`   - (${b?.key ?? "?"}) ${bt}`);
      }
    }
    if (s.tool) stepLines.push(`   → công cụ: \`${s.tool}\``);
  }
  if (stepLines.length === 0) return null;

  const perm =
    pb.requiredPermission && pb.requiredPermission.module
      ? `\`${pb.requiredPermission.module}\` / \`${pb.requiredPermission.action ?? "canView"}\``
      : L.none;

  // Mỏ neo đa ngữ: tiêu đề ở cả ba thứ tiếng nằm trên MỌI chunk, nên một truy vấn tiếng Anh/Trung
  // vẫn chạm được chunk VI qua tiêu đề dù thân bài là tiếng Việt.
  const titles = ["vi", "en", "zh"]
    .map((k) => (pb.title && pb.title[k] ? `${k}: ${pb.title[k]}` : null))
    .filter(Boolean)
    .join(" | ");

  return [
    `${L.kind}: ${titleL}`,
    `ID: ${pb.id ?? "?"} | ${L.group}: ${pb.category ?? "?"} | ${L.perm}: ${perm}`,
    titles ? `(${titles})` : null,
    "",
    `${L.steps}:`,
    ...stepLines,
    routes.length ? `\n${L.screens}: ${[...new Set(routes)].join(", ")}` : null,
  ]
    .filter((x) => x !== null)
    .join("\n");
}

/** Tiêu đề chunk. Giữ tiếng Việt vì đó là ngôn ngữ người vận hành. */
export function playbookTitle(pb, lang = "vi") {
  const t = pickLang(pb?.title, lang) ?? pb?.id ?? "playbook";
  return lang === "vi" ? `Playbook: ${t}` : `Playbook (${lang}): ${t}`;
}
