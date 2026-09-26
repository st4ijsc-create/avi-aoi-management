/**
 * doc 81 Đợt 1B Task 9 (BE3 §L4b) — GIỚI HẠN TẦN SUẤT sự kiện `machine:*` trên socket.io.
 *
 * ĐO ĐƯỢC (BE3 §L4b, Backpressure M1): bão 1.000 `machine:confirm_mapping` từ socket vô danh ⇒
 * 1.000 INSERT `machine_status_logs`, pool DB 25 bão hoà, một request ingest treo 18,3 s. Xác thực
 * (socketMachineAuth) chặn socket VÔ DANH ghi DB, nhưng một socket ĐÃ xác thực (hoặc chế độ `off`)
 * vẫn bão được — và chính lượt xác thực cũng tốn truy vấn DB. Nên giới hạn tần suất đứng TRƯỚC mọi
 * handler `machine:*` (socket.use trong socket.ts), ở CẢ BA chế độ auth.
 *
 * Hai lớp độc lập, cùng là xô token (dung lượng = tốc độ/giây, nạp liên tục):
 *   • theo SOCKET — một kết nối không bão được;
 *   • theo IP     — nhiều kết nối từ một nguồn không cộng dồn thành bão.
 * Gói vượt ngưỡng bị BỎ (không handler nào chạy ⇒ không ghi DB) và ĐẾM; log GỘP toàn cục
 * (tối đa 1 dòng / LOG_GOP_MS), không in payload (không có apiKey trong log).
 *
 * `0` ở một cờ = tắt lớp đó (lối thoát cho người vận hành, cùng nghĩa với các cờ *_RATE_LIMIT khác).
 */

/** Mặc định mỗi socket: 10 sự kiện `machine:*`/giây (máy chuẩn nhịp 30 s dùng < 0,1/giây). */
export const MAC_DINH_SU_KIEN_MAY_MOI_SOCKET_MOI_GIAY = 10;
/**
 * Mặc định mỗi IP: 50/giây. Lớn hơn mức mỗi socket vì một gateway/NAT có thể mang nhiều máy trên
 * MỘT IP: 50/giây ⇒ ~1.500 máy nhịp 30 s sau cùng một IP, hoặc ~16 máy nối lại cùng lúc
 * (confirm_mapping + request_config + sync_started) trong một giây mà không mất gói.
 */
export const MAC_DINH_SU_KIEN_MAY_MOI_IP_MOI_GIAY = 50;

const LOG_GOP_MS = 10_000;
const XO_IP_MAX = 10_000;
const XO_IP_NHAN_ROI_MS = 60_000;

function docSoKhongAm(ten: string, macDinh: number): number {
  const raw = process.env[ten];
  if (raw === undefined || raw.trim() === "") return macDinh;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : macDinh;
}

/** `SOCKET_MACHINE_EVENT_RATE_PER_SOCKET` (mặc định 10; 0 = tắt lớp socket). Đọc lúc GỌI. */
export function gioiHanSuKienMayMoiSocket(): number {
  return docSoKhongAm("SOCKET_MACHINE_EVENT_RATE_PER_SOCKET", MAC_DINH_SU_KIEN_MAY_MOI_SOCKET_MOI_GIAY);
}

/** `SOCKET_MACHINE_EVENT_RATE_PER_IP` (mặc định 50; 0 = tắt lớp IP). Đọc lúc GỌI. */
export function gioiHanSuKienMayMoiIp(): number {
  return docSoKhongAm("SOCKET_MACHINE_EVENT_RATE_PER_IP", MAC_DINH_SU_KIEN_MAY_MOI_IP_MOI_GIAY);
}

interface Xo {
  token: number;
  moc: number;
}

const xoSocket = new Map<string, Xo>();
const xoIp = new Map<string, Xo>();

/** Nạp xô tới `bayGio` (tạo mới = đầy). Trả về xô — CHƯA trừ token. */
function napXo(bang: Map<string, Xo>, khoa: string, tocDo: number, bayGio: number): Xo {
  let xo = bang.get(khoa);
  if (!xo) {
    xo = { token: tocDo, moc: bayGio };
    bang.set(khoa, xo);
    return xo;
  }
  const troi = Math.max(0, bayGio - xo.moc);
  xo.token = Math.min(tocDo, xo.token + (troi * tocDo) / 1000);
  xo.moc = bayGio;
  return xo;
}

