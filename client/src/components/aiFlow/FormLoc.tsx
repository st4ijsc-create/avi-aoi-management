/**
 * Form CÓ KIỂU cho `logic.cho` (hẹn giờ), `logic.dung-loi`, `logic.loc` (lọc) và `logic.sap-xep` — lô logic-cho/loc. Ô JSON thô vẫn còn (nút chuyển ở bảng cấu hình); máy chủ kiểm
 * tham số y như nhau lúc lưu (`kiemThamSoNutMoi`) và lúc chạy. Giá trị đích của điều kiện giữ KIỂU như `logic.chon` (xem `lib/flowChon.ts`).
 */
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { hienDanhSach, hienGiaTri, phanTichDanhSach, phanTichGiaTri } from "@/lib/flowChon";
import { OBieuThuc, OChon, Truong } from "./FormKit";

export const CHO_TOI_DA_GIAY_FORM = 86_400;
export const CHO_MAC_DINH_GIAY_FORM = 60;
export const TRAN_THONG_DIEP_FORM = 200;
export const TOAN_TU_LOC_FORM = ["eq", "in", "gt", "lt", "gte", "lte"] as const;
export const TRAN_DIEU_KIEN_LOC_FORM = 5;
export const HUONG_SAP_XEP_FORM = ["tang", "giam"] as const;
export const KIEU_SAP_XEP_FORM = ["so", "chu"] as const;

interface Props {
  p: Record<string, unknown>;
  doi: (k: string, v: unknown) => void;
}

export function FormCho({ p, doi }: Props) {
  const { t } = useTranslation();
  const giay = typeof p.giay === "number" ? p.giay : CHO_MAC_DINH_GIAY_FORM;
  return (
    <div className="space-y-3" data-testid="form-cho">
      <Truong nhan={t("flowStudio.form.cho.giay")} goiY={t("flowStudio.form.cho.goiY", { max: CHO_TOI_DA_GIAY_FORM })}>
        <Input
          data-testid="cho-giay"
          type="number"
          min={0}
          max={CHO_TOI_DA_GIAY_FORM}
          className="h-9 text-xs"
          value={String(giay)}
          onChange={(e) => {
            const n = Number(e.target.value);
            doi("giay", e.target.value === "" || !Number.isFinite(n) ? CHO_MAC_DINH_GIAY_FORM : Math.min(CHO_TOI_DA_GIAY_FORM, Math.max(0, n)));
          }}
        />
      </Truong>
    </div>
  );
}

export function FormDungLoi({ p, doi }: Props) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3" data-testid="form-dung-loi">
      <Truong nhan={t("flowStudio.form.dungLoi.thongDiep")} goiY={t("flowStudio.form.dungLoi.goiY", { max: TRAN_THONG_DIEP_FORM })}>
        <OBieuThuc testId="dung-loi-thong-diep" giaTri={p.thongDiep} onDoi={(v) => doi("thongDiep", v.slice(0, TRAN_THONG_DIEP_FORM * 5))} />
      </Truong>
    </div>
  );
}

type DieuKienLoc = { giaTri: string; so: string; dich: unknown };

