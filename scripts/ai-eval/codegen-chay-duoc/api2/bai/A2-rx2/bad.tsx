import { Suspense, useEffect, useState } from "react";

// SAI (lỗi điển hình khi không biết API `use`): chờ promise bằng useEffect + useState ⇒ KHÔNG suspend,
// Suspense bên ngoài không bao giờ hiện fallback.
type DuLieuMay = { ten: string; trangThai: string };

export function ThongTinMay({ duLieu }: { duLieu: Promise<DuLieuMay> }) {
  const [may, datMay] = useState<DuLieuMay | null>(null);
  useEffect(() => {
    let huy = false;
    datMay(null);
    duLieu.then((v) => { if (!huy) datMay(v); });
    return () => { huy = true; };
  }, [duLieu]);
  if (!may) return <p>Đang tải…</p>;
  return <p>{may.ten} — {may.trangThai}</p>;
}

export function KhungMay({ duLieu }: { duLieu: Promise<DuLieuMay> }) {
  return (
    <Suspense fallback={<p>Đang tải…</p>}>
      <ThongTinMay duLieu={duLieu} />
    </Suspense>
  );
}
