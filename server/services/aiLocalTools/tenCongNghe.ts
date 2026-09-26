/**
 * ★★★ G11 (audit 2026-09-22 · dự án thật D3) — **`Node.js` KHÔNG PHẢI MỘT TỆP.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỖI ĐO ĐƯỢC — MỘT ĐƠN HÀNG BỊ TỪ CHỐI TRONG 43 mili-giây, MODEL KHÔNG ĐƯỢC GỌI LẤY MỘT LẦN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đơn hàng thật của chủ dự án:
 *   *"Viết phần cốt lõi của một website giới thiệu công ty … Dùng PostgreSQL + Node.js (Express) +
 *   React …"*
 *
 * Đường ống trả về, nguyên văn, sau 43 ms và 50 ký tự:
 *   **"Không có tệp/thư mục \"Node.js\" trong hộp cát repo."**
 *
 * Chuỗi nhân quả: `REPO_PATH_REGEX` thấy `Node` + `.` + `js` ⇒ kết luận *"đây là đường dẫn tệp"*
 * ⇒ heuristic tất định chọn `read_file("Node.js")` ⇒ `NOT_FOUND` ⇒ cầu chì G2 (*"mọi vòng đọc đều
 * bị từ chối ⇒ đừng gọi model"*) nổ ⇒ lời từ chối thành câu trả lời. Người đặt hàng một website
 * nhận lại một thông báo thiếu tệp.
 *
 * Đo trên 8 câu, **8/8 bắt nhầm** (`scripts/ai-eval` 2026-09-22):
 *   Node.js · Next.js · Vue.js · Chart.js · Express.js · Three.js · Nest.js · Nuxt.js
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO RÀNG BUỘC "TRỤI" (không có `/`) LÀ PHẦN QUAN TRỌNG NHẤT CỦA VỊ TỪ NÀY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Một danh sách chặn đơn thuần sẽ cướp mất một đường dẫn HỢP LỆ: repo hoàn toàn có thể có
 * `src/vendor/Chart.js` hoặc `public/js/Three.js`. Nên vị từ này **chỉ** phủ nhận khi token:
 *   1. KHÔNG chứa `/` hay `\` — tức người dùng không hề nêu một vị trí nào; **và**
 *   2. phần thân nằm trong bảng dưới.
 * `src/Node.js` vẫn là đường dẫn, y như trước. Đây là chỗ khiến bản vá **không** đánh đổi gì.
 *
 * ⚠ Bảng này là một danh sách, và mọi danh sách đều già đi — đó là lý do nó KHÔNG phải hàng rào
 *   duy nhất. Hàng rào cứng nằm ở `toolDuongTat.cauChiNenNo()`: một lượt đọc `NOT_FOUND` không
 *   được phép phủ quyết một yêu cầu SINH MÃ, dù tên nào lọt lưới đi nữa. Hai lớp, và lớp thứ hai
 *   là **cơ chế** chứ không phải trí nhớ — đúng bài học "hàng rào mềm 3/10, hàng rào cứng 10/10".
 * ⚠ KHÔNG thêm vào đây những tên mà người ta thật sự hay đặt cho tệp trong repo (`index`, `app`,
 *   `main`, `server`, `config`, `test`). Chúng là tệp thật nhiều hơn là công nghệ.
 */

/**
 * Thân tên (trước phần mở rộng) của các công nghệ mà người ta gọi kèm `.js`/`.ts` trong văn nói.
 * Viết thường; phép so KHÔNG phân biệt hoa thường.
 */
const THAN_CONG_NGHE: ReadonlySet<string> = new Set([
  // nền tảng & khung máy chủ
  "node", "nodejs", "deno", "bun",
  "express", "nest", "koa", "hapi", "fastify", "adonis", "sails", "meteor", "feathers", "strapi",
  // khung giao diện
  "react", "vue", "next", "nuxt", "svelte", "solid", "preact", "ember", "backbone", "angular",
  "alpine", "mithril", "riot", "aurelia", "polymer", "knockout", "marko", "astro", "remix",
  // đồ hoạ · biểu đồ · 3D
  "three", "babylon", "chart", "d3", "echarts", "highcharts", "plotly", "pixi", "konva", "fabric",
  "paper", "p5", "anime", "gsap", "leaflet", "mapbox", "cesium", "matter",
  // tiện ích hay được gọi tên kèm .js
  "jquery", "lodash", "underscore", "ramda", "moment", "dayjs", "axios", "socket", "rxjs",
  "redux", "mobx", "vuex", "pinia", "apollo", "prisma", "sequelize", "mongoose", "knex", "typeorm",
  "vite", "webpack", "rollup", "parcel", "esbuild", "turbo", "nx",
  "tone", "howler", "video", "immutable", "zod",
]);

/** Phần mở rộng mà văn nói hay dính vào tên công nghệ. Ngoài bảng này ⇒ luôn coi là tệp. */
const DUOI_HAY_DINH: ReadonlySet<string> = new Set(["js", "ts", "jsx", "tsx", "mjs", "cjs"]);

/**
 * `true` ⇔ token này là **TÊN CÔNG NGHỆ được gọi trong văn nói**, không phải một đường dẫn repo.
 *
 * Hàm THUẦN — không I/O, không đọc đĩa, không đọc env.
 *
 * ⚠ Nó KHÔNG hỏi *"tệp này có tồn tại không"*. Hỏi đĩa ở đây sẽ khiến kết quả phụ thuộc vào trạng
 *   thái worktree: cùng một câu, hai máy, hai số phận — đúng lớp lỗi "cùng câu hai số phận" đã ghi
 *   trong bộ nhớ dự án. Vị từ này chỉ đọc chính chuỗi được đưa cho nó.
 */
export function laTenCongNghe(token: string | null | undefined): boolean {
  const s = String(token ?? "").trim();
  if (s === "") return false;
  // (1) Có vị trí ⇒ người dùng đã nêu một đường dẫn thật ⇒ KHÔNG đụng vào.
  if (s.includes("/") || s.includes("\\")) return false;
  const cham = s.lastIndexOf(".");
  if (cham <= 0) return false;
  const duoi = s.slice(cham + 1).toLowerCase();
  if (!DUOI_HAY_DINH.has(duoi)) return false;
  // (2) Thân nằm trong bảng công nghệ.
  return THAN_CONG_NGHE.has(s.slice(0, cham).toLowerCase());
}

/** Lọc một danh sách đường dẫn đã trích, bỏ các token thực chất là tên công nghệ. Hàm THUẦN. */
export function locBoTenCongNghe(duongDan: readonly string[]): string[] {
  return duongDan.filter((d) => !laTenCongNghe(d));
}
