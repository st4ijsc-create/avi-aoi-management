/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * G4-B nhiệm vụ 3 — SINH **BẢN NHÁP** THẺ VẬN HÀNH ĐỂ NGƯỜI DUYỆT.
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Chủ dự án đã chốt: *"AI đưa ra bản nháp và tôi duyệt"*. Script này sinh ra ĐÚNG một bản nháp —
 * không phải tri thức đã duyệt — cho 20 màn được chọn BẰNG DỮ LIỆU (xem `TOP20_TIEU_CHI`).
 *
 * ⚠⚠⚠ BA HÀNG RÀO, VÀ CHÚNG TỒN TẠI VÌ CÙNG MỘT LÝ DO:
 *   một bản nháp do AI sinh mà lọt vào kho rồi được trợ lý trích dẫn như sự thật đã duyệt là
 *   **đúng lớp lỗi tệ nhất** mà cả đợt này đang chống.
 *
 *   1. GHI RA `knowledge/drafts/operational/` — thư mục KHÔNG nằm trong bất kỳ đường quét nào của
 *      `build-knowledge-chunks.mjs` (chunker chỉ đi docs/, apidocs/, knowledge/{domain,features,
 *      operational,workflows}). Nháp vì thế **không có chunk, không có vector, không truy hồi được**.
 *   2. FRONT-MATTER `trang_thai: nhap` trên MỌI file — để nếu có ngày ai đó chép nhầm sang thư mục
 *      được index thì người đọc (và LLM) vẫn thấy dòng trạng thái ngay đầu tài liệu.
 *   3. MỘT CỔNG TEST (`buildPlaybookChunks.test.mjs` → "CỔNG NHÁP") khẳng định 0 chunk nào có
 *      sourcePath chứa `knowledge/drafts`, và nó **đỏ nếu thư mục nháp rỗng** — nên cổng không thể
 *      xanh một cách rỗng.
 *
 * ── SỰ THẬT ĐẾN TỪ ĐÂU ────────────────────────────────────────────────────────────────────────
 * Phần "đã xác minh" (route · quyền · vai trò · module · license · đường menu · router + số thủ
 * tục + TÊN thủ tục) đọc từ `knowledge/operational-cards.json` và từ chính file router — tức từ
 * MÃ THẬT, không phải trí nhớ. Phần vận hành (triệu chứng/nguyên nhân/các bước) là nội dung soạn,
 * và mọi chỗ KHÔNG suy ra được từ repo đều để **ô trống có nhãn** `⬜ CẦN NGƯỜI ĐIỀN`.
 *
 * ⚠ Trống mà thành thật tốt hơn đầy mà bịa: script này **KHÔNG** được phép sinh ra một quy trình
 *   nhà máy (thời gian chờ, ngưỡng, ai ký duyệt, số điện thoại ca trực) — không thứ nào trong đó
 *   suy ra được từ mã nguồn.
 *
 * CHẠY:  node scripts/ai-kb/build-operational-drafts.mjs
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CARDS_INDEX = path.join(ROOT, "knowledge", "operational-cards.json");
const OUT_DIR = path.join(ROOT, "knowledge", "drafts", "operational");

/**
 * TIÊU CHÍ CHỌN 20 MÀN — công thức, không phải cảm giác. Điểm = tổng bốn tín hiệu ĐO ĐƯỢC:
 *   ca×3    số ca trong bộ eval vận hành (54 ca) có expectPaths trỏ ĐÚNG thẻ này
 *   gold×1,5 số câu trong knowledge/rag-eval-goldenset.json (151 câu) thuộc miền khớp thẻ này
 *   sàn×2   thẻ nằm trong nhóm menu hướng sàn nhà máy (overview/production/quality/devices)
 *   +1 mỗi cái: có trong sidebar · module CORE (luôn có license) · không giới hạn theo vai trò
 *   +min(3, số thủ tục router/15)  — bề mặt nghiệp vụ thật sau màn hình
 *
 * ⚠ Hai tín hiệu đầu là "người thật hỏi gì" (bộ ca do người viết), hai tín hiệu sau là "ai với
 *   tới được màn này". Không tín hiệu nào là log truy cập thật — repo KHÔNG có log ấy; đây là
 *   PROXY và phải đọc như proxy.
 */
