import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, Trash2, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from 'react-i18next';

export type ConfirmDialogVariant = "danger" | "warning" | "info";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel?: () => void;
  isLoading?: boolean;
  variant?: ConfirmDialogVariant;
  itemName?: string;
}

const variantConfig = {
  danger: {
    icon: Trash2,
    iconClass: "text-destructive",
    buttonClass: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  },
  warning: {
    icon: AlertTriangle,
    iconClass: "text-yellow-500",
    buttonClass: "bg-yellow-500 text-white hover:bg-yellow-600",
  },
  info: {
    icon: Info,
    iconClass: "text-blue-500",
    buttonClass: "bg-blue-500 text-white hover:bg-blue-600",
  },
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  isLoading = false,
  variant = "danger",
  itemName,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const resolvedConfirmText = confirmText ?? t('common.confirm');
  const resolvedCancelText = cancelText ?? t('common.cancel');
  const config = variantConfig[variant];
  const Icon = config.icon;

  const handleConfirm = () => {
    onConfirm();
  };

  const handleCancel = () => {
    onCancel?.();
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className={cn("p-2 rounded-full bg-muted", config.iconClass)}>
              <Icon className="h-5 w-5" />
            </div>
            <AlertDialogTitle>{title}</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="pt-2">
            {description}
            {itemName && (
              <span className="block mt-2 font-medium text-foreground">
                "{itemName}"
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel} disabled={isLoading}>
            {resolvedCancelText}
          </AlertDialogCancel>
          <Button
            onClick={handleConfirm}
            disabled={isLoading}
            className={config.buttonClass}
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {resolvedConfirmText}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Convenience components for common use cases
interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemType: string;
  itemName?: string;
  onConfirm: () => void;
  isLoading?: boolean;
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  itemType,
  itemName,
  onConfirm,
  isLoading,
}: DeleteConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('common.deleteItemTitle', { item: itemType })}
      description={t('common.deleteItemConfirm', { item: itemType })}
      confirmText={t('common.delete')}
      cancelText={t('common.cancel')}
      onConfirm={onConfirm}
      isLoading={isLoading}
      variant="danger"
      itemName={itemName}
    />
  );
}

// Hook for managing confirm dialog state
import { useState, useCallback } from "react";

interface UseConfirmDialogOptions<T> {
  onConfirm: (item: T) => void | Promise<void>;
}

export function useConfirmDialog<T>({ onConfirm }: UseConfirmDialogOptions<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingItem, setPendingItem] = useState<T | null>(null);

  const openDialog = useCallback((item: T) => {
    setPendingItem(item);
    setIsOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setIsOpen(false);
    setPendingItem(null);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!pendingItem) return;
    
    setIsLoading(true);
    try {
      await onConfirm(pendingItem);
      closeDialog();
    } finally {
      setIsLoading(false);
    }
  }, [pendingItem, onConfirm, closeDialog]);

  return {
    isOpen,
    isLoading,
    pendingItem,
    openDialog,
    closeDialog,
    handleConfirm,
    setIsOpen,
  };
}
