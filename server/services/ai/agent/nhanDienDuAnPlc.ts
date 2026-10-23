/**
 * ★ Đợt 9 (2026-10-22, dieu-phoi duyệt — thiết kế `2026-10-22-tac-nhan-theo-vai-tro-design.md` §2.1 + chỉnh 1) — nhận diện DỰ ÁN PLC.
 *
 * PLC ⇔ trong cây 2 tầng của gốc dự án có: tệp `.st` / `.scl`, HOẶC tệp `.xml` là PLCopen THẬT (chứa namespace
 * `http://www.plcopen.org/xml/tc6` trong ≤ 4 KB đầu — mọi `.xml` khác KHÔNG tính). Bỏ `.git`, `node_modules`, thư mục ẩn.
 * Đồng bộ + có trần (đọc tối đa `TRAN_MUC` mục, `TRAN_XML` tệp xml) — gọi từ `congCu(cheDo)` (đồng bộ). Kết quả nhớ theo gốc 60 s.
 * Hỏng (gốc không đọc được) ⇒ `false` (không PLC ⇒ không lộ tool — phía an toàn của prompt byte-giống).
 */
import fs from "node:fs";
import path from "node:path";

export const NS_PLCOPEN_TC6 = "http://www.plcopen.org/xml/tc6";
const TRAN_MUC = 2_000;
const TRAN_XML = 20;
const BO_QUA = new Set([".git", "node_modules", "dist", "build", "bin", "obj", "out", "tmp", "temp"]);
const NHO_MS = 60_000;
const nho = new Map<string, { kq: boolean; luc: number }>();

function laXmlPlcopen(abs: string): boolean {
  let fd: number | null = null;
  try {
    fd = fs.openSync(abs, "r");
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).toString("utf8").includes(NS_PLCOPEN_TC6);
  } catch {
    return false;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/** Thuần trên hệ tệp — không cache (lưới gọi thẳng). */
export function quetDuAnPlc(goc: string): boolean {
  let soMuc = 0;
  let soXml = 0;
  const duyet = (thuMuc: string, tang: number): boolean => {
    let ds: fs.Dirent[];
    try {
      ds = fs.readdirSync(thuMuc, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const d of ds) {
      if (++soMuc > TRAN_MUC) return false;
      if (d.name.startsWith(".") || BO_QUA.has(d.name)) continue;
      const abs = path.join(thuMuc, d.name);
      if (d.isFile()) {
        const duoi = path.extname(d.name).toLowerCase();
        if (duoi === ".st" || duoi === ".scl") return true;
        if (duoi === ".xml" && soXml++ < TRAN_XML && laXmlPlcopen(abs)) return true;
      } else if (d.isDirectory() && tang < 2) {
        if (duyet(abs, tang + 1)) return true;
      }
    }
    return false;
  };
  return duyet(goc, 1);
}

/** Có nhớ theo gốc (60 s). */
export function laDuAnPlc(goc: string, bayGio: number = Date.now()): boolean {
  const c = nho.get(goc);
  if (c && bayGio - c.luc < NHO_MS) return c.kq;
  const kq = quetDuAnPlc(goc);
  nho.set(goc, { kq, luc: bayGio });
  return kq;
}

/** Chỉ lưới. */
export function _xoaNhoDuAnPlc(): void {
  nho.clear();
}
