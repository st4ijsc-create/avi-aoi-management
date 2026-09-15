/**
 * Task 14 (PH-01) — **KHÔNG tệp nào trong thư mục công khai được mang khoá API.**
 *
 * ── Vì sao lưới này tồn tại ────────────────────────────────────────────────────────────────────
 * `client/public/**` được Vite chép NGUYÊN VĂN vào `dist/` và phục vụ ở đường dẫn GỐC
 * (`/aoi-upload-test-client.html`). Không có RouteGuard, không có phiên, không có tRPC — bất kỳ ai
 * mở được cổng web đều `view-source` được. QA lần 11 đo được `aoi-upload-test-client.html` mang
 * sẵn một khoá dài 52 ký tự (`avi_` + 48 hex) trong thuộc tính `value` của ô nhập khoá.
 *
 * ── Ba cái bẫy mà lưới này CỐ Ý tránh ──────────────────────────────────────────────────────────
 * 1. **Tập rỗng là HỎNG, không phải ĐẠT.** `viPham = []` đúng cả khi thư mục không đọc được, khi
 *    đường dẫn trỏ sai chỗ, khi bộ đọc ném và bị nuốt. Nên có ca *dữ kiện nền* neo vào SỐ tệp quét
 *    được và vào ĐÚNG TÊN tệp thử — nếu bộ quét không chạm tới tệp ấy, lưới ĐỎ với lý do
 *    "không quét được", chứ không xanh giả.
 * 2. **Chỉ khớp một tiền tố là đo hụt cả lớp.** Hệ này sinh khoá theo ≥4 khuôn khác nhau:
 *    `avi_` (khoá máy cũ, `machines.apiKey`), `aoi_` (`api_keys`, `server/api/v1/apiKeyScope.ts`),
 *    `mk_` (`generateMachineKey`, `machineAuthService.ts:291`), `ak_` (khoá quản trị, nêu ở chú
 *    thích cùng hàm). Bộ dò dưới đây bắt theo **lớp**: tiền tố-có-tên, ô `<input>` mang tên
 *    khoá/bí mật mà `value` khác rỗng, và phép gán hằng cho biến tên khoá/bí mật.
 * 3. **Bộ dò âm tính phải biết KÊU.** Bốn ca đối chứng dưới đây bắn mẫu dựng sẵn (KHÔNG phải khoá
 *    thật — toàn số 0 / chữ x) qua chính hàm `doVetKhoa` mà ca ∀ dùng. Nếu một ngày ai đó làm hỏng
 *    biểu thức, các ca ấy ĐỎ trước khi ca ∀ kịp xanh giả.
 *
 * ── Đối chứng ÂM (không được kêu) ─────────────────────────────────────────────────────────────
 * `client/public/models/*.gltf` nhúng bộ đệm hình học dưới dạng `data:application/octet-stream;base64,…`
 * — hàng chục nghìn ký tự base64 entropy cao. Đó KHÔNG phải bí mật. Một bộ dò "chuỗi dài entropy
 * cao" ngây thơ sẽ kêu ở đây và người ta sẽ tắt lưới. Ca đối chứng âm neo hành vi ấy.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GOC_CONG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/public");

/**
 * Phần mở rộng đọc được dạng CHỮ. Ảnh (`.webp/.jpg`) không đọc utf8 được nên đếm riêng —
 * nhưng vẫn phải ĐẾM, để báo cáo nói được "quét N/M tệp" chứ không lờ đi phần bỏ qua.
 */
const DUOI_CHU = new Set([
  "", ".html", ".htm", ".js", ".mjs", ".cjs", ".ts", ".css", ".json", ".webmanifest",
  ".svg", ".gltf", ".txt", ".md", ".map", ".xml", ".csv", ".yml", ".yaml", ".env",
]);

type ViPham = { khuon: string; trich: string };

/** Cắt một đoạn trích AN TOÀN cho thông báo lỗi: giữ đủ để nhận dạng, che phần thân khoá. */
function che(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= 24 ? t : `${t.slice(0, 16)}…(${t.length} ký tự)`;
}

