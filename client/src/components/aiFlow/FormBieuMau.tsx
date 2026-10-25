/**
 * Form CÓ KIỂU cho `nguoi.bieu-mau` — lô nguoi.bieu-mau. HAI nửa:
 *   • `FormBieuMau` (Flow Studio, kỹ sư soạn): tiêu đề / nội dung / hạn / vai duyệt / tên khoá ra + danh sách TRƯỜNG (≤ 20; chuoi · so · boolean · chon).
 *   • `FormDienBieuMau` (hộp duyệt `/ai-flows/duyet`, người điền): ô nhập theo định nghĩa trường của thẻ; `giaTriGui` dựng giá trị gửi lên (số chỉ khi gõ số hữu hạn; ô trống ⇒ vắng).
 * Máy chủ KIỂM LẠI cả định nghĩa (lúc lưu) lẫn giá trị (lúc `flow.duyet`) — form chỉ là thêm một lớp.
 */
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OBieuThuc, OChon, OHop, Truong } from "./FormKit";

export const KIEU_TRUONG_FORM = ["chuoi", "so", "boolean", "chon"] as const;
export const TRAN_TRUONG_FORM = 20;
export const TRAN_CHUOI_FORM = 2000;
export const TRAN_LUA_CHON_FORM = 30;

export interface TruongForm {
  ten: string;
  nhan: string;
  kieu: string;
  batBuoc?: boolean;
  luaChon?: string[];
}
interface Props {
  p: Record<string, unknown>;
  doi: (k: string, v: unknown) => void;
}

const tenMoi = (ds: TruongForm[]): string => {
  for (let i = ds.length + 1; i < 100; i++) if (!ds.some((x) => x.ten === `truong${i}`)) return `truong${i}`;
  return `truong${Date.now() % 100000}`;
};

