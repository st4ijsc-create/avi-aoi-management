/**
 * ★★★ Đợt 12 · H5.3 (2026-10-31) — KHO ĐẦU RA DÀI của lượt agent: kết quả tool vượt trần quan sát (12 000 ký tự) được lưu NGUYÊN VẸN (bản ĐÃ
 * CHE bí mật) vào tệp riêng; model chỉ thấy đầu+đuôi và một MÃ THAM CHIẾU (`out-<8 hex>`), đọc phần cần bằng công cụ `read_output`
 * (theo dòng / grep) thay vì chạy lại lệnh. Cờ host `AI_AGENT_DAU_RA_DAI=1` (MẶC ĐỊNH TẮT).
 *
 * BẤT BIẾN:
 *  1. Chỉ ghi bản ĐÃ CHE: `luu` chạy `redactSecretsOnly` lên chuỗi nhận được (idempotent) dù bộ thực thi đã làm sạch — lớp thứ hai.
 *  2. Thư mục riêng dưới `os.tmpdir()` (temp của tài khoản chạy máy chủ), NGOÀI gốc dự án (kiểm hai chiều bằng realpath); tệp tên ngẫu nhiên 128-bit,
 *     mở cờ 'wx' (không ghi đè) mode 0o600. ⚠ Windows: mode 0o600/0o700 gần như KHÔNG có tác dụng (quyền do ACL). Rào thật = ACL mặc định của
 *     thư mục temp tài khoản (chủ + SYSTEM/Admin) + tên không đoán được + model không bao giờ thấy đường dẫn. Chấp nhận (quyết định dieu-phoi 2026-10-31).
 *  3. Model chỉ thấy MÃ; mã gắn `runId` của lượt tạo ⇒ `doc` của lượt khác (cha↔con, lượt khác người) = "không tồn tại", CÙNG câu với mã bịa.
 *  4. Trần: 2 MB/tệp (quá ⇒ lưu phần đầu, ghi nhận bị cắt), 8 tệp & 16 MB/lượt, 64 MB tổng kho, TTL 2 giờ. Quá ⇒ `luu` trả null (lõi nói "không lưu được").
 *  5. Dọn: `donLuot(runId)` khi lượt kết thúc; TTL quét mỗi lần `luu`; lúc khởi động quét thư mục tiến trình KHÁC đã chết.
 *     ⚠ KHÔNG dựa `kill(pid,0)` (PID Windows bị tái dùng — bài học VRAM pha 3). Mỗi thư mục có tên `p<pid>-<bắt đầu tiến trình>-<nonce>` và TỆP NHỊP
 *     `.nhip` được chủ chạm mtime mỗi 30 s; thư mục bị coi là của tiến trình đã chết khi `.nhip` im > 10 phút (không có `.nhip`: mtime thư mục). KHÔNG dùng tuổi thư mục: một máy chủ sống > 24 giờ vẫn nhịp mỗi 30 s. Không tệp
 *     khoá "giữ mở" vì libuv mở tệp với FILE_SHARE_DELETE trên Windows (xoá được tệp đang mở) — nhịp mtime mới là tín hiệu đáng tin.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { redactSecretsOnly } from "../aiSafety";

export const TRAN_BYTE_MOT_TEP = 2_000_000;
export const TRAN_TEP_MOI_LUOT = 8;
export const TRAN_BYTE_MOI_LUOT = 16_000_000;
export const TRAN_BYTE_TONG_KHO = 64_000_000;
export const TTL_MS = 2 * 60 * 60_000;
export const NHIP_MS = 30_000;
export const IM_NHIP_TOI_DA_MS = 10 * 60_000;
export const TRAN_KY_TU_DOC = 12_000;
export const TRAN_DONG_GREP = 50;
export const TRAN_DONG_MAC_DINH = 200;
const TEN_GOC = "thoca-dau-ra";
const RE_THU_MUC = /^p\d+-\d+-[0-9a-f]{8}$/;
const RE_MA = /^out-[0-9a-f]{8}$/;

export interface PhuThuocKho {
  /** gốc chứa thư mục kho; mặc định `os.tmpdir()` */
  tmp?: string;
  /** gốc dự án để loại trừ (kho KHÔNG được nằm trong gốc dự án và ngược lại) */
  gocDuAn?: string;
  bayGio?: () => number;
  pid?: number;
  /** thời điểm bắt đầu tiến trình (ms) — mặc định suy từ `process.uptime()` */
  batDauTienTrinh?: number;
  /** tắt nhịp tự động (lưới) */
  khongNhip?: boolean;
}

