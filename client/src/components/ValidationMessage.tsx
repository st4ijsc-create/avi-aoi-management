import { cn } from "@/lib/utils";

interface ValidationMessageProps {
  error?: string;
  className?: string;
}

export function ValidationMessage({ error, className }: ValidationMessageProps) {
  if (!error) return null;
  return (
    <p className={cn("text-sm text-destructive mt-1", className)}>
      {error}
    </p>
  );
}

interface FormFieldProps {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
  className?: string;
  description?: string;
}

export function FormField({ 
  label, 
  required, 
  error, 
  children, 
  className,
  description 
}: FormFieldProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <label className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </label>
      {children}
      {description && !error && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      <ValidationMessage error={error} />
    </div>
  );
}