export const TOP20_TIEU_CHI =
  "ca×3 + gold×1,5 + sàn×2 + sidebar + CORE + mở-vai-trò + min(3, thủtục/15)";

/** 20 slug do công thức trên xếp hạng (xem báo cáo G4-B để có bảng điểm đầy đủ). */
const TOP20 = [
  "production-orders", "ai-inspection-analytics", "andon", "oee-dashboard", "users",
  "alerts", "traceability", "machine-registration", "products", "programming-copilot",
  "device-adapters", "api-keys", "audit-logs", "master-data", "edge-nodes",
  "maintenance-hub", "work-orders", "defect-catalog", "anomaly-banks", "carbon-dashboard",
];

const BLANK = (what) => `⬜ **CẦN NGƯỜI ĐIỀN** — ${what}`;

/**
 * Nội dung vận hành SOẠN cho từng màn. Chỉ những câu suy ra được từ mã/tài liệu trong repo mới
 * được viết thành khẳng định; phần còn lại là ô trống có nhãn.
 *
 * `dau` = triệu chứng người dùng gặp · `vi` = nguyên nhân thường gặp · `buoc` = các bước xử lý ·
 * `xac` = cách xác nhận đã xong.
 */
const SOAN = {
  "production-orders": {
    dau: [
      "Đơn hàng vừa tạo không xuất hiện trong danh sách.",
      "Không bấm được **Bắt đầu** cho lô ở line đang rảnh.",
      "Số WIP trên màn hình không khớp với đếm tay tại line.",
      "Tạo đơn báo trùng lịch với một đơn khác trên cùng line.",
    ],
    vi: [
      "Thiếu quyền `production_orders` ⇒ danh sách trả về rỗng thay vì báo lỗi.",
      "Module `MOD_PRODUCTION` không nằm trong license đang cài ⇒ toàn bộ route bị chặn.",
      "Đơn đang ở trạng thái `planned` nhưng gán sai `lineId`, nên line hiện tại không thấy nó.",
      "Lịch chồng nhau — hệ thống có kiểm tra riêng cho việc này (thủ tục `checkScheduleOverlap`).",
      "WIP lệch: `getWIPStatus`/`getWIPByLine` tính theo sản phẩm đã scan; hàng chưa scan không được đếm.",
    ],
    buoc: [
      "Mở `Menu › Sản xuất › Đơn hàng sản xuất` (`/production-orders`).",
      "Kiểm tra bộ lọc line/trạng thái trên thanh công cụ — danh sách mặc định có thể đang lọc.",
      "Nếu danh sách rỗng hoàn toàn: nhờ quản trị đối chiếu quyền `production_orders` cho tài khoản.",
      "Nếu trùng lịch: xem đơn đang chiếm khung giờ trên cùng line, dời `plannedStart` hoặc đổi line.",
      "Nếu WIP lệch: đối chiếu bằng `Menu › Sản xuất › Lịch sử` cho cùng khoảng thời gian trước khi kết luận là lỗi hệ thống.",
      BLANK("ai được phép dời lịch/huỷ đơn tại nhà máy này, và cần xác nhận của ai"),
    ],
    xac: [
      "Đơn hiện đúng trạng thái mong muốn trong danh sách sau khi F5.",
      "Vòng đời lô đi đúng `planned → running → completed` (xem `knowledge/domain/howto-lot-management.md`).",
      BLANK("ngưỡng sai lệch WIP bao nhiêu thì coi là bất thường tại nhà máy này"),
    ],
  },
  andon: {
    dau: [
      "Gọi Andon xong không ai tới, bảng TV không đổi.",
      "Cảnh báo Andon đã xử lý xong nhưng vẫn còn trên bảng.",
      "Bảng Andon trên TV đứng hình / không tự cập nhật.",
    ],
    vi: [
      "Andon có vòng đời ba nhịp — `raise` (gọi) → `acknowledge` (đã nhận) → `resolve` (đã xong). Dừng ở nhịp giữa thì cảnh báo vẫn còn hiện.",
      "Bảng TV lọc theo `active`; một mục đã `resolve` sẽ rời danh sách, còn mục mới `acknowledge` thì KHÔNG.",
      "Màn hình dùng quyền `dashboard_view` — tài khoản chỉ xem được, không bấm nhận được.",
      BLANK("kênh báo động thực tế (đèn/còi/điện thoại) có nối vào Andon của hệ thống không"),
    ],
    buoc: [
      "Mở `/andon`. Kiểm tra mục cần xử lý còn nằm ở danh sách đang hoạt động không.",
      "Người tiếp nhận bấm **Đã nhận** (`acknowledge`) — bước này chỉ ghi nhận, KHÔNG đóng cảnh báo.",
      "Sau khi xử lý xong tại line, bấm **Đã xử lý** (`resolve`) để cảnh báo rời bảng.",
      "Nếu bảng TV không đổi sau khi resolve: tải lại trang TV; nếu vẫn còn thì kiểm tra máy chạy TV có mất mạng không.",
      BLANK("thời gian phản hồi cam kết cho mỗi loại Andon tại nhà máy này"),
    ],
    xac: [
      "Mục đã xử lý không còn trong danh sách `active`.",
      "Chỉ số ở mục **metrics** ghi nhận lần xử lý vừa rồi.",
      BLANK("ai xác nhận cuối cùng rằng sự cố đã được khắc phục thật"),
    ],
  },
  alerts: {
    dau: [
      "Cảnh báo dồn dập hàng loạt cùng lúc (bão cảnh báo).",
      "Máy có vấn đề nhưng không thấy cảnh báo nào.",
      "Đã bấm xác nhận nhưng cảnh báo vẫn quay lại.",
    ],
    vi: [
      "Cảnh báo có bật/tắt theo từng loại — xem danh sách loại đang bật (`getEnabled`) trước khi kết luận là 'hệ thống không báo'.",
      "`acknowledge` chỉ đánh dấu ĐÃ ĐỌC; nếu điều kiện gây cảnh báo vẫn còn thì cảnh báo sẽ phát lại.",
      "Ngưỡng đặt quá nhạy ⇒ mỗi dao động nhỏ thành một cảnh báo. Ngưỡng nằm ở màn hình cấu hình ngưỡng, không ở đây.",
      "Màn hình dùng quyền `machine_status`.",
    ],
    buoc: [
      "Mở `/alerts`, lọc theo máy và theo loại để xem cảnh báo có tập trung vào một nguồn không.",
      "Xem lịch sử (`history`) của đúng loại đó để biết nó mới phát sinh hay đã lặp lại lâu nay.",
      "Nếu là bão từ MỘT máy: xử lý máy đó trước, đừng xác nhận hàng loạt — xác nhận hàng loạt xoá mất dấu vết điều tra.",
      "Nếu là ngưỡng quá nhạy: chuyển sang màn hình cấu hình ngưỡng để chỉnh, ghi lý do.",
      BLANK("ai có quyền chỉnh ngưỡng cảnh báo và cần duyệt của ai"),
    ],
    xac: [
      "Sau khi xử lý nguồn, cảnh báo cùng loại không phát lại trong khoảng theo dõi.",
      BLANK("khoảng theo dõi bao lâu thì coi là đã ổn định tại nhà máy này"),
    ],
  },
  users: {
    dau: [
      "Người dùng mới không đăng nhập được.",
      "Đổi vai trò rồi nhưng người dùng vẫn không thấy menu mới.",
      "Người dùng mất thiết bị 2FA, không vào được.",
      "Nghi ngờ tài khoản bị dùng trái phép.",
    ],
    vi: [
      "Vai trò được nạp lúc đăng nhập — đổi vai trò xong người dùng phải đăng xuất/đăng nhập lại.",
      "Menu còn phụ thuộc license của module, không chỉ vai trò: đủ quyền nhưng module không có license thì vẫn không thấy.",
      "2FA có bộ mã dự phòng (`getBackupCodesStatus`) — kiểm tra trước khi tính tới việc gỡ 2FA.",
      "Màn hình cần quyền `admin_users`.",
    ],
    buoc: [
      "Mở `/users`, tìm tài khoản, đối chiếu vai trò hiện tại.",
      "Đổi vai trò nếu cần (`updateRole`), rồi yêu cầu người dùng đăng xuất và đăng nhập lại.",
      "Mất 2FA: kiểm tra trạng thái mã dự phòng trước; chỉ gỡ 2FA (`disable2FA`) khi đã xác minh danh tính người dùng.",
      "Nghi ngờ chiếm dụng: xem phiên đang mở (`getSessions`) và thu hồi phiên lạ (`revokeSession`), hoặc thu hồi tất cả (`revokeAllSessions`).",
      BLANK("thủ tục xác minh danh tính trước khi gỡ 2FA tại tổ chức này (ai xác nhận, ghi ở đâu)"),
    ],
    xac: [
      "Người dùng đăng nhập lại và thấy đúng các mục menu của vai trò mới.",
      "Danh sách phiên chỉ còn phiên hợp lệ.",
      "Thao tác thay đổi vai trò/2FA có vết trong nhật ký kiểm toán (`/audit-logs`).",
    ],
  },
  "defect-catalog": {
    dau: [
      "Loại lỗi cần dùng không có trong danh sách khi phân loại NG.",
      "Cùng một lỗi bị ghi bằng hai tên khác nhau, báo cáo Pareto bị chia đôi.",
    ],
    vi: [
      "Danh mục lỗi là dữ liệu chủ dùng chung — thêm/sửa ở đây ảnh hưởng mọi báo cáo về sau.",
      "Trùng tên do nhập tay ở hai thời điểm; báo cáo nhóm theo mã lỗi nên hai mã khác nhau không gộp được.",
      "Màn hình đọc theo quyền `history_view`.",
    ],
    buoc: [
      "Mở `/defect-catalog`, tìm theo cả tên tiếng Việt lẫn mã trước khi tạo mới — tránh đẻ thêm bản trùng.",
      "Nếu đã trùng: thống nhất một mã chuẩn, ghi lại mã bị loại, rồi xử lý dữ liệu cũ.",
      BLANK("cách xử lý dữ liệu lịch sử đã gắn mã lỗi bị loại — gộp hay giữ nguyên (cần chốt với QA)"),
      BLANK("ai được thêm/sửa danh mục lỗi và quy trình duyệt"),
    ],
    xac: [
      "Phân loại NG tại line chọn được đúng loại lỗi cần dùng.",
      "Báo cáo Pareto không còn hai dòng cho cùng một hiện tượng.",
    ],
  },
  "api-keys": {
    dau: [
      "Máy/hệ thống ngoài gọi API bị từ chối.",
      "Không rõ khoá nào đang được dùng bởi thiết bị nào.",
    ],
    vi: [
      "Khoá hết hạn hoặc đã bị thu hồi.",
      "Khoá đúng nhưng thiếu phạm vi quyền cho endpoint đang gọi.",
      "Màn hình cần quyền `admin_system`.",
    ],
    buoc: [
      "Mở `/api-keys`, đối chiếu khoá mà thiết bị đang dùng với danh sách còn hiệu lực.",
      "Cấp khoá mới nếu cần và cập nhật vào cấu hình thiết bị; thu hồi khoá cũ SAU khi thiết bị đã chạy bằng khoá mới.",
      BLANK("chu kỳ xoay khoá bắt buộc tại tổ chức này"),
      BLANK("sổ đăng ký khoá ↔ thiết bị được giữ ở đâu"),
    ],
    xac: [
      "Thiết bị gọi API thành công bằng khoá mới.",
      "Khoá cũ đã thu hồi và không còn lần gọi nào dùng nó.",
    ],
  },
};

