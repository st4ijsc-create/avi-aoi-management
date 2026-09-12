/**
 * sucKhoeTheoIndexQd27.test.ts — ★★★ ĐỢT 53 (mục C): MỌI `DISTINCT ON` TRÊN `machine_health_history`
 * PHẢI SẮP THEO CỘT MÀ INDEX QĐ-27 PHỦ. BẤT BIẾN QUÉT, KHÔNG PHẢI DANH SÁCH.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * VÌ SAO
 * ════════════════════════════════════════════════════════════════════════════
 * QĐ-27 (Đợt 50/51) chữa câu chậm của `traSucKhoeMay` bằng index
 * `idx_health_machine_created_desc ("machineId","createdAt" DESC)` và đổi câu sang `ORDER BY
 * "createdAt" DESC`. Nhưng **bản sao thứ hai** — `factoryCommandService` bước 5, CÙNG bảng, CÙNG
 * hình dạng, CÙNG đường người dùng (3 màn Twin qua `useTrangThaiSong.ts:87`) — không ai quét (G110).
 *
 * Đo được (`.qa-dot53/explain-truoc.txt`, DB dev 215 079 hàng, `EXPLAIN (ANALYZE, BUFFERS)` ×6):
 *   `ORDER BY "timestamp" DESC` → Seq Scan 215 079 hàng → Sort external merge **Disk 8 864 kB** →
 *   **103,9 – 126,1 ms**;  `ORDER BY "createdAt" DESC` → Index Scan, 43 hàng → **0,098 – 0,418 ms**.
 *   Hai câu trả **43 hàng GIỐNG HỆT theo byte** — đổi đường đi, không đổi câu trả lời.
 *
 * Lưới này quét MÃ (không phải liệt kê tay) nên bản sao THỨ BA ngày mai cũng bị bắt.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = resolve(__dirname, "../..");

function quetTs(thuMuc: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(thuMuc)) {
    const p = resolve(thuMuc, ten);
    if (statSync(p).isDirectory()) {
      if (ten === "node_modules") continue;
      quetTs(p, ra);
    } else if (ten.endsWith(".ts") && !ten.includes(".test.")) ra.push(p);
  }
  return ra;
}

/** Mỗi câu SQL chứa `machine_health_history` + `DISTINCT ON ("machineId")`, kèm mệnh đề ORDER BY của nó. */
const CAU: { tep: string; dong: number; orderBy: string }[] = [];
for (const p of quetTs(resolve(GOC, "server"))) {
  const src = readFileSync(p, "utf8");
  let tu = 0;
  for (;;) {
    const i = src.indexOf('DISTINCT ON ("machineId")', tu);
    if (i < 0) break;
    tu = i + 1;
    /*
     * Cắt khối câu: từ `SELECT` gần nhất phía trước, tiến 1 500 ký tự.
     * ⚠ KHÔNG cắt ở backtick đầu tiên — `traSucKhoeMay` có `sql.join(ids.map((id) => sql`…`))`
     *   LỒNG backtick giữa câu, nên cách ấy cắt TRƯỚC `ORDER BY` và lưới báo "(KHONG CO ORDER BY)"
     *   cho một câu đang sắp ĐÚNG. Bản đầu của chính lưới này đã dính, ghi lại để không ai chép lại.
     */
    const batDau = src.lastIndexOf("SELECT", i);
    if (batDau < 0) continue;
    const cuaSo = src.slice(batDau, Math.min(src.length, i + 1500));
    const m = cuaSo.match(/ORDER BY\s+"machineId"[^\n`]*/);
    // Khối của CHÍNH câu này = từ SELECT tới ORDER BY đầu tiên. Bảng phải đọc TRONG khối ấy —
    // không thì câu `machine_heartbeats` ngay phía trên sẽ "thấy" chữ machine_health_history của
    // câu KẾ TIẾP trong cùng cửa sổ 1 500 ký tự và bị chấm oan (bản đầu của lưới này đã dính).
    const khoi = m ? cuaSo.slice(0, cuaSo.indexOf(m[0]) + m[0].length) : cuaSo;
    if (!/FROM\s+machine_health_history/.test(khoi)) continue;
    CAU.push({
      tep: p.slice(GOC.length + 1).replace(/\\/g, "/"),
      dong: src.slice(0, i).split("\n").length,
      orderBy: (m ? m[0] : "(KHONG CO ORDER BY)").replace(/\s+/g, " ").trim(),
    });
  }
}

describe("★★★ Đợt 53 — `DISTINCT ON machine_health_history` phải dùng cột của index QĐ-27", () => {
  it("phép quét CÓ bắt được câu nào (đối chứng dương của thiết bị đo)", () => {
    expect(CAU.length).toBeGreaterThanOrEqual(2);
    const tep = new Set(CAU.map((c) => c.tep));
    expect(tep).toContain("server/services/factoryCommandService.ts");
    expect(tep).toContain("server/db/twinCanh.ts");
  });

  it('★★★ MỌI câu sắp theo `"createdAt" DESC` — KHÔNG câu nào còn `"timestamp" DESC`', () => {
    const xau = CAU.filter((c) => !/ORDER BY "machineId", "createdAt" DESC/.test(c.orderBy));
    expect(
      xau.map((c) => `${c.tep}:${c.dong} → ${c.orderBy.slice(0, 90)}`),
      'index `idx_health_machine_time` là ("machineId","timestamp") ASC ⇒ không phủ được machineId ASC + timestamp DESC ⇒ Seq Scan 215k hàng + Sort đĩa 8,8 MB',
    ).toEqual([]);
  });

  it("★ KHÔNG tạo index mới trong đợt này — thư mục `drizzle/` không có migration mới cho bảng này", () => {
    // Bản vá mục C dùng đúng index QĐ-27 đã có. Nếu ai đó lén thêm migration, ca này nói ra.
    const ds = readdirSync(resolve(GOC, "drizzle")).filter((f) => /^0(3[5-9]|[4-9]\d)\d/.test(f) && f.endsWith(".sql"));
    const themIndex = ds.filter((f) => {
      const s = readFileSync(resolve(GOC, "drizzle", f), "utf8");
      return /CREATE\s+INDEX[\s\S]*machine_health_history/i.test(s);
    });
    // 0356 (QĐ-27) là migration DUY NHẤT được phép tạo index trên bảng này.
    expect(themIndex.filter((f) => !f.startsWith("0356"))).toEqual([]);
  });
});
