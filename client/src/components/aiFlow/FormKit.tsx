/**
 * Bộ ô nhập dùng chung của Flow Studio (tách khỏi NodeConfigPanel để form có kiểu của node mới dùng lại, không import vòng).
 */
import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { loiBieuThucChuoi } from "@/lib/flowStudio";

export const O_CHON =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function LoiBt({ giaTri }: { giaTri: unknown }) {
  const { t } = useTranslation();
  if (typeof giaTri !== "string") return null;
  const l = loiBieuThucChuoi(giaTri);
  if (!l) return null;
  return (
    <p className="text-xs text-destructive mt-1" role="alert" data-testid="loi-bieu-thuc">
      {t("flowStudio.cauHinh.loiBieuThuc", { loi: l })}
    </p>
  );
}

export function Truong({ nhan, children, goiY }: { nhan: string; children: ReactNode; goiY?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{nhan}</Label>
      {children}
      {goiY && <p className="text-[11px] text-muted-foreground">{goiY}</p>}
    </div>
  );
}

/** Ô chữ có thể chứa biểu thức (một dòng hoặc nhiều dòng). */
export function OBieuThuc({ giaTri, onDoi, nhieuDong, placeholder, testId }: { giaTri: unknown; onDoi: (v: string) => void; nhieuDong?: boolean; placeholder?: string; testId?: string }) {
  const s = typeof giaTri === "string" ? giaTri : giaTri === undefined || giaTri === null ? "" : JSON.stringify(giaTri);
  const loi = typeof giaTri === "string" && !!loiBieuThucChuoi(giaTri);
  const cls = loi ? "border-destructive focus-visible:ring-destructive" : "";
  return (
    <>
      {nhieuDong ? (
        <Textarea data-testid={testId} className={`text-xs font-mono min-h-[72px] ${cls}`} value={s} placeholder={placeholder} onChange={(e) => onDoi(e.target.value)} />
      ) : (
        <Input data-testid={testId} className={`h-9 text-xs font-mono ${cls}`} value={s} placeholder={placeholder} onChange={(e) => onDoi(e.target.value)} />
      )}
      <LoiBt giaTri={giaTri} />
    </>
  );
}

export function OChon({ giaTri, onDoi, luaChon, testId }: { giaTri: string; onDoi: (v: string) => void; luaChon: { v: string; nhan: string }[]; testId?: string }) {
  return (
    <select data-testid={testId} className={O_CHON} value={giaTri} onChange={(e) => onDoi(e.target.value)}>
      {luaChon.map((o) => (
        <option key={o.v} value={o.v}>{o.nhan}</option>
      ))}
    </select>
  );
}

export function OHop({ giaTri, onDoi, nhan, testId }: { giaTri: boolean; onDoi: (v: boolean) => void; nhan: string; testId?: string }) {
  return (
    <label className="flex items-center gap-2 text-xs cursor-pointer">
      <input data-testid={testId} type="checkbox" className="h-4 w-4" checked={giaTri} onChange={(e) => onDoi(e.target.checked)} />
      {nhan}
    </label>
  );
}