export type KetQuaDocDauRa = { ok: true; text: string } | { ok: false };

export interface KhoDauRaDai {
  /** Lưu `noiDung` (sẽ được che lại). Trả mã tham chiếu, hoặc null khi không lưu được (trần/lỗi/kho tắt). Không ném. */
  luu(y: { runId: string; ten: string; noiDung: string }): string | null;
  /** Đọc theo dòng / grep; sai lượt hoặc mã lạ ⇒ `{ok:false}`. Không ném. */
  doc(runId: string, ma: string, tuyChon: { startLine?: number; endLine?: number; grep?: string }): KetQuaDocDauRa;
  /** Xoá mọi tệp của lượt này. */
  donLuot(runId: string): void;
  /** Xoá thư mục của chính tiến trình này + dừng nhịp (tắt máy chủ / lưới). */
  dongKho(): void;
  /** Quét thư mục của tiến trình KHÁC đã chết; trả số thư mục đã xoá. */
  quetRac(): number;
  /** (lưới) đường thư mục kho của tiến trình này, `null` nếu chưa tạo / kho tắt. */
  thuMuc(): string | null;
  /** Kho có hợp lệ với gốc dự án `goc` không (kho không chồng gốc, gốc không nằm trong kho)? Tạo thư mục kho nếu cần. Sai ⇒ lượt đó KHÔNG dùng kho. */
  hopLeVoiGoc(goc: string): boolean;
}

interface Meta {
  runId: string;
  tep: string;
  byte: number;
  luc: number;
  biCat: boolean;
}

