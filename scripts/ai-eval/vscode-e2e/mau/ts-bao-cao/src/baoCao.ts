import type { PhanCong } from "./lich.ts";

export interface ThongKeNhanVien {
  nhanVien: string;
  tong: number;
  CA1: number;
  CA2: number;
  CA3: number;
}

/** Mỗi nhân viên một dòng; sắp `tong` giảm dần rồi tên tăng dần (localeCompare "vi"). */
export function thongKe(lich: PhanCong[]): ThongKeNhanVien[] {
  const m = new Map<string, ThongKeNhanVien>();
  for (const p of lich) {
    const d = m.get(p.nhanVien) ?? { nhanVien: p.nhanVien, tong: 0, CA1: 0, CA2: 0, CA3: 0 };
    d.tong++;
    d[p.ca]++;
    m.set(p.nhanVien, d);
  }
  return [...m.values()].sort((a, b) => b.tong - a.tong || a.nhanVien.localeCompare(b.nhanVien, "vi"));
}

/** Bảng chữ: tiêu đề + mỗi nhân viên một dòng, nối bằng "\n", không có "\n" cuối. */
export function bangText(tk: ThongKeNhanVien[]): string {
  return ["Nhân viên | Tổng | CA1 | CA2 | CA3", ...tk.map((d) => `${d.nhanVien} | ${d.tong} | ${d.CA1} | ${d.CA2} | ${d.CA3}`)].join("\n");
}
