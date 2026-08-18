/**
 * ★★★ G1-D — LƯỚI CHỐNG "N+1" CHO **ĐIỂM NGHẼN NẠP MODEL**.
 *
 * Bất biến của task (*"không bao giờ nạp bản thứ hai của model llama-server đang giữ"*) chỉ đứng
 * được nếu **mọi** lượt nạp trọng số GGUF đi qua đúng MỘT cửa có gác. Một `llama.loadModel()` mới
 * viết ở chỗ khác — trong một tính năng tương lai, hoặc trong một bản vá vội — sẽ **đi vòng qua
 * toàn bộ bản vá này mà không có ca test nào đỏ**. Đó chính xác là hình dạng của lớp lỗi "N+1" đã
 * dính 17 lần trong repo (lưới theo FILE / theo DANH SÁCH, không theo ĐƯỜNG THOÁT).
 *
 * Lưới ở đây quét MÃ NGUỒN thật (cùng kỹ thuật với `vram/vramAllocationSites.test.ts` — bản liệt
 * kê điểm cấp phát VRAM, đã chứng minh tác dụng khi nó bắt được hai điểm nạp chưa khai) và phát
 * biểu ba câu:
 *
 * ⚠ File này KHÔNG thuộc chương trình "Module VRAM Pha N" — nó là lưới của G1-D. Mọi tham chiếu
 * tới các pha ấy được gọi theo TÊN CƠ CHẾ, không theo số hiệu pha, để `vram/vramPha5Gate.test.ts`
 * (vốn phân loại lưới theo chuỗi tự-khai) không xếp nhầm nó vào một pha nó không thuộc về.
 *   1. Trong `server/**` (mã sản phẩm) chỉ có ĐÚNG những điểm gọi `.loadModel(` đã được ghi nhận.
 *   2. Mọi điểm gọi trong `aiGgufEngine.ts` nằm TRONG thân `loadGgufModel()`.
 *   3. `loadGgufModel()` gọi `chanNapTrungModelServer(` TRƯỚC điểm gọi `.loadModel(` đầu tiên.
 * Bỏ dòng gác đi ⇒ câu 3 đỏ. Thêm một điểm nạp mới ở đâu đó ⇒ câu 1 đỏ.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const GOC = resolve(process.cwd(), "server");

function moiTepTs(dir: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(dir)) {
    const p = join(dir, ten);
    if (statSync(p).isDirectory()) {
      moiTepTs(p, ra);
      continue;
    }
    if (!ten.endsWith(".ts")) continue;
    if (ten.endsWith(".test.ts") || ten.endsWith(".spec.ts")) continue; // lưới canh MÃ SẢN PHẨM
    ra.push(p);
  }
  return ra;
}

/** Bỏ chú thích khối/dòng + chuỗi để không đếm nhầm ví dụ trong docstring (repo này viết rất dài). */
function bocTruiChuThich(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

/**
 * ĐIỂM GỌI ĐƯỢC PHÉP. Danh sách này KHÔNG phải "danh sách model" (thứ mà brief cấm) — nó là danh
 * sách **ĐIỂM CẤP PHÁT TRỌNG SỐ trong mã**, hữu hạn và kiểm được, đúng khuôn `vramAllocationSites`.
 */
const DIEM_NAP_DUOC_PHEP: ReadonlyArray<{ tep: string; so: number; lyDo: string }> = [
  {
    tep: "services/aiGgufEngine.ts",
    so: 2,
    lyDo:
      "cả hai nằm trong thân loadGgufModel() (đường CHÍNH qua vramLoadOutcome + đường DỰ PHÒNG), " +
      "tức sau cổng chanNapTrungModelServer(). Câu 2 và 3 bên dưới cưỡng chế điều đó.",
  },
  {
    tep: "services/aiReranker.ts",
    so: 1,
    lyDo:
      "reranker bge-v2-m3 (~803 MiB) — KHÔNG BAO GIỜ là model llama-server phục vụ (server chỉ giữ " +
      "một model sinh chữ, khai ở LLAMA_SERVER_MODEL). Miễn cổng có chủ ý, ghi ra để người sau " +
      "không tưởng là sót. ⚠ Nếu ai đó trỏ LLAMA_SERVER_MODEL vào một reranker thì cấu hình đó tự " +
      "mâu thuẫn ở tầng cao hơn (getGenerationModel từ chối model phi-sinh-chữ).",
  },
];

describe("G1-D — điểm nghẽn nạp model: vị từ trên MÃ NGUỒN, không trên danh sách model", () => {
  const tep = moiTepTs(GOC);

  it("★ câu 1: trong server/** chỉ có ĐÚNG những điểm gọi `.loadModel(` đã ghi nhận", () => {
    const thay = new Map<string, number>();
    for (const p of tep) {
      const n = (bocTruiChuThich(readFileSync(p, "utf8")).match(/\.loadModel\s*\(/g) || []).length;
      if (n > 0) thay.set(relative(GOC, p).replace(/\\/g, "/"), n);
    }
    const mong = new Map(DIEM_NAP_DUOC_PHEP.map((d) => [d.tep, d.so]));
    expect(
      Object.fromEntries([...thay].sort()),
      "Có điểm nạp trọng số MỚI (hoặc bị dời) trong server/**. Mỗi điểm như thế đi VÒNG QUA cổng " +
        "chanNapTrungModelServer() và có thể nạp BẢN THỨ HAI của model 30B. Hoặc đưa nó vào sau " +
        "cổng, hoặc thêm vào DIEM_NAP_DUOC_PHEP kèm lý do ĐO ĐƯỢC.",
    ).toEqual(Object.fromEntries([...mong].sort()));
  });

  const nguon = readFileSync(join(GOC, "services", "aiGgufEngine.ts"), "utf8");
  const than = (() => {
    const i = nguon.indexOf("export async function loadGgufModel(");
    expect(i, "không tìm thấy loadGgufModel() — brief/lưới đã lệch khỏi mã").toBeGreaterThan(0);
    const j = nguon.indexOf("\nasync function ensureTextContext(", i);
    expect(j, "không tìm thấy ranh giới cuối thân loadGgufModel()").toBeGreaterThan(i);
    return nguon.slice(i, j);
  })();

  it("★ câu 2: MỌI điểm gọi `.loadModel(` của aiGgufEngine nằm TRONG thân loadGgufModel()", () => {
    const trongTep = (bocTruiChuThich(nguon).match(/\.loadModel\s*\(/g) || []).length;
    const trongThan = (bocTruiChuThich(than).match(/\.loadModel\s*\(/g) || []).length;
    expect(trongThan).toBe(trongTep);
    expect(trongThan).toBe(2);
  });

  it("★★ câu 3: cổng `chanNapTrungModelServer(` được gọi TRƯỚC lượt nạp đầu tiên", () => {
    const viTriCong = than.indexOf("await chanNapTrungModelServer(");
    expect(
      viTriCong,
      "ĐỘT BIẾN BẮT ĐƯỢC: cổng G1-D không còn được gọi trong loadGgufModel() ⇒ mọi đường vào " +
        "(generateTextStream / chatCompletion / warmModel / router HTTP) lại có thể nạp bản thứ hai.",
    ).toBeGreaterThan(-1);
    const viTriNapDau = bocTruiChuThich(than).search(/\.loadModel\s*\(/);
    // So sánh trên CÙNG một chuỗi để chỉ số có nghĩa: tìm lại vị trí cổng trong bản bóc trụi.
    const congTrongBanBoc = bocTruiChuThich(than).indexOf("await chanNapTrungModelServer(");
    expect(congTrongBanBoc).toBeGreaterThan(-1);
    expect(congTrongBanBoc).toBeLessThan(viTriNapDau);
  });

  it("★ câu 4: cổng phải THẬT SỰ chặn — thân nó có `throw` sau khi xác nhận server còn sống", () => {
    const i = nguon.indexOf("async function chanNapTrungModelServer(");
    expect(i).toBeGreaterThan(0);
    const j = nguon.indexOf("\nfunction daNamSanTrongTienTrinh(", i);
    expect(j).toBeGreaterThan(i);
    const thanCong = nguon.slice(i, j);
    expect(thanCong).toMatch(/laModelServerDangGiu\(/); // dùng ĐÚNG vị từ hạt nhân, không tự so sánh
    expect(thanCong).toMatch(/preflightHealthy\(/); // quyết định dựa trên BẰNG CHỨNG server còn sống
    expect(thanCong).toMatch(/throw new Error\(/); // và nó NÉM, không chỉ cảnh báo
  });
});