/** `a` nằm trong (hoặc bằng) `b`? (so realpath, không phân biệt hoa thường trên Windows) */
function namTrong(a: string, b: string): boolean {
  const chuan = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);
  const rel = path.relative(chuan(b), chuan(a));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function thucPath(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

export function taoKhoDauRaDai(dep: PhuThuocKho = {}): KhoDauRaDai {
  const bayGio = dep.bayGio ?? Date.now;
  const pid = dep.pid ?? process.pid;
  const batDau = dep.batDauTienTrinh ?? Math.round(Date.now() - process.uptime() * 1000);
  const meta = new Map<string, Meta>();
  let thuMuc: string | null = null;
  let tat = false; // một lần thất bại an toàn (đường kho không hợp lệ) ⇒ tắt hẳn, không thử lại
  let nhip: ReturnType<typeof setInterval> | null = null;
  let daQuetKhoiDong = false;

  const gocKho = (): string => path.join(dep.tmp ?? os.tmpdir(), TEN_GOC);

  /** Thư mục vừa tạo không hợp lệ ⇒ xoá, tắt kho hẳn (không thử lại), trả null. */
  function huyKho(dir: string): null {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    tat = true;
    return null;
  }

  /** Tạo thư mục kho của tiến trình (lười). Kiểm: dưới tmp thật, NGOÀI gốc dự án. */
  function baoDamThuMuc(): string | null {
    if (tat) return null;
    if (thuMuc) return thuMuc;
    try {
      fs.mkdirSync(gocKho(), { recursive: true, mode: 0o700 });
      const ten = `p${pid}-${batDau}-${randomBytes(4).toString("hex")}`;
      const dir = path.join(gocKho(), ten);
      fs.mkdirSync(dir, { mode: 0o700 });
      const thuc = thucPath(dir);
      const tmpThuc = thucPath(dep.tmp ?? os.tmpdir());
      if (!thuc || !tmpThuc || !namTrong(thuc, tmpThuc)) return huyKho(dir); // kho ngoài tmp
      if (dep.gocDuAn) {
        const du = thucPath(dep.gocDuAn);
        if (du && (namTrong(thuc, du) || namTrong(du, thuc))) return huyKho(dir); // kho chồng gốc dự án
      }
      fs.writeFileSync(path.join(dir, ".nhip"), String(bayGio()), { mode: 0o600 });
      thuMuc = dir;
      if (!dep.khongNhip) {
        nhip = setInterval(() => {
          try {
            const t = new Date(bayGio());
            fs.utimesSync(path.join(dir, ".nhip"), t, t);
          } catch {
            /* thư mục mất ⇒ bỏ qua */
          }
        }, NHIP_MS);
        nhip.unref?.();
      }
      return dir;
    } catch {
      tat = true;
      return null;
    }
  }

  function xoaTep(m: Meta): void {
    try {
      fs.rmSync(m.tep, { force: true });
    } catch {
      /* best-effort */
    }
  }

  function hetHan(): void {
    const now = bayGio();
    for (const [ma, m] of meta) {
      if (now - m.luc > TTL_MS) {
        xoaTep(m);
        meta.delete(ma);
      }
    }
  }

  function quetRac(): number {
    let xoa = 0;
    try {
      const goc = gocKho();
      if (!fs.existsSync(goc)) return 0;
      const now = bayGio();
      for (const ten of fs.readdirSync(goc)) {
        if (!RE_THU_MUC.test(ten)) continue;
        const dir = path.join(goc, ten);
        if (thuMuc && path.resolve(dir) === path.resolve(thuMuc)) continue; // của mình
        let st: fs.Stats;
        try {
          st = fs.statSync(dir);
        } catch {
          continue;
        }
        if (!st.isDirectory()) continue;
        // Tiến trình SỐNG chạm `.nhip` mỗi 30 s ⇒ thư mục của nó không bao giờ "im nhịp" > 10 phút (kể cả máy chủ sống > 24 giờ). Không có `.nhip`
        // (hỏng / chưa kịp tạo) ⇒ dùng mtime thư mục. Một tín hiệu duy nhất, không dùng tuổi thư mục (sẽ xoá nhầm máy chủ sống lâu).
        let nhipLuc = st.mtimeMs;
        try {
          nhipLuc = fs.statSync(path.join(dir, ".nhip")).mtimeMs;
        } catch {
          /* dùng mtime thư mục */
        }
        if (now - nhipLuc > IM_NHIP_TOI_DA_MS) {
          try {
            fs.rmSync(dir, { recursive: true, force: true });
            xoa++;
          } catch {
            /* best-effort */
          }
        }
      }
    } catch {
      /* best-effort */
    }
    return xoa;
  }

  return {
    luu(y) {
      try {
        const dir = baoDamThuMuc();
        if (!dir) return null;
        if (!daQuetKhoiDong) {
          daQuetKhoiDong = true;
          quetRac();
        }
        hetHan();
        const che = redactSecretsOnly(String(y.noiDung ?? "")).text;
        let biCat = false;
        let buf = Buffer.from(che, "utf8");
        if (buf.length > TRAN_BYTE_MOT_TEP) {
          buf = buf.subarray(0, TRAN_BYTE_MOT_TEP);
          biCat = true;
        }
        let tepLuot = 0;
        let byteLuot = 0;
        let byteTong = 0;
        for (const m of meta.values()) {
          byteTong += m.byte;
          if (m.runId === y.runId) {
            tepLuot++;
            byteLuot += m.byte;
          }
        }
        if (tepLuot >= TRAN_TEP_MOI_LUOT || byteLuot + buf.length > TRAN_BYTE_MOI_LUOT || byteTong + buf.length > TRAN_BYTE_TONG_KHO) return null;
        let ma = "";
        do ma = `out-${randomBytes(4).toString("hex")}`;
        while (meta.has(ma));
        const tep = path.join(dir, `${randomBytes(16).toString("hex")}.txt`);
        const fd = fs.openSync(tep, "wx", 0o600);
        try {
          fs.writeSync(fd, buf);
        } finally {
          fs.closeSync(fd);
        }
        meta.set(ma, { runId: y.runId, tep, byte: buf.length, luc: bayGio(), biCat });
        return ma;
      } catch {
        return null;
      }
    },

    doc(runId, ma, tuyChon) {
      try {
        if (!RE_MA.test(ma)) return { ok: false };
        const m = meta.get(ma);
        if (!m || m.runId !== runId) return { ok: false };
        const dong = fs.readFileSync(m.tep, "utf8").split(/\r?\n/);
        const tong = dong.length;
        const dau = Math.max(1, Math.floor(tuyChon.startLine ?? 1));
        const nhan = `${ma} (${tong} lines${m.biCat ? "; stored truncated at 2 MB" : ""})`;
        if (tuyChon.grep !== undefined && tuyChon.grep !== "") {
          const kim = tuyChon.grep.toLowerCase();
          const khop: string[] = [];
          let tongKhop = 0;
          dong.forEach((d, i) => {
            if (!d.toLowerCase().includes(kim)) return;
            tongKhop++;
            if (khop.length < TRAN_DONG_GREP) khop.push(`${i + 1}\t${d}`);
          });
          const duoi = tongKhop > khop.length ? `\n[… ${tongKhop - khop.length} more matching lines; narrow the pattern]` : "";
          return { ok: true, text: cat(`${nhan}; grep "${tuyChon.grep}": ${tongKhop} matching lines\n${khop.join("\n")}${duoi}`) };
        }
        const cuoi = Math.min(tong, Math.max(dau, Math.floor(tuyChon.endLine ?? dau + TRAN_DONG_MAC_DINH - 1)));
        if (dau > tong) return { ok: true, text: `${nhan}; start_line ${dau} is past the end` };
        const phan = dong.slice(dau - 1, cuoi).map((d, i) => `${dau + i}\t${d}`);
        const tiep = cuoi < tong ? `\n[… continues at line ${cuoi + 1}; read more with start_line/end_line]` : "";
        return { ok: true, text: cat(`${nhan}; showing lines ${dau}-${cuoi}\n${phan.join("\n")}${tiep}`) };
      } catch {
        return { ok: false };
      }
    },

    donLuot(runId) {
      for (const [ma, m] of meta) {
        if (m.runId !== runId) continue;
        xoaTep(m);
        meta.delete(ma);
      }
    },

    dongKho() {
      if (nhip) clearInterval(nhip);
      nhip = null;
      meta.clear();
      if (thuMuc) {
        try {
          fs.rmSync(thuMuc, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
        thuMuc = null;
      }
    },

    quetRac,
    thuMuc: () => thuMuc,
    hopLeVoiGoc(goc) {
      const dir = baoDamThuMuc();
      if (!dir) return false;
      const thuc = thucPath(dir);
      const du = thucPath(goc);
      if (!thuc || !du) return false;
      return !(namTrong(thuc, du) || namTrong(du, thuc));
    },
  };
}

function cat(s: string): string {
  return s.length <= TRAN_KY_TU_DOC ? s : `${s.slice(0, TRAN_KY_TU_DOC)}\n[… output cut at ${TRAN_KY_TU_DOC} characters; narrow with start_line/end_line or grep]`;
}

/** Công tắc `AI_AGENT_DAU_RA_DAI`: chỉ "1" bật (MẶC ĐỊNH TẮT). */
export function dauRaDaiBat(giaTri: string | undefined): boolean {
  return giaTri === "1";
}
