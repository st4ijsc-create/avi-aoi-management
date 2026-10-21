/**
 * ★★ Đợt 9.2 — SO SÁNH HAI LƯỢT CHẠY của Luồng AI (THUẦN: client tự gọi `flow.dongThoiGian` hai lần rồi so; không thủ tục mới).
 *
 *   • Khớp bước theo `nodeId#lan`; nhiều lần thử (`lanThu`) cùng khoá ⇒ lấy lần thử CUỐI (kết quả có hiệu lực).
 *   • Mỗi bước: khác trạng thái? · thời gian hai bên + chênh · khác đầu vào / đầu ra / lỗi theo ĐƯỜNG DẪN JSON (`$.main[0].json.a`).
 *   • Bước chỉ có một bên ⇒ `chi-a` / `chi-b`. Dữ liệu đã bị máy chủ cắt (`__catBot`) ⇒ `catBot=true`: KHÔNG khẳng định từng
 *     trường giống/khác (cắt rồi thì không biết).
 */

export interface BuocTho {
  nodeId: string;
  lan: number;
  lanThu: number;
  status: string;
  startedAt?: string | Date | null;
  finishedAt?: string | Date | null;
  input: unknown;
  output: unknown;
  error: unknown;
}

export interface LuotTho {
  run: { id: string; version: number; status: string; startedAt?: string | Date | null; finishedAt?: string | Date | null };
  buoc: BuocTho[];
}

export interface MucKhac {
  duong: string;
  loai: "doi" | "them" | "bo";
  a: unknown;
  b: unknown;
}

export interface KetQuaKhacJson {
  muc: MucKhac[];
  /** Một bên là bản đã bị cắt ở máy chủ ⇒ không so từng trường. */
  catBot: boolean;
  /** Danh sách bị chặn (quá nhiều mục / quá sâu) ⇒ có thể còn khác biệt chưa liệt kê. */
  bi: boolean;
}

export interface BuocSoSanh {
  khoa: string;
  nodeId: string;
  lan: number;
  ket: "giong" | "khac" | "chi-a" | "chi-b";
  trangThaiA: string | null;
  trangThaiB: string | null;
  khacTrangThai: boolean;
  msA: number | null;
  msB: number | null;
  /** B − A (ms); null nếu một bên chưa có thời gian. */
  chenhMs: number | null;
  khacVao: KetQuaKhacJson;
  khacRa: KetQuaKhacJson;
  khacLoi: KetQuaKhacJson;
}

export interface KetQuaSoSanh {
  cacBuoc: BuocSoSanh[];
  tomTat: { giong: number; khac: number; chiA: number; chiB: number };
  khacPhienBan: boolean;
  khacTrangThaiLuot: boolean;
  msLuotA: number | null;
  msLuotB: number | null;
}

export const TRAN_MUC_KHAC = 50;
const DO_SAU_TOI_DA = 32;
const TRAN_GON = 300;

const laDoiTuong = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const laCatBot = (v: unknown): boolean => laDoiTuong(v) && v.__catBot === true;

/** Giá trị hiển thị gọn: chuỗi JSON dài bị cắt (khác biệt kiểu đối tượng↔nguyên thuỷ có thể mang cả cây). */
function gon(v: unknown): unknown {
  if (v === undefined || v === null || typeof v !== "object") return typeof v === "string" && v.length > TRAN_GON ? `${v.slice(0, TRAN_GON)}…` : v;
  const s = JSON.stringify(v);
  return s.length > TRAN_GON ? `${s.slice(0, TRAN_GON)}…` : v;
}

