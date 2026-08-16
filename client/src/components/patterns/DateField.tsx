/**
 * doc65 PRO-100 (user duyệt) — DateField chuẩn DS thay <input type="date"> native.
 *
 * Lý do: input native hiển thị theo locale HĐH — trên máy US ra MM/DD/YYYY giữa UI
 * tiếng Việt (operator đọc nhầm ngày/tháng là rủi ro thật, finding v4 quality-cockpit).
 * DateField hiển thị CỐ ĐỊNH dd/MM/yyyy (vi-VN) qua Popover + Calendar; contract giữ
 * nguyên chuỗi ISO `yyyy-MM-dd` như native input nên KHÔNG đổi state/API của trang.
 */
import { format, parse, isValid } from "date-fns";
import { useTranslation } from "react-i18next";
import { vi } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function DateField({
  value,
  onChange,
  "aria-label": ariaLabel,
  placeholder: placeholderProp,
  className,
}: {
  /** Chuỗi ISO yyyy-MM-dd (như <input type="date">). Rỗng = chưa chọn. */
  value?: string;
  onChange: (iso: string) => void;
  "aria-label"?: string;
  placeholder?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  // Mặc định giải ở thân hàm — `t` chưa có trong phạm vi danh sách tham số.
  const placeholder = placeholderProp ?? t("dateField.chonNgay", "Chọn ngày");
  const date = value ? parse(value, "yyyy-MM-dd", new Date()) : undefined;
  const valid = date != null && isValid(date);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={ariaLabel}
          className={cn("w-full justify-start px-3 font-normal", !valid && "text-muted-foreground", className)}
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
          {valid ? format(date, "dd/MM/yyyy") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={vi}
          selected={valid ? date : undefined}
          onSelect={(d) => { if (d) onChange(format(d, "yyyy-MM-dd")); }}
        />
      </PopoverContent>
    </Popover>
  );
}

export default DateField;