/** Trích tên thủ tục thật từ file router (nguồn: MÃ, không phải trí nhớ). */
function procedureNames(routerFile) {
  const abs = path.join(ROOT, routerFile);
  if (!fs.existsSync(abs)) return [];
  const src = fs.readFileSync(abs, "utf8");
  const names = [];
  const re = /^\s+([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*(?:protectedProcedure|publicProcedure)/gm;
  let m;
  while ((m = re.exec(src))) if (!names.includes(m[1])) names.push(m[1]);
  return names;
}

function cardRouter(sourcePath) {
  const abs = path.join(ROOT, sourcePath);
  if (!fs.existsSync(abs)) return null;
  const t = fs.readFileSync(abs, "utf8");
  const m = /Router tRPC: `([^`]+)` \(([^,]+), ~(\d+) thủ tục/.exec(t);
  return m ? { name: m[1], file: m[2], count: Number(m[3]) } : null;
}

function section(title, items) {
  if (!items || !items.length) return null;
  return `## ${title}\n\n${items.map((x) => `- ${x}`).join("\n")}`;
}

function buildDraft(card) {
  const r = cardRouter(card.sourcePath);
  const procs = r ? procedureNames(r.file) : [];
  const s = SOAN[card.slug] ?? null;

  const fm = [
    "---",
    "trang_thai: nhap",
    "nguon: AI sinh nhap — CHUA DUYET",
    `sinh_luc: ${new Date().toISOString().slice(0, 10)}`,
    `route: ${card.route}`,
    `permission: ${card.permission ?? "none"}`,
    `role: [${(card.role ?? []).join(", ")}]`,
    `module: ${card.module}`,
    `license: ${card.license}`,
    "---",
    "",
    `> ⚠️ **BẢN NHÁP DO AI SINH — CHƯA ĐƯỢC DUYỆT.** Không dùng làm căn cứ vận hành.`,
    `> Tài liệu này KHÔNG nằm trong chỉ mục tri thức (\`knowledge/drafts/**\` không được chunker quét),`,
    `> nên trợ lý AI **không** trích dẫn được nó. Sau khi người có thẩm quyền rà và sửa, chuyển file`,
    `> sang \`knowledge/operational-approved/\` rồi chạy \`npm run kb:chunk\` + \`kb:embed:inc\`.`,
    `>`,
    `> Mọi ô ⬜ là chỗ **không suy ra được từ mã nguồn** — cần người vận hành điền. Để trống thành`,
    `> thật vẫn tốt hơn điền bừa.`,
    "",
    `# ${card.screenVi} — xử lý sự cố & thao tác (NHÁP)`,
    "",
  ].join("\n");

  const verified = [
    "## Thông tin đã xác minh từ mã nguồn",
    "",
    `- **Đường dẫn**: \`${card.route}\``,
    `- **Menu**: ${card.inSidebar ? `${card.navGroupVi} › ${card.screenVi}` : "KHÔNG có trong sidebar (chỉ vào bằng URL trực tiếp)"}`,
    `- **Quyền yêu cầu**: ${card.permission ? `\`${card.permission}\`` : "không yêu cầu quyền riêng"}`,
    `- **Vai trò giới hạn**: ${(card.role ?? []).length ? card.role.join(", ") : "không giới hạn theo vai trò"}`,
    `- **Module / license**: \`${card.module}\` — ${card.license === "CORE" ? "CORE (luôn bật)" : "OPTIONAL (cần license)"}`,
    r
      ? `- **Router tRPC**: \`${r.name}\` (${r.file}, ~${r.count} thủ tục)`
      : `- **Router tRPC**: không tìm được router khớp chính xác với route này. ${BLANK("xác nhận màn hình này lấy dữ liệu từ đâu")}`,
    procs.length
      ? `- **Thao tác có thật ở backend**: ${procs.slice(0, 14).map((p) => `\`${p}\``).join(", ")}${procs.length > 14 ? ` … (+${procs.length - 14})` : ""}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const body = s
    ? [
        section("Triệu chứng thường gặp", s.dau),
        section("Nguyên nhân thường gặp", s.vi),
        section("Các bước xử lý", s.buoc),
        section("Cách xác nhận đã xong", s.xac),
      ]
        .filter(Boolean)
        .join("\n\n")
    : [
        "## Triệu chứng thường gặp",
        "",
        `- ${BLANK("liệt kê 3–5 sự cố người dùng thực sự gặp ở màn hình này")}`,
        "",
        "## Nguyên nhân thường gặp",
        "",
        `- Thiếu quyền${card.permission ? ` \`${card.permission}\`` : ""} ⇒ màn hình có thể hiện rỗng thay vì báo lỗi rõ ràng.`,
        card.license === "OPTIONAL"
          ? `- Module \`${card.module}\` không có trong license đang cài ⇒ route bị chặn.`
          : null,
        `- ${BLANK("nguyên nhân nghiệp vụ đặc thù của màn hình này")}`,
        "",
        "## Các bước xử lý",
        "",
        `1. Mở \`${card.route}\`${card.inSidebar ? ` (menu: ${card.navGroupVi} › ${card.screenVi})` : " bằng URL trực tiếp"}.`,
        `2. ${BLANK("các bước thao tác cụ thể — cần người vận hành mô tả")}`,
        "",
        "## Cách xác nhận đã xong",
        "",
        `- ${BLANK("dấu hiệu quan sát được chứng tỏ sự cố đã được xử lý")}`,
      ]
        .filter((x) => x !== null)
        .join("\n");

  const foot = [
    "",
    "## Việc người duyệt cần làm",
    "",
    "1. Xoá hoặc điền mọi ô ⬜.",
    "2. Sửa lại câu nào mô tả sai thực tế nhà máy — phần soạn ở trên suy từ MÃ NGUỒN, không từ hiện trường.",
    "3. Đổi `trang_thai: nhap` thành `trang_thai: da_duyet` và ghi người duyệt + ngày.",
    "4. Chuyển file sang `knowledge/operational-approved/` — KHÔNG phải `knowledge/operational/`, thư mục",
    "   ấy bị `build-operational-cards.mjs` xoá đệ quy mỗi lượt build. Rồi `npm run kb:chunk && npm run kb:embed:inc`.",
    "",
  ].join("\n");

  return `${fm}\n${verified}\n\n${body}\n${foot}`;
}

