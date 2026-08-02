/** Mức ưu tiên, xếp theo giá trị thật của nhà máy (spec §5.2). */
export type VramPriority = "production" | "interactive" | "background";

export type VramLeaseKind =
  | "gguf-model"
  | "gguf-context"
  | "gguf-embed-context"
  | "onnx-session"
  | "external-process";

/** Ước lượng đến từ đâu — để truy được chỗ nào còn dùng hằng số cấu hình. */
export type VramEstimateSource = "learned" | "file-size" | "config-default";

export interface VramReserveRequest {
  owner: string;
  kind: VramLeaseKind;
  estimatedBytes: number;
  priority: VramPriority;
  /** Bắt buộc cho external-process: thiếu nhịp quá hạn thì reconciler xác minh rồi thu hồi. */
  ttlMs?: number;
  estimateSource?: VramEstimateSource;
}

export interface VramLease {
  id: string;
  request: VramReserveRequest;
  acquiredAt: Date;
  /** null cho tới khi commit(). */
  actualBytes: number | null;
  lastHeartbeatAt: Date;
  released: boolean;
}

export interface VramReserveResult {
  /** Pha 1 luôn khác null. Pha 2 sẽ trả null kèm ném VramRefusedError. */
  lease: VramLease | null;
  /** Pha 2 SẼ từ chối lượt này không? Ghi vào nhật ký để biết bán kính trước khi bật cưỡng chế. */
  wouldRefuse: boolean;
  /** Owner của các giấy phép mà Pha 2 sẽ thu hồi để lấy chỗ. */
  wouldPreempt: string[];
}

export interface VramSnapshot {
  totalReservedBytes: number;
  leases: VramLease[];
}

/** Từ chối trung thực (Pha 2). Định nghĩa sẵn ở Pha 1 để mặt tiếp xúc ổn định. */
export class VramRefusedError extends Error {
  constructor(
    public readonly requestedBytes: number,
    public readonly availableBytes: number,
    public readonly holders: Array<{ owner: string; bytes: number; priority: VramPriority }>,
  ) {
    super(
      `Không đủ VRAM: xin ${Math.round(requestedBytes / 1024 / 1024)} MiB, ` +
        `còn ${Math.round(availableBytes / 1024 / 1024)} MiB. ` +
        `Đang giữ: ${holders.map((h) => `${h.owner}=${Math.round(h.bytes / 1024 / 1024)}MiB(${h.priority})`).join(", ")}`,
    );
    this.name = "VramRefusedError";
  }
}
