/**
 * EntityCombobox — P2 master-data picker. Replaces manual numeric-ID / free-text
 * entry with a searchable dropdown that writes a real FK id (and exposes the
 * matched code/label to the caller). Generic over {id, code, name}-shaped rows.
 *
 * Used by BOM / feeder / material-flow forms to bind componentCode/supplierCode/
 * materialCode to materials.id / suppliers.id instead of typing codes by hand.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface EntityOption {
  id: number;
  code: string;
  name?: string | null;
}

interface EntityComboboxProps {
  options: EntityOption[];
  value: number | null;
  onChange: (id: number | null, option: EntityOption | null) => void;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  allowClear?: boolean;
}

export function EntityCombobox({
  options,
  value,
  onChange,
  placeholder: placeholderProp,
  emptyText: emptyTextProp,
  disabled,
  className,
  allowClear = true,
}: EntityComboboxProps) {
  const { t } = useTranslation();
  // Mặc định phải giải ở THÂN hàm, không ở danh sách tham số: `t` chưa có trong
  // phạm vi lúc khai báo tham số, và nhãn mặc định vẫn phải đổi theo ngôn ngữ.
  const placeholder = placeholderProp ?? t("entityCombo.chon", "Chọn...");
  const emptyText = emptyTextProp ?? t("entityCombo.khongCoDuLieu", "Không có dữ liệu");
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("justify-between font-normal", className)}
        >
          <span className="truncate">
            {selected ? `${selected.code}${selected.name ? ` — ${selected.name}` : ""}` : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command
          filter={(itemValue, search) => (itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}
        >
          <CommandInput placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {allowClear && (
                <CommandItem
                  value="__clear__"
                  onSelect={() => { onChange(null, null); setOpen(false); }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value == null ? "opacity-100" : "opacity-0")} />
                  <span className="text-muted-foreground">{t("entityCombo.boChon", "— Bỏ chọn —")}</span>
                </CommandItem>
              )}
              {options.map((o) => (
                <CommandItem
                  key={o.id}
                  value={`${o.code} ${o.name ?? ""}`}
                  onSelect={() => { onChange(o.id, o); setOpen(false); }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === o.id ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{o.code}{o.name ? ` — ${o.name}` : ""}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
