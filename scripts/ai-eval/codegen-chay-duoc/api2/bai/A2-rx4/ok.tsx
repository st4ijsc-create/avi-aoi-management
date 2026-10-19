import { useEffect, useEffectEvent } from "react";

type Props = {
  phong: string;
  donVi: "C" | "F";
  nguong: number;
  baoDong: (thongDiep: string) => void;
  ketNoi: (phong: string, khiCoGiaTri: (doC: number) => void) => () => void;
};

export function PhongTheoDoi({ phong, donVi, nguong, baoDong, ketNoi }: Props) {
  const khiCoGiaTri = useEffectEvent((doC: number) => {
    if (doC <= nguong) return;
    const chuoi = donVi === "C" ? `${doC.toFixed(1)}°C` : `${(doC * 9 / 5 + 32).toFixed(1)}°F`;
    baoDong(`${phong}: ${chuoi}`);
  });
  const moKetNoi = useEffectEvent((p: string) => ketNoi(p, (v) => khiCoGiaTri(v)));
  useEffect(() => {
    const ngat = moKetNoi(phong);
    return () => ngat();
  }, [phong]);
  return <p>Phòng {phong}</p>;
}
