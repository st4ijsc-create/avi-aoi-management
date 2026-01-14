import { useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';

interface UndoDeleteOptions<T> {
  /** Thời gian chờ trước khi xóa thực sự (ms) */
  delay?: number;
  /** Callback khi xóa thực sự được thực hiện */
  onDelete: (item: T) => void | Promise<void>;
  /** Callback khi undo được thực hiện */
  onUndo?: (item: T) => void;
  /** Lấy tên hiển thị của item */
  getItemName?: (item: T) => string;
  /** Loại item (vd: "sản phẩm", "điểm đo") */
  itemType?: string;
}

interface UndoState<T> {
  item: T;
  timeoutId: ReturnType<typeof setTimeout>;
  toastId: string | number;
}

/**
 * Hook để quản lý undo delete functionality
 * Cho phép người dùng hoàn tác xóa trong một khoảng thời gian nhất định
 */
export function useUndoDelete<T>(options: UndoDeleteOptions<T>) {
  const {
    delay = 5000,
    onDelete,
    onUndo,
    getItemName = () => 'item',
    itemType = 'mục',
  } = options;

  const [pendingDeletes, setPendingDeletes] = useState<Map<string, UndoState<T>>>(new Map());
  const pendingDeletesRef = useRef(pendingDeletes);
  pendingDeletesRef.current = pendingDeletes;

  /**
   * Bắt đầu quá trình xóa với khả năng undo
   * @param item - Item cần xóa
   * @param key - Key duy nhất để identify item (thường là id)
   */
  const deleteWithUndo = useCallback((item: T, key: string) => {
    const itemName = getItemName(item);
    
    // Tạo toast với nút undo
    const toastId = toast.loading(
      `Đang xóa ${itemType} "${itemName}"...`,
      {
        duration: delay,
        action: {
          label: 'Hoàn tác',
          onClick: () => {
            // Hủy xóa
            const pending = pendingDeletesRef.current.get(key);
            if (pending) {
              clearTimeout(pending.timeoutId);
              setPendingDeletes(prev => {
                const next = new Map(prev);
                next.delete(key);
                return next;
              });
              toast.dismiss(toastId);
              toast.success(`Đã hoàn tác xóa ${itemType} "${itemName}"`);
              onUndo?.(item);
            }
          },
        },
      }
    );

    // Đặt timeout để xóa thực sự
    const timeoutId = setTimeout(async () => {
      try {
        await onDelete(item);
        toast.dismiss(toastId);
        toast.success(`Đã xóa ${itemType} "${itemName}"`);
      } catch (error) {
        toast.dismiss(toastId);
        toast.error(`Lỗi khi xóa ${itemType}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      } finally {
        setPendingDeletes(prev => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
      }
    }, delay);

    // Lưu trạng thái pending
    setPendingDeletes(prev => {
      const next = new Map(prev);
      next.set(key, { item, timeoutId, toastId });
      return next;
    });

    return toastId;
  }, [delay, onDelete, onUndo, getItemName, itemType]);

  /**
   * Hủy xóa một item cụ thể
   */
  const cancelDelete = useCallback((key: string) => {
    const pending = pendingDeletes.get(key);
    if (pending) {
      clearTimeout(pending.timeoutId);
      toast.dismiss(pending.toastId);
      setPendingDeletes(prev => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      return true;
    }
    return false;
  }, [pendingDeletes]);

  /**
   * Hủy tất cả các xóa đang chờ
   */
  const cancelAllDeletes = useCallback(() => {
    pendingDeletes.forEach((pending) => {
      clearTimeout(pending.timeoutId);
      toast.dismiss(pending.toastId);
    });
    setPendingDeletes(new Map());
  }, [pendingDeletes]);

  /**
   * Kiểm tra xem một item có đang trong trạng thái pending delete không
   */
  const isPendingDelete = useCallback((key: string) => {
    return pendingDeletes.has(key);
  }, [pendingDeletes]);

  return {
    deleteWithUndo,
    cancelDelete,
    cancelAllDeletes,
    isPendingDelete,
    pendingCount: pendingDeletes.size,
  };
}

/**
 * Hook đơn giản hơn cho undo delete với toast notification
 * Không cần quản lý state phức tạp
 */
export function useSimpleUndoDelete<T>(
  onDelete: (item: T) => void | Promise<void>,
  options: {
    delay?: number;
    itemType?: string;
    getItemName?: (item: T) => string;
  } = {}
) {
  const { delay = 5000, itemType = 'mục', getItemName = () => 'item' } = options;

  const deleteWithUndo = useCallback(async (item: T) => {
    const itemName = getItemName(item);
    let cancelled = false;

    const toastId = toast(
      `Xóa ${itemType} "${itemName}"`,
      {
        duration: delay,
        action: {
          label: 'Hoàn tác',
          onClick: () => {
            cancelled = true;
            toast.dismiss(toastId);
            toast.success(`Đã hoàn tác xóa ${itemType}`);
          },
        },
      }
    );

    // Chờ delay
    await new Promise(resolve => setTimeout(resolve, delay));

    // Nếu không bị hủy, thực hiện xóa
    if (!cancelled) {
      try {
        await onDelete(item);
        toast.success(`Đã xóa ${itemType} "${itemName}"`);
      } catch (error) {
        toast.error(`Lỗi khi xóa: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }, [onDelete, delay, itemType, getItemName]);

  return { deleteWithUndo };
}
