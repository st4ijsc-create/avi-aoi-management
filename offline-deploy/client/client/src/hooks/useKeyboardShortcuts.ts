import { useEffect, useCallback, useRef } from 'react';

interface KeyboardShortcut {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  action: () => void;
  description?: string;
  preventDefault?: boolean;
}

interface UseKeyboardShortcutsOptions {
  enabled?: boolean;
  scope?: 'global' | 'form';
}

/**
 * Hook để quản lý keyboard shortcuts
 * @param shortcuts - Danh sách các shortcuts cần đăng ký
 * @param options - Các tùy chọn cho hook
 */
export function useKeyboardShortcuts(
  shortcuts: KeyboardShortcut[],
  options: UseKeyboardShortcutsOptions = {}
) {
  const { enabled = true, scope = 'global' } = options;
  const shortcutsRef = useRef(shortcuts);
  
  // Cập nhật ref khi shortcuts thay đổi
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;

    // Bỏ qua nếu đang focus vào input/textarea và scope là global
    if (scope === 'global') {
      const target = event.target as HTMLElement;
      const isInputFocused = 
        target.tagName === 'INPUT' || 
        target.tagName === 'TEXTAREA' || 
        target.isContentEditable;
      
      // Cho phép Escape luôn hoạt động
      if (isInputFocused && event.key !== 'Escape') {
        // Chỉ cho phép Ctrl+S trong input
        if (!(event.ctrlKey && event.key.toLowerCase() === 's')) {
          return;
        }
      }
    }

    for (const shortcut of shortcutsRef.current) {
      const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase();
      const ctrlMatch = !!shortcut.ctrlKey === (event.ctrlKey || event.metaKey);
      const shiftMatch = !!shortcut.shiftKey === event.shiftKey;
      const altMatch = !!shortcut.altKey === event.altKey;

      if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
        if (shortcut.preventDefault !== false) {
          event.preventDefault();
        }
        shortcut.action();
        break;
      }
    }
  }, [enabled, scope]);

  useEffect(() => {
    if (enabled) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [enabled, handleKeyDown]);
}

/**
 * Hook để quản lý shortcuts cho form (Ctrl+S để lưu, Esc để hủy)
 * @param onSave - Callback khi nhấn Ctrl+S
 * @param onCancel - Callback khi nhấn Esc
 * @param options - Các tùy chọn bổ sung
 */
export function useFormShortcuts(
  onSave?: () => void,
  onCancel?: () => void,
  options: { enabled?: boolean; canSave?: boolean } = {}
) {
  const { enabled = true, canSave = true } = options;

  const shortcuts: KeyboardShortcut[] = [];

  if (onSave && canSave) {
    shortcuts.push({
      key: 's',
      ctrlKey: true,
      action: onSave,
      description: 'Lưu form (Ctrl+S)',
    });
  }

  if (onCancel) {
    shortcuts.push({
      key: 'Escape',
      action: onCancel,
      description: 'Hủy/Đóng (Esc)',
    });
  }

  useKeyboardShortcuts(shortcuts, { enabled, scope: 'form' });
}

/**
 * Hook để quản lý shortcuts cho dialog (Esc để đóng)
 * @param onClose - Callback khi nhấn Esc
 * @param enabled - Có bật shortcuts không
 */
export function useDialogShortcuts(
  onClose: () => void,
  enabled: boolean = true
) {
  useKeyboardShortcuts(
    [
      {
        key: 'Escape',
        action: onClose,
        description: 'Đóng dialog (Esc)',
      },
    ],
    { enabled, scope: 'global' }
  );
}

/**
 * Helper function to format keyboard shortcut display text
 */
export function formatShortcut(key: string, modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean }): string {
  const parts: string[] = [];
  if (modifiers?.ctrl) parts.push('Ctrl');
  if (modifiers?.shift) parts.push('Shift');
  if (modifiers?.alt) parts.push('Alt');
  parts.push(key.toUpperCase());
  return parts.join('+');
}
