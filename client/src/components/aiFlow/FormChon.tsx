/**
 * Form CÓ KIỂU cho `logic.chon` (rẽ nhánh) và `logic.gom` (gom item) — lô logic-chon. Ô JSON thô vẫn còn (nút chuyển ở bảng cấu hình); máy chủ kiểm tham số y như nhau lúc lưu
 * (`kiemThamSoNutMoi`) và lúc chạy. Điều kiện giữ KIỂU: số / true / false / null / "chuỗi trong ngoặc kép" / chữ trần (= chuỗi) — xem `lib/flowChon.ts`.
 */
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { hienDanhSach, hienGiaTri, phanTichDanhSach, phanTichGiaTri } from "@/lib/flowChon";
import { OBieuThuc, Truong } from "./FormKit";

export const TOAN_TU_CHON_FORM = ["eq", "in", "gt", "lt", "gte", "lte"] as const;
export const TRAN_NHANH_CHON_FORM = 5;
type NhanhChon = { so: string; dich: unknown };
interface Props {
  p: Record<string, unknown>;
  doi: (k: string, v: unknown) => void;
}

export function FormChon({ p, doi }: Props) {
  const { t } = useTranslation();
  const ds: NhanhChon[] = Array.isArray(p.nhanh) ? (p.nhanh as NhanhChon[]) : [];
  const ghi = (moi: NhanhChon[]) => doi("nhanh", moi);
  const laSo = (so: string) => so !== "in" && so !== "eq";
  const capNhat = (i: number, f: (x: NhanhChon) => NhanhChon) => ghi(ds.map((x, j) => (j === i ? f(x) : x)));
  return (
    <div className="space-y-3" data-testid="form-chon">
      <Truong nhan={t("flowStudio.form.chon.giaTri")} goiY={t("flowStudio.form.chon.giaTriGoiY")}>
        <OBieuThuc testId="chon-gia-tri" giaTri={p.giaTri} onDoi={(v) => doi("giaTri", v)} />
      </Truong>
      <div className="space-y-2" data-testid="chon-nhanh">
        <p className="text-xs font-medium">{t("flowStudio.form.chon.dieuKien", { n: ds.length, max: TRAN_NHANH_CHON_FORM })}</p>
        {ds.map((d, i) => (
          <div key={i} className="flex items-center gap-1" data-testid={`chon-hang-${i}`}>
            <span className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">{`nhanh-${i + 1}`}</span>
            <select
              data-testid={`chon-so-${i}`}
              className="h-8 rounded-md border border-input bg-background px-1 text-xs"
              value={(TOAN_TU_CHON_FORM as readonly string[]).includes(d.so) ? d.so : "eq"}
              onChange={(e) => {
                const so = e.target.value;
                capNhat(i, (x) => ({ so, dich: so === "in" ? (Array.isArray(x.dich) ? x.dich : []) : laSo(so) ? 0 : "" }));
              }}
            >
              {TOAN_TU_CHON_FORM.map((o) => (
                <option key={o} value={o}>{t(`flowStudio.form.chon.so.${o}`)}</option>
              ))}
            </select>
            {d.so === "in" ? (
              <Input data-testid={`chon-dich-${i}`} className="h-8 text-xs font-mono" placeholder={t("flowStudio.form.chon.dsGoiY")} defaultValue={hienDanhSach(d.dich)} onChange={(e) => capNhat(i, (x) => ({ ...x, dich: phanTichDanhSach(e.target.value) }))} />
            ) : laSo(d.so) ? (
              <Input data-testid={`chon-dich-${i}`} type="number" className="h-8 text-xs" value={typeof d.dich === "number" ? String(d.dich) : ""} onChange={(e) => capNhat(i, (x) => ({ ...x, dich: e.target.value === "" ? 0 : Number(e.target.value) }))} />
            ) : (
              <Input data-testid={`chon-dich-${i}`} className="h-8 text-xs font-mono" placeholder={t("flowStudio.form.chon.giaTriDichGoiY")} defaultValue={hienGiaTri(d.dich)} onChange={(e) => capNhat(i, (x) => ({ ...x, dich: phanTichGiaTri(e.target.value) }))} />
            )}
            <button type="button" data-testid={`chon-bo-${i}`} aria-label={t("flowStudio.form.chon.boDieuKien")} onClick={() => ghi(ds.filter((_, j) => j !== i))}>
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" data-testid="chon-them" disabled={ds.length >= TRAN_NHANH_CHON_FORM} onClick={() => ghi([...ds, { so: "eq", dich: "" }])}>
          {t("flowStudio.form.chon.themDieuKien")}
        </Button>
        <p className="text-[11px] text-muted-foreground">{t("flowStudio.form.chon.khacGoiY")}</p>
      </div>
    </div>
  );
}

export function FormGom({ p, doi }: Props) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3" data-testid="form-gom">
      <Truong nhan={t("flowStudio.form.gom.truongRa")} goiY={t("flowStudio.form.gom.goiY")}>
        <Input data-testid="gom-truong-ra" className="h-9 text-xs font-mono" value={String(p.truongRa ?? "")} placeholder="danhSach" onChange={(e) => doi("truongRa", e.target.value)} />
      </Truong>
    </div>
  );
}
