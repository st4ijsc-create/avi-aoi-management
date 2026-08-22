/**
 * F3 Pha 1 — LỖI THIẾT BỊ TỰ MANG MÃ MÁY-ĐỌC-ĐƯỢC.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÌ SAO LÀ LỚP LỖI, KHÔNG PHẢI `appError()`
 * ══════════════════════════════════════════════════════════════════════════════════
 * `appError()` dựng một `TRPCError` — kéo `@trpc/server` vào tầng driver, nơi cố ý không
 * biết gì về giao thức truyền tải. Một driver Modbus không nên phụ thuộc tRPC để nói được
 * câu "tôi chưa kết nối".
 *
 * Khuôn đã có sẵn và đã chạy: `DbUnavailableError` (`_core/dbErrors.ts`). tRPC bọc mọi
 * throw không-phải-TRPCError thành `TRPCError({ cause: <lỗi gốc> })`, và
 * `readAppErrorMeta()` đọc `cause.appCode` **và** `cause.appParams`. Nên một lớp lỗi
 * thường mang hai trường đó là đủ để client dịch được — không đổi một dòng nào ở
 * `errorFormatter`.
 *
 * ── CÓ MẤT THÔNG TIN KỸ THUẬT KHÔNG? KHÔNG ──────────────────────────────────────
 * Ở F14 tôi phải trả CẢ HAI (mã + chuỗi thô) vì chuỗi thô mang thông tin mã không có
 * ("ECONNREFUSED 10.0.0.5:502"). Ở đây thì khác: `"ModbusDriver: not connected"` chỉ mang
 * đúng MỘT thông tin — driver nào — và `appParams.entity` đã chở nó rồi.
 * ⇒ Câu dịch *"Không kết nối được tới thiết bị Modbus. Hãy kiểm tra nguồn, dây mạng và
 *   địa chỉ IP."* nói được NHIỀU HƠN cho người vận hành và KHÔNG ÍT HƠN cho kỹ sư.
 * Chỗ nào chuỗi gốc thật sự mang thêm chi tiết (mã lỗi socket, endpoint) thì truyền vào
 * `chiTiet` — nó vào `message`, và `message` chính là `fallback` khi khoá i18n thiếu.
 *
 * ⚠ `name` của hai lớp này là hợp đồng: đừng đổi. Nếu sau này có tầng nào lọc theo
 *   `err.name` (như ingest WAL lọc `DbUnavailableError`), đổi tên sẽ làm bộ lọc mù.
 */

/** Tên thực thể phải là KHOÁ có thật trong `errors.entity.*` (đủ vi/en/zh). */
export type DeviceEntityKey = string;

/**
 * `RobotVendor` → khoá `errors.entity.*`.
 *
 * ⚠ TỒN TẠI VÌ HAI TẬP TÊN KHÔNG TRÙNG NHAU, và trùng một phần mới là chỗ nguy hiểm:
 * `RobotVendor` có `"mitsubishi"` (robot), trong khi `OtProtocol` có `"mitsubishi-mc"`
 * (PLC MELSEC). Dùng thẳng giá trị vendor làm khoá thì `"mitsubishi"` sẽ tra trúng một
 * khoá KHÁC NGHĨA hoặc không có khoá nào — và người dùng đọc *"Không kết nối được tới
 * thiết bị mitsubishi"*, tức định danh thô lọt ra giữa một câu đã dịch.
 *
 * Ánh xạ tường minh cũng là chỗ DUY NHẤT phải sửa khi thêm một hãng robot mới.
 */
export const KHOA_THUC_THE_ROBOT: Record<string, string> = {
  fanuc: "fanucRobot",
  mitsubishi: "mitsubishiRobot",
  delta: "deltaRobot",
  techman: "techmanRobot",
  sim: "simRobot",
  ur: "ursimRobot",
  vda5050: "vda5050Robot",
};

/**
 * Không nói chuyện được với thiết bị: chưa kết nối, mất kết nối, quá hạn, bị từ chối.
 *
 * Cách gỡ mà người vận hành làm được: kiểm nguồn, dây mạng, địa chỉ IP.
 * TÁCH khỏi `DeviceProtocolUnsupportedError` vì cách gỡ NGƯỢC nhau — bảo người vận hành
 * đi ngắt cầu dao trong khi bản dựng đơn giản là không có driver ấy là làm mất thời gian
 * của họ.
 */
export class DeviceUnreachableError extends Error {
  readonly appCode = "DEVICE_UNREACHABLE" as const;
  readonly appParams: { entity: string };

  constructor(entity: DeviceEntityKey, chiTiet?: string) {
    super(chiTiet ? `${entity}: not connected — ${chiTiet}` : `${entity}: not connected`);
    this.name = "DeviceUnreachableError";
    this.appParams = { entity };
  }
}

/**
 * Bản dựng này KHÔNG CÓ driver cho giao thức/hãng đó.
 *
 * Cách gỡ: đổi cấu hình hoặc nâng cấp bản dựng — KHÔNG phải đi kiểm dây.
 */
export class DeviceProtocolUnsupportedError extends Error {
  readonly appCode = "DEVICE_PROTOCOL_UNSUPPORTED" as const;
  readonly appParams: { entity: string };

  constructor(entity: DeviceEntityKey, chiTiet?: string) {
    super(chiTiet ? `${entity}: driver not implemented — ${chiTiet}` : `${entity}: driver not implemented`);
    this.name = "DeviceProtocolUnsupportedError";
    this.appParams = { entity };
  }
}
