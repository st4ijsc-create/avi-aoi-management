export interface SanPham {
  ma: string;
  ten: string;
  /** Đơn giá, số nguyên VND. */
  gia: number;
}

export const DANH_MUC: readonly SanPham[] = [
  { ma: "AO01", ten: "Áo thun", gia: 150_000 },
  { ma: "QU01", ten: "Quần jean", gia: 450_000 },
  { ma: "GI01", ten: "Giày thể thao", gia: 900_000 },
  { ma: "MU01", ten: "Mũ lưỡi trai", gia: 85_000 },
  { ma: "TU01", ten: "Túi đeo chéo", gia: 320_000 },
];

export function timSanPham(ma: string): SanPham | undefined {
  return DANH_MUC.find((sp) => sp.ma === ma);
}
