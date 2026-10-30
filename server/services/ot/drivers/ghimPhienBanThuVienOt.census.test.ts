/**
 * ★★★ SCADA R1b-2b-2a T3D (điều phối chốt 2026-10-31) — CENSUS ghim CHÍNH XÁC phiên bản thư viện giao thức OT.
 *
 * Các bản vá an toàn đường ghi / STOP dựa vào NỘI TẠI thư viện, đã thăm dò trên đúng bản đang khoá:
 *   • nodes7 0.3.18      — T2 (hết hạn driver), T3 (errCode hết hạn thư viện), T3C (bỏ item ⇒ phát lại gói cũ);
 *   • mcprotocol 0.1.2   — T3B-0 (đọc end code 1E sai byte ⇒ khoá ghi, cô lập callback);
 *   • st-ethernet-ip 2.7.5 — T3A (listener "Write Tag" sót ⇒ ack muộn tính cho lời ghi kế);
 *   • node-opcua 2.174.0 + node-opcua-pki 6.18.0 — vá PKI c96e4c3dc (reloadCertificates / watcher nội tại).
 * ⇒ NÂNG BẤT KỲ GÓI NÀO = CHẠY LẠI các thăm dò thư viện thật T2 / T3 / T3A / 3B-0 / T3C / PKI rồi mới đổi số ở đây.
 *
 * Census đòi: (1) mỗi gói trong GHIM có range CHÍNH XÁC `x.y.z` trong package.json, khớp mục gốc của package-lock và bản thật
 * `node_modules/<gói>` trong lock; (2) mọi `packageName = "<gói>"` của driver OT nằm trong GHIM hoặc MIEN_GHIM (có lý do) —
 * driver mới với thư viện mới ⇒ ĐỎ, nêu tên.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GOC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const THU_MUC_DRIVER = join(GOC, "server", "services", "ot", "drivers");

const GHIM: Readonly<Record<string, string>> = Object.freeze({
  nodes7: "0.3.18",
  mcprotocol: "0.1.2",
  "st-ethernet-ip": "2.7.5",
  "node-opcua": "2.174.0",
  "node-opcua-pki": "6.18.0",
});

/** Thư viện driver OT CHƯA ghim — mỗi mục phải có lý do. */
const MIEN_GHIM: Readonly<Record<string, string>> = Object.freeze({
  "modbus-serial": "chưa có bản vá nào dựa vào nội tại thư viện (T2 chỉ bọc hạn ngoài); ngoài danh sách ghim điều phối chốt 2026-10-31",
});

const BAN_CHINH_XAC = /^\d+\.\d+\.\d+$/;

const docJson = (tep: string) => JSON.parse(readFileSync(join(GOC, tep), "utf8"));

describe("T3D — ghim chính xác phiên bản thư viện giao thức OT", () => {
  const pj = docJson("package.json");
  const lock = docJson("package-lock.json");
  const gocLock = lock.packages[""].dependencies as Record<string, string>;

  for (const [goi, ban] of Object.entries(GHIM)) {
    it(`${goi} = ${ban} chính xác ở package.json, gốc lock và bản đã khoá`, () => {
      expect(pj.dependencies[goi], `package.json dependencies.${goi}`).toBe(ban);
      expect(BAN_CHINH_XAC.test(pj.dependencies[goi])).toBe(true);
      expect(gocLock[goi], `package-lock packages[""].dependencies.${goi}`).toBe(ban);
      expect(lock.packages[`node_modules/${goi}`]?.version, `package-lock node_modules/${goi}`).toBe(ban);
    });
  }

  it("mọi thư viện driver OT (packageName) nằm trong GHIM hoặc MIEN_GHIM", () => {
    const tenGoi = new Set<string>();
    for (const tep of readdirSync(THU_MUC_DRIVER)) {
      if (!tep.endsWith(".ts") || tep.endsWith(".test.ts")) continue;
      const nguon = readFileSync(join(THU_MUC_DRIVER, tep), "utf8");
      for (const m of nguon.matchAll(/packageName\s*=\s*["']([^"']+)["']/g)) tenGoi.add(m[1]);
    }
    expect(tenGoi.size, "không tìm thấy packageName nào — bộ quét hỏng").toBeGreaterThanOrEqual(5);
    const thieu = [...tenGoi].filter((g) => !(g in GHIM) && !(g in MIEN_GHIM));
    expect(thieu, "thư viện driver OT chưa ghim và chưa có lý do miễn").toEqual([]);
    for (const g of Object.keys(MIEN_GHIM)) expect(g in GHIM, `${g} vừa ghim vừa miễn`).toBe(false);
  });
});
