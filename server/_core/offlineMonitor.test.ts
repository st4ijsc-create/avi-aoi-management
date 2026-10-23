/**
 * ★ H1b (2026-10-23) — `machine:offline_alert` phát MỘT lần MỖI ĐỢT offline (trước: mỗi chu kỳ 60 s phát lại cho mọi máy offline chưa gửi ⇒ 3.400 tin / 75 s).
 * Bộ phát (`phatTheoNhaMay`) được thay bằng bản ghi để ĐẾM số lần phát; DB / thông báo giả. Ngữ nghĩa gửi thông báo (`notifyOwner`, `markOfflineNotificationSent`) phải GIỮ NGUYÊN.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const phat = vi.fn();
vi.mock("./socketPhatTheoNhaMay", () => ({ phatTheoNhaMay: (...a: unknown[]) => phat(...a) }));
vi.mock("./socket", () => ({ getIO: () => ({ fake: true }) }));
let daCauHinh = false;
const notifyOwner = vi.fn(async () => false);
vi.mock("./notification", () => ({ notificationConfigured: () => daCauHinh, notifyOwner: (...a: unknown[]) => notifyOwner(...(a as [never])) }));
let danhSach: Array<{ log: { id: number; timestamp: Date; ipAddress: string | null }; machine: { id: number; code: string; name: string } }> = [];
const markSent = vi.fn(async () => undefined);
vi.mock("../db", () => ({
  getUnnotifiedOfflineMachines: vi.fn(async () => danhSach),
  markOfflineNotificationSent: (...a: unknown[]) => markSent(...(a as [never])),
}));

import { __quenDotOfflineChoTest, checkOfflineMachines } from "./offlineMonitor";

const may = (logId: number, machineId = 1) => ({
  log: { id: logId, timestamp: new Date(Date.now() - 10 * 60_000), ipAddress: "1.2.3.4" },
  machine: { id: machineId, code: `M${machineId}`, name: `May ${machineId}` },
});
const soLanPhat = () => phat.mock.calls.filter((c) => c[1] === "machine:offline_alert").length;

beforeEach(() => {
  phat.mockClear();
  notifyOwner.mockClear();
  markSent.mockClear();
  daCauHinh = false;
  danhSach = [];
  __quenDotOfflineChoTest();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("machine:offline_alert — một lần mỗi đợt", () => {
  it("MƯỜI chu kỳ liên tục với thông báo CHƯA cấu hình (không máy nào được đánh dấu đã gửi) ⇒ ĐÚNG MỘT lần phát", async () => {
    danhSach = [may(100)];
    for (let i = 0; i < 10; i++) await checkOfflineMachines();
    expect(soLanPhat()).toBe(1);
    expect(markSent).not.toHaveBeenCalled(); // không gửi được thì không được nói là đã gửi
    expect(notifyOwner).not.toHaveBeenCalled(); // chưa cấu hình ⇒ bỏ bước gửi (hành vi cũ)
    // phát theo PHÒNG NHÀ MÁY: nhà máy tra từ machineId/machineCode, không còn `io.to("admin")`
    expect(phat.mock.calls[0][3]).toEqual({ machineId: 1, machineCode: "M1" });
    expect(phat.mock.calls[0][2]).toMatchObject({ machineId: 1, machineCode: "M1", machineName: "May 1", offlineDurationMinutes: 10 });
  });

  it("nhiều máy: mỗi máy MỘT lần; máy mới offline giữa chừng ⇒ phát cho máy mới, không phát lại máy cũ", async () => {
    danhSach = [may(100, 1), may(101, 2)];
    for (let i = 0; i < 5; i++) await checkOfflineMachines();
    expect(soLanPhat()).toBe(2);
    danhSach = [may(100, 1), may(101, 2), may(102, 3)];
    for (let i = 0; i < 5; i++) await checkOfflineMachines();
    expect(soLanPhat()).toBe(3);
  });

  it("máy ONLINE lại (rời danh sách) rồi OFFLINE lần nữa (hàng nhật ký MỚI) ⇒ phát lần thứ hai", async () => {
    danhSach = [may(100)];
    for (let i = 0; i < 3; i++) await checkOfflineMachines();
    expect(soLanPhat()).toBe(1);
    danhSach = []; // online lại
    await checkOfflineMachines();
    danhSach = [may(200)]; // đợt offline MỚI = hàng nhật ký mới
    for (let i = 0; i < 3; i++) await checkOfflineMachines();
    expect(soLanPhat()).toBe(2);
  });

  it("đợt kết thúc khi máy rời danh sách dù danh sách KHÁC rỗng (máy khác vẫn offline): cùng log.id quay lại ⇒ phát lại (đợt đã quên)", async () => {
    danhSach = [may(100, 1), may(101, 2)];
    await checkOfflineMachines();
    danhSach = [may(101, 2)]; // máy 1 online lại, máy 2 vẫn offline
    await checkOfflineMachines();
    expect(soLanPhat()).toBe(2);
    danhSach = [may(100, 1), may(101, 2)]; // máy 1 offline lại (ở đây trùng log.id cũ chỉ để chứng minh bộ nhớ đã quên đợt trước)
    await checkOfflineMachines();
    expect(soLanPhat()).toBe(3); // máy 1 phát lại; máy 2 KHÔNG (đợt chưa kết thúc)
  });

  it("gửi thông báo GIỮ NGUYÊN nghĩa: cấu hình + gửi được ⇒ đánh dấu đã gửi; cấu hình + hỏng ⇒ KHÔNG đánh dấu (và vẫn phát WebSocket đúng một lần)", async () => {
    daCauHinh = true;
    danhSach = [may(100, 1), may(101, 2)];
    notifyOwner.mockReset();
    notifyOwner.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValue(false); // máy 1 gửi được, máy 2 hỏng, các chu kỳ sau hỏng
    await checkOfflineMachines();
    expect(markSent).toHaveBeenCalledTimes(1);
    expect(markSent).toHaveBeenCalledWith(100);
    await checkOfflineMachines();
    expect(soLanPhat()).toBe(2); // mỗi máy MỘT lần dù thông báo thành/hỏng
  });
});
