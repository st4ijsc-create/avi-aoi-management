/**
 * doc 59 P0 — ContextDrawer: the standard right-side workspace panel (AI copilot /
 * Andon / open-issues / row detail), so every workspace exposes context consistently.
 * Thin wrapper over ui/sheet — the caller owns the open state + trigger.
 */
import { type ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

export interface ContextDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  side?: "right" | "left";
  className?: string;
}

export function ContextDrawer({ open, onOpenChange, title, description, children, side = "right", className }: ContextDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={side} className={className ?? "flex w-[92vw] flex-col gap-0 p-0 sm:w-[420px] sm:max-w-[440px]"}>
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-base">{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

export default ContextDrawer;
