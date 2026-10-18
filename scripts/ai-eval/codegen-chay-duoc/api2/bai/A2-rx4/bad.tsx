import { useEffect } from "react";

// SAI (lỗi điển hình): effect chỉ phụ thuộc [phong] nhưng callback đóng gói donVi/nguong/baoDong CŨ (stale closure).
type Props = {
  phong: string;
  donVi: "C" | "F";
  nguong: number;
  baoDong: (thongDiep: string) => void;
  ketNoi: (phong: string, khiCoGiaTri: (doC: number) => void) => () => void;
};

export function PhongTheoDoi({ phong, donVi, nguong, baoDong, ketNoi }: Props) {
  useEffect(() => {
    return ketNoi(phong, (doC) => {
      if (doC <= nguong) return;
      const chuoi = donVi === "C" ? `${doC.toFixed(1)}°C` : `${(doC * 9 / 5 + 32).toFixed(1)}°F`;
      baoDong(`${phong}: ${chuoi}`);
    });
  }, [phong]);
  return <p>Phòng {phong}</p>;
}
