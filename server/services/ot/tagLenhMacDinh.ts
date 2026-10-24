/**
 * Tên tag lệnh vòng đời MẶC ĐỊNH mà tool AI máy (`aiLocalTools/writeHandlers/machineControl.ts`) ghi khi không có tag DỪNG ghim và người
 * gọi không chỉ định tag. Tách ra (SCADA R1a Task 12 fix round 1) để M12 (`scadaKenh.danhSach.canhBaoKenhDung`) nhận ra "kênh dừng" bằng
 * CHÍNH tên mà lệnh stop dùng — không đặt thêm mẫu tên nào. Thuần, không import gì (không kéo registry tool AI).
 */
export const TAG_LENH_MAC_DINH = {
  start: "cmd_start",
  stop: "cmd_stop",
  pause: "cmd_pause",
  reset: "cmd_reset",
} as const;

/** Tag mà lệnh stop của tool AI nhắm tới khi máy chưa ghim tag DỪNG. */
export const TAG_DUNG_MAC_DINH = TAG_LENH_MAC_DINH.stop;