function donXoIp(bayGio: number): void {
  if (xoIp.size <= XO_IP_MAX) return;
  for (const [k, xo] of xoIp) if (bayGio - xo.moc > XO_IP_NHAN_ROI_MS) xoIp.delete(k);
  if (xoIp.size > XO_IP_MAX) xoIp.clear(); // vẫn đầy (bão IP giả) ⇒ xoá hết: tệ nhất là 1 giây đầy xô
}

// ── đếm + log gộp ──────────────────────────────────────────────────────────────
let tongBoQua = 0;
let boQuaTheoSocket = 0;
let boQuaTheoIp = 0;
let boQuaTheoHandshake = 0;
let choLog = 0;
const socketChoLog = new Set<string>();
let lanLogCuoi = 0;

function ghiBoQua(lop: "socket" | "ip" | "handshake", socketId: string | null, ip: string, bayGio: number): void {
  tongBoQua += 1;
  if (lop === "socket") boQuaTheoSocket += 1;
  else if (lop === "ip") boQuaTheoIp += 1;
  else boQuaTheoHandshake += 1;
  choLog += 1;
  if (socketId && socketChoLog.size < 1000) socketChoLog.add(socketId);
  if (bayGio - lanLogCuoi < LOG_GOP_MS) return;
  lanLogCuoi = bayGio;
  console.warn(
    `[Socket.io] GIOI HAN machine:* - bo qua ${choLog} goi tu ${socketChoLog.size} socket ` +
      `(lop cuoi=${lop}, ip cuoi=${JSON.stringify(ip)}; tong tu luc khoi dong=${tongBoQua}; ` +
      `nguong socket=${gioiHanSuKienMayMoiSocket()}/s ip=${gioiHanSuKienMayMoiIp()}/s)`,
  );
  choLog = 0;
  socketChoLog.clear();
}

/**
 * Một gói `machine:*` từ `socketId`@`ip` có được xử lý không. Kiểm CẢ HAI lớp trước, chỉ trừ token
 * khi cả hai còn (gói bị lớp IP chặn không ăn token của socket và ngược lại).
 */
export function choPhepSuKienMay(socketId: string, ip: string, bayGio: number = Date.now()): boolean {
  const tocSocket = gioiHanSuKienMayMoiSocket();
  const tocIp = gioiHanSuKienMayMoiIp();
  const xs = tocSocket > 0 ? napXo(xoSocket, socketId, tocSocket, bayGio) : null;
  const xi = tocIp > 0 ? napXo(xoIp, ip, tocIp, bayGio) : null;
  if (xs && xs.token < 1) {
    ghiBoQua("socket", socketId, ip, bayGio);
    return false;
  }
  if (xi && xi.token < 1) {
    ghiBoQua("ip", socketId, ip, bayGio);
    return false;
  }
  if (xs) xs.token -= 1;
  if (xi) xi.token -= 1;
  if (xi) donXoIp(bayGio);
  return true;
}

/**
 * Handshake socket máy CÓ trình thông tin xác thực ⇒ tra DB. Ăn chung xô IP với sự kiện
 * `machine:*` để một vòng nối-lại-liên-tục bằng khoá sai không thành bão truy vấn DB.
 */
export function choPhepXacThucHandshakeMay(ip: string, bayGio: number = Date.now()): boolean {
  const tocIp = gioiHanSuKienMayMoiIp();
  if (tocIp <= 0) return true;
  const xi = napXo(xoIp, ip, tocIp, bayGio);
  if (xi.token < 1) {
    ghiBoQua("handshake", null, ip, bayGio);
    return false;
  }
  xi.token -= 1;
  donXoIp(bayGio);
  return true;
}

/** Socket ngắt ⇒ bỏ xô của nó (xô IP giữ lại: nối lại không được "nạp đầy" miễn phí). */
export function giaiPhongSocketMay(socketId: string): void {
  xoSocket.delete(socketId);
}

export interface ThongKeGioiHanSuKienMay {
  boQua: number;
  boQuaTheoSocket: number;
  boQuaTheoIp: number;
  boQuaTheoHandshake: number;
}

/** Bộ đếm từ lúc khởi động (bản sao chỉ đọc). */
export function thongKeGioiHanSuKienMay(): ThongKeGioiHanSuKienMay {
  return { boQua: tongBoQua, boQuaTheoSocket, boQuaTheoIp, boQuaTheoHandshake };
}

/** Chỉ cho test. */
export function _resetGioiHanSuKienMay(): void {
  xoSocket.clear();
  xoIp.clear();
  tongBoQua = 0;
  boQuaTheoSocket = 0;
  boQuaTheoIp = 0;
  boQuaTheoHandshake = 0;
  choLog = 0;
  socketChoLog.clear();
  lanLogCuoi = 0;
}