export function FormBieuMau({ p, doi }: Props) {
  const { t } = useTranslation();
  const ds: TruongForm[] = Array.isArray(p.truong) ? (p.truong as TruongForm[]) : [];
  const ghi = (moi: TruongForm[]) => doi("truong", moi);
  const capNhat = (i: number, f: (x: TruongForm) => TruongForm) => ghi(ds.map((x, j) => (j === i ? f(x) : x)));
  const s = (k: string) => (p[k] === undefined || p[k] === null ? "" : String(p[k]));
  return (
    <div className="space-y-3" data-testid="form-bieu-mau">
      <Truong nhan={t("flowStudio.cauHinh.tieuDe")}><OBieuThuc testId="bm-tieu-de" giaTri={p.tieuDe} onDoi={(v) => doi("tieuDe", v)} /></Truong>
      <Truong nhan={t("flowStudio.cauHinh.noiDung")}><OBieuThuc nhieuDong giaTri={p.noiDung} onDoi={(v) => doi("noiDung", v)} /></Truong>
      <Truong nhan={t("flowStudio.cauHinh.hetHanGio")}>
        <Input data-testid="bm-het-han" type="number" className="h-9 text-xs" value={s("hetHanGio")} onChange={(e) => doi("hetHanGio", e.target.value === "" ? undefined : Number(e.target.value))} />
      </Truong>
      <Truong nhan={t("flowStudio.cauHinh.vaiTroDuyet")}>
        <Input className="h-9 text-xs font-mono" value={s("vaiTroDuyet")} onChange={(e) => doi("vaiTroDuyet", e.target.value)} />
      </Truong>
      <Truong nhan={t("flowStudio.form.bieuMau.truongRa")} goiY={t("flowStudio.form.bieuMau.truongRaGoiY")}>
        <Input data-testid="bm-truong-ra" className="h-9 text-xs font-mono" value={s("truongRa")} placeholder="bieuMau" onChange={(e) => doi("truongRa", e.target.value)} />
      </Truong>
      <div className="space-y-2" data-testid="bm-ds-truong">
        <p className="text-xs font-medium">{t("flowStudio.form.bieuMau.truong", { n: ds.length, max: TRAN_TRUONG_FORM })}</p>
        {ds.map((d, i) => (
          <div key={i} className="space-y-1 rounded-md border border-border p-2" data-testid={`bm-hang-${i}`}>
            <div className="flex items-center gap-1">
              <Input data-testid={`bm-ten-${i}`} className="h-8 w-28 text-xs font-mono" placeholder={t("flowStudio.form.bieuMau.ten")} value={d.ten} onChange={(e) => capNhat(i, (x) => ({ ...x, ten: e.target.value }))} />
              <Input data-testid={`bm-nhan-${i}`} className="h-8 text-xs" placeholder={t("flowStudio.form.bieuMau.nhan")} value={d.nhan} onChange={(e) => capNhat(i, (x) => ({ ...x, nhan: e.target.value }))} />
              <button type="button" data-testid={`bm-bo-${i}`} aria-label={t("flowStudio.form.bieuMau.boTruong")} onClick={() => ghi(ds.filter((_, j) => j !== i))}>
                <X className="h-3 w-3" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <select
                data-testid={`bm-kieu-${i}`}
                className="h-8 rounded-md border border-input bg-background px-1 text-xs"
                value={(KIEU_TRUONG_FORM as readonly string[]).includes(d.kieu) ? d.kieu : "chuoi"}
                onChange={(e) => {
                  const kieu = e.target.value;
                  capNhat(i, (x) => {
                    const { luaChon: _bo, ...con } = x;
                    return kieu === "chon" ? { ...con, kieu, luaChon: [] } : { ...con, kieu };
                  });
                }}
              >
                {KIEU_TRUONG_FORM.map((k) => (
                  <option key={k} value={k}>{t(`flowStudio.form.bieuMau.kieuLoai.${k}`)}</option>
                ))}
              </select>
              <OHop testId={`bm-bat-buoc-${i}`} nhan={t("flowStudio.form.bieuMau.batBuoc")} giaTri={d.batBuoc === true} onDoi={(v) => capNhat(i, (x) => ({ ...x, batBuoc: v || undefined }))} />
            </div>
            {d.kieu === "chon" && (
              <Input
                data-testid={`bm-lua-chon-${i}`}
                className="h-8 text-xs"
                placeholder={t("flowStudio.form.bieuMau.luaChonGoiY")}
                defaultValue={(d.luaChon ?? []).join(", ")}
                onChange={(e) => capNhat(i, (x) => ({ ...x, luaChon: e.target.value.split(",").map((v) => v.trim()).filter((v) => v !== "") }))}
              />
            )}
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" data-testid="bm-them" disabled={ds.length >= TRAN_TRUONG_FORM} onClick={() => ghi([...ds, { ten: tenMoi(ds), nhan: "", kieu: "chuoi" }])}>
          {t("flowStudio.form.bieuMau.themTruong")}
        </Button>
        <p className="text-[11px] text-muted-foreground">{t("flowStudio.form.bieuMau.goiY")}</p>
      </div>
    </div>
  );
}

type GiaTri = string | number | boolean | null;

/** Giá trị gửi lên `flow.duyet`: chuỗi/chon trống ⇒ vắng; số chỉ khi là số hữu hạn; boolean mặc định false. */
export function giaTriGui(truong: readonly TruongForm[], dang: Record<string, GiaTri>): Record<string, string | number | boolean> {
  const ra: Record<string, string | number | boolean> = {};
  for (const f of truong) {
    const v = dang[f.ten];
    if (f.kieu === "boolean") ra[f.ten] = v === true;
    else if (f.kieu === "so") {
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
      if (Number.isFinite(n)) ra[f.ten] = n;
    } else if (typeof v === "string" && v !== "") ra[f.ten] = v;
  }
  return ra;
}

export function FormDienBieuMau({ truong, giaTri, doi }: { truong: readonly TruongForm[]; giaTri: Record<string, GiaTri>; doi: (ten: string, v: GiaTri) => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 rounded-md border border-border p-2" data-testid="form-dien-bieu-mau">
      {truong.map((f) => (
        <Truong key={f.ten} nhan={`${f.nhan}${f.batBuoc ? " *" : ""}`}>
          {f.kieu === "boolean" ? (
            <OHop testId={`dien-${f.ten}`} nhan={t("flowStudio.form.bieuMau.co")} giaTri={giaTri[f.ten] === true} onDoi={(v) => doi(f.ten, v)} />
          ) : f.kieu === "chon" ? (
            <OChon
              testId={`dien-${f.ten}`}
              giaTri={typeof giaTri[f.ten] === "string" ? (giaTri[f.ten] as string) : ""}
              onDoi={(v) => doi(f.ten, v)}
              luaChon={[{ v: "", nhan: t("flowStudio.form.bieuMau.chonMuc") }, ...(f.luaChon ?? []).map((v) => ({ v, nhan: v }))]}
            />
          ) : (
            <Input
              data-testid={`dien-${f.ten}`}
              type={f.kieu === "so" ? "number" : "text"}
              maxLength={f.kieu === "chuoi" ? TRAN_CHUOI_FORM : undefined}
              className="h-9 text-sm"
              value={giaTri[f.ten] === undefined || giaTri[f.ten] === null ? "" : String(giaTri[f.ten])}
              onChange={(e) => doi(f.ten, e.target.value)}
            />
          )}
        </Truong>
      ))}
    </div>
  );
}
