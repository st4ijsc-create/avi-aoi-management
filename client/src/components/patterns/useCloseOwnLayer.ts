/**
 * Doc 81 Đợt 2 — `useCloseOwnLayer()`: form trong một lớp `FlyoutHost` tự đóng CHÍNH lớp của nó (vd sau khi lưu
 * thành công) mà không đóng nhầm lớp khác (Task 5 review M3). Trước Task 7 fix round 1 là hai bản chép tay ở
 * RecipeManagement và EquipmentIntegration.
 *
 * - `done()` chỉ đóng khi form CÒN mount và lớp của nó đang là lớp TRÊN CÙNG của stack (so key + id); khi đóng,
 *   xoá cờ dirty trước để không hỏi "bỏ thay đổi" sau một lần lưu thành công.
 * - `mountedRef` cho form biết còn mount không (đừng setState sau khi sheet đã đóng trong lúc chờ server).
 */
import { useEffect, useRef, type MutableRefObject } from "react";
import { useFlyout, useFlyoutLayer, type FlyoutLayerApi } from "./FlyoutHost";

export interface CloseOwnLayer {
  layer: FlyoutLayerApi;
  done: () => void;
  mountedRef: MutableRefObject<boolean>;
}

export function useCloseOwnLayer(): CloseOwnLayer {
  const layer = useFlyoutLayer();
  const flyoutApi = useFlyout();
  const stackRef = useRef(flyoutApi.stack);
  stackRef.current = flyoutApi.stack;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const done = () => {
    const top = stackRef.current[stackRef.current.length - 1];
    if (!mountedRef.current || !top || top.key !== layer.key || top.id !== layer.id) return;
    layer.setDirty(false);
    layer.close();
  };
  return { layer, done, mountedRef };
}

export default useCloseOwnLayer;