export function FormLoc({ p, doi }: Props) {
  const { t } = useTranslation();
  const ds: DieuKienLoc[] = Array.isArray(p.dieuKien) ? (p.dieuKien as DieuKienLoc[]) : [];
  const ghi = (moi: DieuKienLoc[]) => doi("dieuKien", moi);
  const laSo = (so: string) => so !== "in" && so !== "eq";
  const capNhat = (i: number, f: (x: DieuKienLoc) => DieuKienLoc) => ghi(ds.map((x, j) => (j === i ? f(x) : x)));
  return (
    <div className="space-y-2" data-testid="form-loc">
      <p className="text-xs font-medium">{t("flowStudio.form.loc.dieuKien", { n: ds.length, max: TRAN_DIEU_KIEN_LOC_FORM })}</p>
      {ds.map((d, i) => (
        <div key={i} className="space-y-1 rounded-md border border-border p-2" data-testid={`loc-hang-${i}`}>
          <div className="flex items-center gap-1">
            <OBieuThuc testId={`loc-gia-tri-${i}`} giaTri={d.giaTri} placeholder="{{ $json.oee }}" onDoi={(v) => capNhat(i, (x) => ({ ...x, giaTri: v }))} />
            <button type="button" data-testid={`loc-bo-${i}`} aria-label={t("flowStudio.form.loc.boDieuKien")} onClick={() => ghi(ds.filter((_, j) => j !== i))}>
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="flex items-center gap-1">
            <select
              data-testid={`loc-so-${i}`}
              className="h-8 rounded-md border border-input bg-background px-1 text-xs"
              value={(TOAN_TU_LOC_FORM as readonly string[]).includes(d.so) ? d.so : "eq"}
              onChange={(e) => {
                const so = e.target.value;
                capNhat(i, (x) => ({ ...x, so, dich: so === "in" ? (Array.isArray(x.dich) ? x.dich : []) : laSo(so) ? 0 : "" }));
              }}
            >
              {TOAN_TU_LOC_FORM.map((o) => (
                <option key={o} value={o}>{t(`flowStudio.form.chon.so.${o}`)}</option>
              ))}
            </select>
            {d.so === "in" ? (
              <Input data-testid={`loc-dich-${i}`} className="h-8 text-xs font-mono" placeholder={t("flowStudio.form.chon.dsGoiY")} defaultValue={hienDanhSach(d.dich)} onChange={(e) => capNhat(i, (x) => ({ ...x, dich: phanTichDanhSach(e.target.value) }))} />
            ) : laSo(d.so) ? (
              <Input data-testid={`loc-dich-${i}`} type="number" className="h-8 text-xs" value={typeof d.dich === "number" ? String(d.dich) : ""} onChange={(e) => capNhat(i, (x) => ({ ...x, dich: e.target.value === "" ? 0 : Number(e.target.value) }))} />
            ) : (
              <Input data-testid={`loc-dich-${i}`} className="h-8 text-xs font-mono" placeholder={t("flowStudio.form.chon.giaTriDichGoiY")} defaultValue={hienGiaTri(d.dich)} onChange={(e) => capNhat(i, (x) => ({ ...x, dich: phanTichGiaTri(e.target.value) }))} />
            )}
          </div>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" data-testid="loc-them" disabled={ds.length >= TRAN_DIEU_KIEN_LOC_FORM} onClick={() => ghi([...ds, { giaTri: "{{ $json.x }}", so: "eq", dich: "" }])}>
        {t("flowStudio.form.chon.themDieuKien")}
      </Button>
      <p className="text-[11px] text-muted-foreground">{t("flowStudio.form.loc.goiY")}</p>
    </div>
  );
}

export function FormSapXep({ p, doi }: Props) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3" data-testid="form-sap-xep">
      <Truong nhan={t("flowStudio.form.sapXep.khoa")} goiY={t("flowStudio.form.sapXep.khoaGoiY")}>
        <OBieuThuc testId="sap-xep-gia-tri" giaTri={p.giaTri} onDoi={(v) => doi("giaTri", v)} />
      </Truong>
      <Truong nhan={t("flowStudio.form.sapXep.huong")}>
        <OChon testId="sap-xep-huong" giaTri={String(p.huong ?? "tang")} onDoi={(v) => doi("huong", v)} luaChon={HUONG_SAP_XEP_FORM.map((v) => ({ v, nhan: t(`flowStudio.form.sapXep.huongLoai.${v}`) }))} />
      </Truong>
      <Truong nhan={t("flowStudio.form.sapXep.kieu")} goiY={t("flowStudio.form.sapXep.kieuGoiY")}>
        <OChon testId="sap-xep-kieu" giaTri={String(p.kieu ?? "so")} onDoi={(v) => doi("kieu", v)} luaChon={KIEU_SAP_XEP_FORM.map((v) => ({ v, nhan: t(`flowStudio.form.sapXep.kieuLoai.${v}`) }))} />
      </Truong>
    </div>
  );
}
