/**
 * THUẦN: không DB, không mạng, không đồng hồ, chỉ ĐỌC mã nguồn dưới server/. Chạy KHÔNG cần Q1_PG_CHAY (nằm trong lưới thường).
 * Tên đề xuất khi được phép đặt vào cây: server/services/notificationServiceInitMotCho.test.ts (khớp include `server/** → *.test.ts`, AGENTS.md §4).
 *
 * Vì sao có ca này (HST 15/11): ca PG Q-1 (q1-pg-ca.db.test.ts.txt) cần biết Socket.io tới client KHÔNG mở trong tiến trình của ca. `io` là `let io` cấp module
 * (server/services/notificationService.ts:21), không có getter hay export; chỉ `initNotificationService` (notificationService.ts:27) đặt nó, và chỉ MỘT chỗ gọi nó:
 * server/_core/socket.ts:1552 (khi server khởi động). Ca này canh khẳng định đó bằng cách quét nguồn: đúng 1 chỗ GỌI `initNotificationService(`, ở server/_core/socket.ts.
 * Có chỗ gọi thứ hai, hoặc chỗ gọi nằm ở tệp khác ⇒ ĐỎ (lúc đó khẳng định "io chỉ đặt ở khi server khởi động" của ca PG không còn đúng và phải xem lại).
 * Không tính: định nghĩa (`function initNotificationService(`), dòng `import`, dòng chú thích, và tệp test (`*.test.*`, `*.spec.*`: chúng chỉ `vi.mock` hàm này).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GOC_SERVER = fileURLToPath(new URL("..", import.meta.url)); // server/ (tệp đặt ở server/services/)
const BO_QUA = new Set(["node_modules", "dist", ".git"]);
const LA_NGUON = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const LA_TEST = /\.(test|spec)\./;

function* duyet(thuMuc: string): Generator<string> {
  for (const e of readdirSync(thuMuc, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!BO_QUA.has(e.name)) yield* duyet(path.join(thuMuc, e.name));
    } else if (LA_NGUON.test(e.name) && !LA_TEST.test(e.name)) yield path.join(thuMuc, e.name);
  }
}

interface Cho {
  tep: string;
  dong: number;
  noiDung: string;
}

/** các chỗ GỌI `initNotificationService(` (không định nghĩa, không import, không chú thích) và các chỗ ĐỊNH NGHĨA (để chứng minh bộ quét thật sự đọc được tệp) */
function quet(): { goi: Cho[]; dinhNghia: Cho[] } {
  const goi: Cho[] = [];
  const dinhNghia: Cho[] = [];
  for (const tep of duyet(GOC_SERVER)) {
    const dong = readFileSync(tep, "utf8").split(/\r?\n/);
    dong.forEach((d, i) => {
      if (!/\binitNotificationService\s*\(/.test(d)) return;
      const t = d.trim();
      const cho = { tep: path.relative(GOC_SERVER, tep).split(path.sep).join("/"), dong: i + 1, noiDung: t };
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return; // chú thích
      if (/^(export\s+)?(async\s+)?function\s+initNotificationService\b/.test(t)) {
        dinhNghia.push(cho);
        return;
      }
      if (/^import\b/.test(t)) return; // dòng import
      goi.push(cho);
    });
  }
  return { goi, dinhNghia };
}

describe("notificationService: `io` chỉ được đặt khi server khởi động", () => {
  it("bộ quét thật sự đọc được nguồn: tìm đúng MỘT định nghĩa initNotificationService, ở services/notificationService.ts", () => {
    const { dinhNghia } = quet();
    expect(dinhNghia.map((c) => c.tep)).toEqual(["services/notificationService.ts"]);
  });

  it("có ĐÚNG MỘT chỗ GỌI initNotificationService(, và nó ở _core/socket.ts", () => {
    const { goi } = quet();
    expect(goi.map((c) => `${c.tep}:${c.dong}`), "chỗ gọi (tệp:dòng)").toHaveLength(1);
    expect(goi[0]!.tep, "chỗ gọi duy nhất phải ở _core/socket.ts").toBe("_core/socket.ts");
  });
});
