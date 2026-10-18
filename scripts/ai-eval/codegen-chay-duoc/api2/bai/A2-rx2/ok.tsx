import { Suspense, use } from "react";

type DuLieuMay = { ten: string; trangThai: string };

export function ThongTinMay({ duLieu }: { duLieu: Promise<DuLieuMay> }) {
  const may = use(duLieu);
  return <p>{may.ten} — {may.trangThai}</p>;
}

export function KhungMay({ duLieu }: { duLieu: Promise<DuLieuMay> }) {
  return (
    <Suspense fallback={<p>Đang tải…</p>}>
      <ThongTinMay duLieu={duLieu} />
    </Suspense>
  );
}
