/**
 * DS F1b — <SectionCard> (doc 16 §12.2).
 *
 * The titled-panel pattern repeated on every cockpit page:
 *   <Card><CardHeader flex justify-between>
 *     <CardTitle flex gap-2 text-base><Icon/> Title</CardTitle> {action}
 *   </CardHeader><CardContent>{children}</CardContent></Card>
 *
 * Thin composition over the existing shadcn Card primitives — no new styling,
 * so it matches every current section header exactly. `contentClassName=""`
 * (e.g. "p-0") lets table sections drop the default content padding as today.
 */
import * as React from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface SectionCardProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned header action (button, filter, …). */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Applied to CardContent. Pass "p-0" for full-bleed tables. */
  contentClassName?: string;
}

export function SectionCard({
  icon,
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: SectionCardProps) {
  return (
    <Card className={className}>
      <CardHeader
        className={cn("pb-2", action && "flex flex-row items-center justify-between gap-2")}
      >
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            {icon}
            {title}
          </CardTitle>
          {description != null && (
            <CardDescription className="mt-1">{description}</CardDescription>
          )}
        </div>
        {action}
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  );
}

export default SectionCard;
