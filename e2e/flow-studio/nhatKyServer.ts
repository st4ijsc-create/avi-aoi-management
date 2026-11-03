/**
 * Nhật ký server của instance e2e — NỐI THÊM, không ghi đè (dieu-phoi 2026-11-04, sau lần sụp 0xC0000374 mà log bị lượt chạy sau ghi đè mất).
 * Mỗi lượt mở bằng chế độ 'a' và ghi một dòng đầu có mốc thời gian; `batDau` là độ lệch byte SAU dòng đầu — phép chờ "Server running on …"
 * chỉ đọc từ đó, nếu không dòng của LƯỢT TRƯỚC (cùng cổng) sẽ khớp ngay và instance bị coi là đã lên khi chưa lên.
 */
import fs from "node:fs";

export function moNhatKyNoiThem(logFile: string, nhan: string, bay: () => Date = () => new Date()): { fd: number; batDau: number } {
  const fd = fs.openSync(logFile, "a");
  fs.writeSync(fd, `\n===== [${bay().toISOString()}] ${nhan} =====\n`);
  return { fd, batDau: fs.fstatSync(fd).size };
}

/** Nội dung nhật ký từ `batDau` (độ lệch byte) tới hết. */
export function docNhatKyTuMoc(logFile: string, batDau: number): string {
  const buf = fs.readFileSync(logFile);
  return buf.subarray(Math.min(batDau, buf.length)).toString("utf8");
}
