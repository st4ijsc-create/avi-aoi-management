/**
 * Doc 81 Đợt 2 Task 10 — `useUrlParam(name)`: một tham số `?name=` của trang làm nguồn sự thật.
 *
 * - Đọc: giá trị hiện tại của `?name=` (null khi thiếu), cập nhật khi URL đổi (back/forward, ghi từ nơi khác).
 * - Ghi: REPLACE (không thêm mục lịch sử), giữ nguyên đường dẫn và mọi tham số khác; `null`/`""` ⇒ xoá tham số.
 * - Gộp tham số từ `window.location.search` (URL mới nhất), không từ `search` của lần render: hai lần ghi trong
 *   cùng một handler (vd `?code=` rồi `?tab=`) đều được giữ.
 *
 * Trước đây là 4 bản chép tay (EquipmentIntegration, EquipmentStandards, InterlockRuleManagement,
 * RecipeManagement) — dùng hook này, đừng chép thêm.
 */
import { useMemo } from "react";
import { useLocation, useSearch } from "wouter";

export function useUrlParam(name: string): [string | null, (value: string | null) => void] {
  const search = useSearch();
  const [location, setLocation] = useLocation();
  const value = useMemo(() => new URLSearchParams(search).get(name), [search, name]);
  const set = (v: string | null) => {
    const p = new URLSearchParams(window.location.search);
    if (v == null || v === "") p.delete(name);
    else p.set(name, v);
    const qs = p.toString();
    setLocation(qs ? `${location}?${qs}` : location, { replace: true });
  };
  return [value, set];
}

export default useUrlParam;