function run() {
  const cards = JSON.parse(fs.readFileSync(CARDS_INDEX, "utf8"));
  const bySlug = new Map(cards.map((c) => [c.slug, c]));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let written = 0;
  const missing = [];
  for (const slug of TOP20) {
    const card = bySlug.get(slug);
    if (!card) {
      missing.push(slug);
      continue;
    }
    fs.writeFileSync(path.join(OUT_DIR, `${slug}.md`), buildDraft(card), "utf8");
    written += 1;
  }

  const soanCount = TOP20.filter((s) => SOAN[s]).length;
  fs.writeFileSync(
    path.join(OUT_DIR, "_README.md"),
    [
      "---",
      "trang_thai: nhap",
      "---",
      "",
      "# Nháp thẻ vận hành — CHỜ DUYỆT",
      "",
      `Sinh bởi \`scripts/ai-kb/build-operational-drafts.mjs\` ngày ${new Date().toISOString().slice(0, 10)}.`,
      "",
      `- **${written} thẻ nháp** cho 20 màn xếp hạng cao nhất theo công thức: \`${TOP20_TIEU_CHI}\`.`,
      `- **${soanCount}/20** thẻ có phần triệu chứng/nguyên nhân/các bước được SOẠN dựa trên thủ tục`,
      `  backend có thật; **${written - soanCount}/20** còn lại chủ yếu là ô trống có nhãn, vì không`,
      "  suy ra được nội dung vận hành từ repo (nhiều màn không có router khớp).",
      "",
      "## ⚠️ Thư mục này KHÔNG nằm trong chỉ mục tri thức",
      "",
      "`build-knowledge-chunks.mjs` chỉ quét `docs/`, `apidocs/`, `knowledge/domain`,",
      "`knowledge/features`, `knowledge/operational`, `knowledge/operational-approved`,",
      "`knowledge/workflows`. Không có đường nào tới",
      "`knowledge/drafts` ⇒ nháp **không có chunk, không có vector, trợ lý không trích dẫn được**.",
      "Cổng test `scripts/ai-kb/buildPlaybookChunks.test.mjs` canh điều đó và ĐỎ nếu bị vi phạm.",
      "",
      "## Duyệt xong thì làm gì",
      "",
      "1. Điền/xoá mọi ô ⬜.",
      "2. `trang_thai: nhap` → `trang_thai: da_duyet`, ghi người duyệt + ngày.",
      "3. Chuyển sang `knowledge/operational-approved/`.",
      "   ⚠⚠ KHÔNG chuyển vào `knowledge/operational/`: `build-operational-cards.mjs:217` chạy",
      "   `fs.rmSync(OUT_DIR, { recursive: true })` ⇒ XOÁ CẢ THƯ MỤC mỗi lượt build. Đổi tên file",
      "   KHÔNG cứu được — một lượt `npm run kb:sync` là mất trắng, và mất im lặng.",
      "4. `npm run kb:chunk && npm run kb:embed:inc`.",
      "",
    ].join("\n"),
    "utf8",
  );

  console.log(`[drafts] đã ghi ${written}/20 thẻ nháp → ${path.relative(ROOT, OUT_DIR)}`);
  console.log(`[drafts] có phần soạn thật: ${soanCount}/20 · còn lại là ô trống có nhãn`);
  if (missing.length) console.warn(`[drafts] ⚠ không tìm thấy thẻ gốc cho: ${missing.join(", ")}`);
}

run();