/** Tách thuộc tính của một thẻ `<input …>` thành cặp tên → giá trị (chỉ dạng nháy kép/đơn). */
function thuocTinhCua(the: string): Record<string, string> {
  const ra: Record<string, string> = {};
  for (const m of the.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*"([^"]*)"|([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*'([^']*)'/g)) {
    const ten = (m[1] ?? m[3] ?? "").toLowerCase();
    ra[ten] = m[2] ?? m[4] ?? "";
  }
  return ra;
}

const TEN_BI_MAT = /(api[-_]?key|apikey|secret|token|password|passwd|credential|\bpat\b)/i;

/**
 * Bộ dò theo LỚP. Trả về danh sách vi phạm (rỗng = sạch).
 *
 * Xuất khẩu để bốn ca đối chứng bắn mẫu dựng sẵn qua ĐÚNG hàm mà ca ∀ dùng — không có bản sao
 * thứ hai của biểu thức để hai bên lệch nhau trong im lặng.
 */
export function doVetKhoa(noiDung: string): ViPham[] {
  const viPham: ViPham[] = [];

  // (1) Khoá CÓ TIỀN TỐ do chính hệ này sinh — hex hoặc base62, ≥16 ký tự thân.
  for (const m of noiDung.matchAll(/\b(?:avi|aoi|mk|ak|sk|pk)_(?:[0-9a-fA-F]{16,}|[A-Za-z0-9]{24,})\b/g)) {
    viPham.push({ khuon: "khoá có tiền tố hệ sinh (avi_/aoi_/mk_/ak_/sk_/pk_)", trich: che(m[0]) });
  }

  // (2) Ô <input> mang TÊN khoá/bí mật mà `value` KHÁC RỖNG. Bắt được cả khuôn khoá tương lai mà
  //     luật (1) chưa biết mặt — điều kiện là ô nhập tự khai nó đựng bí mật.
  for (const m of noiDung.matchAll(/<input\b[^>]*>/gi)) {
    const at = thuocTinhCua(m[0]);
    const dinhDanh = `${at.id ?? ""} ${at.name ?? ""} ${at["data-testid"] ?? ""}`;
    const gt = at.value ?? "";
    if (TEN_BI_MAT.test(dinhDanh) && gt.trim().length >= 8) {
      viPham.push({ khuon: "ô <input> tên khoá/bí mật có value mặc định", trich: che(`${at.id ?? at.name}=${gt}`) });
    }
  }

  // (3) Gán HẰNG cho biến/khoá JSON tên khoá/bí mật. `data:` bị loại tường minh (gltf nhúng base64).
  for (const m of noiDung.matchAll(
    /\b(api[-_]?key|apikey|secret|token|password|passwd|credential)\b\s*[:=]\s*(["'`])([^"'`\n]{16,})\2/gi,
  )) {
    const gt = m[3] ?? "";
    if (/^data:/i.test(gt) || /^https?:\/\//i.test(gt)) continue;
    if (/\$\{|\+\s*$/.test(gt)) continue; // nội suy / nối chuỗi ⇒ không phải hằng
    viPham.push({ khuon: "gán hằng cho biến tên khoá/bí mật", trich: che(`${m[1]}=${gt}`) });
  }

  return viPham;
}

/** Đi hết cây thư mục, trả đường dẫn TƯƠNG ĐỐI của mọi tệp (kể cả thư mục con). */
function moiTep(goc: string, tienTo = ""): string[] {
  const ra: string[] = [];
  for (const muc of fs.readdirSync(goc, { withFileTypes: true })) {
    const tuongDoi = tienTo ? `${tienTo}/${muc.name}` : muc.name;
    if (muc.isDirectory()) ra.push(...moiTep(path.join(goc, muc.name), tuongDoi));
    else if (muc.isFile()) ra.push(tuongDoi);
  }
  return ra;
}

describe("★★★ Task 14 (PH-01) — tệp trong thư mục công khai KHÔNG được mang khoá API", () => {
  const tatCa = fs.existsSync(GOC_CONG) ? moiTep(GOC_CONG) : [];
  const laChu = (t: string) => DUOI_CHU.has(path.extname(t).toLowerCase());
  const tepChu = tatCa.filter(laChu);
  const tepNhiPhan = tatCa.filter((t) => !laChu(t));

  // ── Dữ kiện nền: nếu bộ quét không chạm tới đúng chỗ thì ca ∀ dưới đây xanh VÔ NGHĨA ──────────
  it("dữ kiện nền — thư mục công khai TỒN TẠI và bộ quét đọc được ≥6 tệp chữ", () => {
    expect(fs.existsSync(GOC_CONG), `không thấy thư mục ${GOC_CONG}`).toBe(true);
    expect(tatCa.length, "thư mục công khai rỗng ⇒ phép quét không đo gì").toBeGreaterThanOrEqual(10);
    expect(tepChu.length, "0 tệp chữ ⇒ bộ lọc phần mở rộng đã nuốt hết").toBeGreaterThanOrEqual(6);
  });

  it("dữ kiện nền — ĐÚNG tệp thử QA lần 11 nằm trong tập quét (không phải quét chỗ khác)", () => {
    expect(tepChu).toContain("aoi-upload-test-client.html");
    expect(tepChu).toContain("sw.js");
    expect(tepChu).toContain("models/aoi-machine.gltf");
  });

  // ── Ca ∀ — kết cục thật ────────────────────────────────────────────────────────────────────────
  it("★ không tệp chữ nào trong client/public chứa chuỗi giống khoá API", () => {
    const so: string[] = [];
    for (const ten of tepChu) {
      const noiDung = fs.readFileSync(path.join(GOC_CONG, ten), "utf8");
      for (const v of doVetKhoa(noiDung)) so.push(`${ten}: [${v.khuon}] ${v.trich}`);
    }
    expect(so, `quét ${tepChu.length} tệp chữ / ${tatCa.length} tệp (${tepNhiPhan.length} nhị phân bỏ qua)`).toEqual([]);
  });

  // ── Bốn ca đối chứng DƯƠNG: bộ dò phải biết KÊU ───────────────────────────────────────────────
  describe("đối chứng — bộ dò KÊU trên mẫu dựng sẵn (mẫu toàn 0/x, KHÔNG phải khoá thật)", () => {
    it("kêu ở khoá tiền tố avi_ + 48 hex (đúng khuôn QA lần 11 đo được)", () => {
      expect(doVetKhoa(`bất kỳ chữ nào avi_${"0".repeat(48)} bất kỳ chữ nào`)).not.toEqual([]);
    });

    it("kêu ở ba khuôn tiền tố CÒN LẠI của hệ (aoi_ / mk_ / ak_) — không chỉ một tiền tố", () => {
      for (const tienTo of ["aoi", "mk", "ak", "sk", "pk"]) {
        expect(doVetKhoa(`x ${tienTo}_${"0".repeat(32)} x`), `tiền tố ${tienTo}_ lọt lưới`).not.toEqual([]);
      }
    });

    it("kêu ở ô <input> tên khoá có value mặc định, kể cả khuôn khoá KHÔNG có tiền tố nào", () => {
      expect(doVetKhoa(`<input type="text" id="apiKey" value="${"x".repeat(40)}" placeholder="…">`)).not.toEqual([]);
      expect(doVetKhoa(`<input name="machineSecret" value="${"x".repeat(20)}">`)).not.toEqual([]);
    });

    it("kêu ở phép gán hằng `apiKey: \"…\"` trong JS/JSON", () => {
      expect(doVetKhoa(`const cfg = { apiKey: "${"x".repeat(30)}" };`)).not.toEqual([]);
    });
  });

  // ── Hai ca đối chứng ÂM: bộ dò phải IM ────────────────────────────────────────────────────────
  describe("đối chứng âm — bộ dò IM ở chỗ KHÔNG phải bí mật", () => {
    it("im ở base64 nhúng của .gltf (bộ đệm hình học, không phải khoá)", () => {
      const gltf = `"uri": "data:application/octet-stream;base64,${"QUJD".repeat(500)}"`;
      expect(doVetKhoa(gltf)).toEqual([]);
    });

    it("im ở ô nhập khoá đã BỎ giá trị mặc định (chỉ còn gợi ý) — hình dạng ĐÚNG sau bản vá", () => {
      expect(doVetKhoa(`<input type="text" id="apiKey" value="" placeholder="avi_xxx...">`)).toEqual([]);
    });

    it("im ở biến khoá đọc từ ô nhập (không phải hằng)", () => {
      expect(doVetKhoa(`const apiKey = document.getElementById('apiKey').value.trim();`)).toEqual([]);
    });
  });
});