export function khacJson(a: unknown, b: unknown, tran = TRAN_MUC_KHAC): KetQuaKhacJson {
  const ra: KetQuaKhacJson = { muc: [], catBot: false, bi: false };
  if (laCatBot(a) || laCatBot(b)) {
    // hai bên đều là bản cắt giống hệt nhau thì vẫn "giống"; còn lại không kết luận được
    if (JSON.stringify(a) === JSON.stringify(b)) return ra;
    ra.catBot = true;
    return ra;
  }
  const them = (m: MucKhac): boolean => {
    if (ra.muc.length >= tran) {
      ra.bi = true;
      return false;
    }
    ra.muc.push({ ...m, a: gon(m.a), b: gon(m.b) });
    return true;
  };
  const di = (x: unknown, y: unknown, duong: string, sau: number): void => {
    if (ra.bi) return;
    if (sau > DO_SAU_TOI_DA) {
      ra.bi = true;
      return;
    }
    if (Array.isArray(x) && Array.isArray(y)) {
      const n = Math.max(x.length, y.length);
      for (let i = 0; i < n; i++) {
        const d = `${duong}[${i}]`;
        if (i >= x.length) them({ duong: d, loai: "them", a: undefined, b: y[i] });
        else if (i >= y.length) them({ duong: d, loai: "bo", a: x[i], b: undefined });
        else di(x[i], y[i], d, sau + 1);
        if (ra.bi) return;
      }
      return;
    }
    if (laDoiTuong(x) && laDoiTuong(y)) {
      const khoa = new Set([...Object.keys(x), ...Object.keys(y)]);
      for (const k of khoa) {
        const d = `${duong}.${k}`;
        const coX = k in x && x[k] !== undefined;
        const coY = k in y && y[k] !== undefined;
        if (coX && !coY) them({ duong: d, loai: "bo", a: x[k], b: undefined });
        else if (!coX && coY) them({ duong: d, loai: "them", a: undefined, b: y[k] });
        else if (coX && coY) di(x[k], y[k], d, sau + 1);
        if (ra.bi) return;
      }
      return;
    }
    if (x === y) return;
    if (typeof x === "number" && typeof y === "number" && Number.isNaN(x) && Number.isNaN(y)) return;
    them({ duong, loai: "doi", a: x, b: y });
  };
  di(a, b, "$", 0);
  return ra;
}

const ms = (a?: string | Date | null, b?: string | Date | null): number | null => {
  if (!a || !b) return null;
  const d = new Date(b).getTime() - new Date(a).getTime();
  return Number.isFinite(d) && d >= 0 ? d : null;
};

/** Bước có hiệu lực theo `nodeId#lan`: lần thử cao nhất. Giữ thứ tự xuất hiện đầu tiên của khoá. */
function theoKhoa(buoc: readonly BuocTho[]): Map<string, BuocTho> {
  const m = new Map<string, BuocTho>();
  for (const b of buoc) {
    const k = `${b.nodeId}#${b.lan}`;
    const cu = m.get(k);
    if (!cu) m.set(k, b);
    else if (b.lanThu >= cu.lanThu) m.set(k, b); // Map giữ vị trí chèn đầu tiên khi ghi đè
  }
  return m;
}

const RONG: KetQuaKhacJson = { muc: [], catBot: false, bi: false };

export function soSanhLuot(a: LuotTho, b: LuotTho): KetQuaSoSanh {
  const ma = theoKhoa(a.buoc);
  const mb = theoKhoa(b.buoc);
  const khoa = [...ma.keys(), ...[...mb.keys()].filter((k) => !ma.has(k))];
  const cacBuoc: BuocSoSanh[] = khoa.map((k) => {
    const x = ma.get(k);
    const y = mb.get(k);
    const ref = (x ?? y)!;
    const msA = x ? ms(x.startedAt, x.finishedAt) : null;
    const msB = y ? ms(y.startedAt, y.finishedAt) : null;
    const base = {
      khoa: k, nodeId: ref.nodeId, lan: ref.lan, trangThaiA: x?.status ?? null, trangThaiB: y?.status ?? null, msA, msB,
      chenhMs: msA !== null && msB !== null ? msB - msA : null,
    };
    if (!x || !y) {
      return { ...base, ket: x ? ("chi-a" as const) : ("chi-b" as const), khacTrangThai: false, khacVao: RONG, khacRa: RONG, khacLoi: RONG };
    }
    const khacTrangThai = x.status !== y.status;
    const khacVao = khacJson(x.input, y.input);
    const khacRa = khacJson(x.output, y.output);
    const khacLoi = khacJson(x.error, y.error);
    const khac = khacTrangThai || [khacVao, khacRa, khacLoi].some((d) => d.muc.length > 0 || d.catBot || d.bi);
    return { ...base, ket: khac ? ("khac" as const) : ("giong" as const), khacTrangThai, khacVao, khacRa, khacLoi };
  });
  const dem = (ket: BuocSoSanh["ket"]) => cacBuoc.filter((c) => c.ket === ket).length;
  return {
    cacBuoc,
    tomTat: { giong: dem("giong"), khac: dem("khac"), chiA: dem("chi-a"), chiB: dem("chi-b") },
    khacPhienBan: a.run.version !== b.run.version,
    khacTrangThaiLuot: a.run.status !== b.run.status,
    msLuotA: ms(a.run.startedAt, a.run.finishedAt),
    msLuotB: ms(b.run.startedAt, b.run.finishedAt),
  };
}
