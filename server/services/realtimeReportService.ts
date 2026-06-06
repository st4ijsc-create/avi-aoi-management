// Realtime Report Service (Giai đoạn 3 — G9)
// Pure-compute helpers: LTTB downsampling cho chuỗi thời gian + định nghĩa cột
// cho các view xuất tuân thủ (CFR21_PART11/IATF16949/ISO9001/ISO17025/ISO50001).
// Không phụ thuộc DB — an toàn dùng từ tRPC trước/sau khi truy vấn.

export interface TimePoint {
  t: number;   // epoch ms
  v: number;   // giá trị
}

/**
 * Largest-Triangle-Three-Buckets downsampling.
 * Giữ hình dạng trực quan của chuỗi với số điểm cố định `threshold`.
 */
export function lttbDownsample(data: TimePoint[], threshold: number): TimePoint[] {
  const n = data.length;
  if (threshold >= n || threshold <= 2) return data.slice();

  const sampled: TimePoint[] = [];
  const bucketSize = (n - 2) / (threshold - 2);

  let a = 0; // điểm đã chọn trước đó
  sampled.push(data[0]);

  for (let i = 0; i < threshold - 2; i++) {
    const rangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n);

    // Trung bình điểm của bucket kế tiếp
    let avgX = 0;
    let avgY = 0;
    const avgRangeLen = rangeEnd - rangeStart;
    for (let j = rangeStart; j < rangeEnd; j++) {
      avgX += data[j].t;
      avgY += data[j].v;
    }
    if (avgRangeLen > 0) {
      avgX /= avgRangeLen;
      avgY /= avgRangeLen;
    }

    // Bucket hiện tại
    const curStart = Math.floor(i * bucketSize) + 1;
    const curEnd = Math.floor((i + 1) * bucketSize) + 1;

    const pointA = data[a];
    let maxArea = -1;
    let nextA = curStart;
    let chosen = data[curStart];

    for (let j = curStart; j < curEnd; j++) {
      const area = Math.abs(
        (pointA.t - avgX) * (data[j].v - pointA.v) -
        (pointA.t - data[j].t) * (avgY - pointA.v),
      ) / 2;
      if (area > maxArea) {
        maxArea = area;
        chosen = data[j];
        nextA = j;
      }
    }

    sampled.push(chosen);
    a = nextA;
  }

  sampled.push(data[n - 1]);
  return sampled;
}

// ---------------------------------------------------------------
// Compliance export views
// ---------------------------------------------------------------

export type ComplianceView =
  | "CFR21_PART11"
  | "IATF16949"
  | "ISO9001"
  | "ISO17025"
  | "ISO50001";

export interface ComplianceColumn {
  key: string;
  label: string;
}

/**
 * Định nghĩa cột chuẩn cho từng view tuân thủ. Router map dữ liệu thật vào các cột này.
 */
export const COMPLIANCE_VIEWS: Record<ComplianceView, ComplianceColumn[]> = {
  CFR21_PART11: [
    { key: "recordId", label: "Record ID" },
    { key: "action", label: "Action" },
    { key: "userId", label: "User" },
    { key: "timestamp", label: "Timestamp (UTC)" },
    { key: "reason", label: "Reason for Change" },
    { key: "signatureHash", label: "Electronic Signature" },
  ],
  IATF16949: [
    { key: "partNumber", label: "Part Number" },
    { key: "process", label: "Process" },
    { key: "characteristic", label: "Characteristic" },
    { key: "measuredValue", label: "Measured Value" },
    { key: "spec", label: "Spec (LSL/USL)" },
    { key: "cpk", label: "Cpk" },
    { key: "disposition", label: "Disposition" },
  ],
  ISO9001: [
    { key: "documentId", label: "Document ID" },
    { key: "clause", label: "Clause" },
    { key: "evidence", label: "Evidence" },
    { key: "owner", label: "Owner" },
    { key: "status", label: "Status" },
  ],
  ISO17025: [
    { key: "equipmentId", label: "Equipment ID" },
    { key: "calibrationDate", label: "Calibration Date" },
    { key: "dueDate", label: "Next Due" },
    { key: "uncertainty", label: "Measurement Uncertainty" },
    { key: "traceability", label: "Traceability" },
  ],
  ISO50001: [
    { key: "source", label: "Energy Source" },
    { key: "consumptionKwh", label: "Consumption (kWh)" },
    { key: "enpi", label: "EnPI (kWh/unit)" },
    { key: "baseline", label: "Baseline" },
    { key: "carbonKg", label: "Carbon (kg CO2e)" },
  ],
};

export function getComplianceColumns(view: ComplianceView): ComplianceColumn[] {
  return COMPLIANCE_VIEWS[view] ?? [];
}
