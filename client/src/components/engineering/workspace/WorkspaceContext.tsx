/**
 * doc 81 Đợt 2 Task 12 — WorkspaceContext: một nguồn state UI cho IDE `/engineering`.
 *
 * Trang (và các card tách ra ở Task 13) đọc `state` và gửi hành động qua `dispatch`; mọi chuỗi
 * reset (đổi project / phiên bản / build) nằm trong `workspaceReducer` thuần — xem đầu tệp ấy.
 * Không thêm phần tử DOM nào (Provider thuần React).
 */
import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import {
  initialWorkspaceState,
  workspaceReducer,
  type WorkspaceAction,
  type WorkspaceState,
} from "./workspaceReducer";

export interface WorkspaceContextValue {
  state: WorkspaceState;
  dispatch: Dispatch<WorkspaceAction>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
  children,
  initialState = initialWorkspaceState,
}: {
  children: ReactNode;
  /** Cho test/Storybook; trang dùng mặc định. */
  initialState?: WorkspaceState;
}) {
  const [state, dispatch] = useReducer(workspaceReducer, initialState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const v = useContext(WorkspaceContext);
  if (!v) throw new Error("useWorkspace must be used within a WorkspaceProvider");
  return v;
}
