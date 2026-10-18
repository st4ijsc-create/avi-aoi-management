import { useActionState } from "react";

type TrangThai = { loai: "trong" } | { loai: "ok"; thongBao: string } | { loai: "loi"; thongBao: string };

export function FormDatTen({ luu }: { luu: (ten: string) => Promise<string> }) {
  const [tt, action, dangCho] = useActionState<TrangThai, FormData>(async (_truoc, fd) => {
    const ten = String(fd.get("ten") ?? "").trim();
    if (!ten) return { loai: "loi", thongBao: "Thiếu tên" };
    try {
      return { loai: "ok", thongBao: await luu(ten) };
    } catch (e) {
      return { loai: "loi", thongBao: e instanceof Error ? e.message : String(e) };
    }
  }, { loai: "trong" });
  return (
    <form action={action}>
      <label htmlFor="o-ten">Tên</label>
      <input id="o-ten" name="ten" />
      <button type="submit" disabled={dangCho}>Lưu</button>
      {tt.loai === "ok" && <p role="status">{tt.thongBao}</p>}
      {tt.loai === "loi" && <p role="alert">{tt.thongBao}</p>}
    </form>
  );
}
