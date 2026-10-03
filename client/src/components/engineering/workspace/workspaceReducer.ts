/**
 * doc 81 Đợt 2 Task 12 — reducer THUẦN cho state UI của IDE `/engineering` (EngineeringWorkspace).
 *
 * Trước đây ≈40 `useState` phẳng trong trang, và một lựa chọn (project) điều khiển 6 card qua các
 * lời gọi setter rải rác + 3 effect (FE2 §3). Nay MỌI chuỗi reset nằm ở ĐÂY, một chỗ, có test:
 *
 *   project/select  (người dùng chọn project KHÁC)  ⇒ artifactId, buildId, simResult, diagnostics = null
 *                                                     + watching = false, fleet.deviceIds = []
 *                    Dùng cho MỌI lối đổi project: bấm chọn, deep-link ?projectId=, "+ tạo dự án",
 *                    DEMO một chạm (doc 81 Đợt 2 Task 12b, Ruling R-2-r). Hành động cũ
 *                    `project/assign` (giữ artifact/build/sim/diagnostics — mối nguy deploy build của
 *                    dự án TRƯỚC khi đang xem dự án MỚI) đã bị GỠ: không còn lối đổi project nào bỏ
 *                    qua chuỗi reset.
 *   artifact/select (đổi phiên bản HOẶC lưu phiên bản mới) ⇒ buildId, simResult, diagnostics = null (WS-05)
 *   build/select    (bấm chọn build)                ⇒ simResult = null
 *   build/created   (buildArtifact.onSuccess)       ⇒ chỉ đổi buildId (simResult GIỮ — như cũ)
 *
 * Mỗi hệ quả trước kia chạy SAU một lượt render (effect); nay nguyên tử trong cùng một dispatch —
 * DOM cuối cùng y hệt (ảnh chụp DOM của test đặc tả khớp từng byte), chỉ bớt lượt render trung gian.
 *
 * Không có I/O, không đọc thời gian/ngẫu nhiên: khoá idempotency, id… do trang sinh rồi truyền vào.
 */
import type { Kind } from "./programKinds";

export type Diagnostic = {
  severity: string;
  message: string;
  line?: number;
  col?: number;
  symbol?: string;
  code?: string;
  params?: Record<string, string | number>;
};
export type SimResult = { ok: boolean; warnings: string[]; timeline: any[] };
/** doc 80 WS-04 — `attemptKey` sinh MỚI mỗi lần MỞ hộp xác nhận (ổn định trong lượt đó). */
export type RollbackTarget = { id: number; stage: string; attemptKey: string };
export type Stage = "staging" | "production";

export interface SymbolForm {
  open: boolean;
  id: number | null;
  name: string;
  addr: string;
  type: string;
  comment: string;
  watchable: boolean;
}
export interface NewProjectForm {
  open: boolean;
  code: string;
  name: string;
  kind: Kind;
  /** U2 — thiết bị nguồn (tùy chọn) khi tạo project; "" = chưa gắn. */
  deviceId: string;
}
export interface AttachForm {
  open: boolean;
  deviceId: string;
}
export interface DeployForm {
  stage: Stage;
  signOff: boolean;
  /** W2-9 — second-approver (SoD) cho deploy production. */
  approverId: string;
  reason: string;
}
export interface FleetForm {
  deviceIds: number[];
  stage: Stage;
  signOff: boolean;
  canary: number;
  promoteVerified: boolean;
  autoRollback: boolean;
  approverId: string;
  reason: string;
}

export interface WorkspaceState {
  // ── Lựa chọn dẫn dắt 6 card (chuỗi reset) ──
  projectId: number | null;
  artifactId: number | null;
  buildId: number | null;
  diagnostics: Diagnostic[] | null;
  simResult: SimResult | null;
  /** Online Monitor — phiên theo dõi gắn theo project. */
  watching: boolean;
  // ── Explorer (U13) ──
  explorer: { search: string; kindFilter: string };
  // ── Editor ──
  code: string;
  language: string;
  editorMode: "code" | "visual";
  diffBaseId: number | null;
  diffCompareId: number | null;
  // ── Xác nhận ──
  /** U11 — hành động điều hướng bị HOÃN khi buffer bẩn; chỉ chạy khi người dùng xác nhận. */
  pendingNav: (() => void) | null;
  deleteSymTarget: { id: number } | null;
  rollbackTarget: RollbackTarget | null;
  /** U7 — đang tạo dự án DEMO một chạm. */
  demoCreating: boolean;
  // ── Hộp thoại / form ──
  sym: SymbolForm;
  newProject: NewProjectForm;
  attach: AttachForm;
  deploy: DeployForm;
  fleet: FleetForm;
}

export const initialWorkspaceState: WorkspaceState = {
  projectId: null,
  artifactId: null,
  buildId: null,
  diagnostics: null,
  simResult: null,
  watching: false,
  explorer: { search: "", kindFilter: "all" },
  code: "",
  language: "text",
  editorMode: "code",
  diffBaseId: null,
  diffCompareId: null,
  pendingNav: null,
  deleteSymTarget: null,
  rollbackTarget: null,
  demoCreating: false,
  sym: { open: false, id: null, name: "", addr: "", type: "", comment: "", watchable: true },
  newProject: { open: false, code: "", name: "", kind: "stub", deviceId: "" },
  attach: { open: false, deviceId: "" },
  deploy: { stage: "staging", signOff: false, approverId: "", reason: "" },
  fleet: {
    deviceIds: [],
    stage: "staging",
    signOff: false,
    canary: 1,
    promoteVerified: false,
    autoRollback: true,
    approverId: "",
    reason: "",
  },
};

export type SymbolRow = {
  id: number;
  name: string;
  address: string | null;
  dataType: string | null;
  comment: string | null;
  watchable: boolean;
};

export type WorkspaceAction =
  | { type: "project/select"; projectId: number }
  | { type: "artifact/select"; artifactId: number }
  | { type: "build/select"; buildId: number }
  | { type: "build/created"; buildId: number }
  | { type: "diagnostics/set"; diagnostics: Diagnostic[] }
  | { type: "sim/set"; simResult: SimResult }
  | { type: "watch/set"; watching: boolean }
  | { type: "explorer/set"; patch: Partial<WorkspaceState["explorer"]> }
  | { type: "buffer/loadArtifact"; code: string; language: string }
  | { type: "buffer/defaultLanguage"; language: string }
  | { type: "code/set"; code: string }
  | { type: "code/append"; text: string }
  | { type: "language/set"; language: string }
  | { type: "editorMode/set"; mode: "code" | "visual" }
  | { type: "diff/setBase"; artifactId: number }
  | { type: "diff/setCompare"; artifactId: number }
  | { type: "nav/guard"; run: () => void }
  | { type: "nav/clear" }
  | { type: "deleteSym/open"; id: number }
  | { type: "deleteSym/close" }
  | { type: "rollback/open"; target: RollbackTarget }
  | { type: "rollback/close" }
  | { type: "demo/creating"; creating: boolean }
  | { type: "sym/open"; symbol?: SymbolRow }
  | { type: "sym/set"; patch: Partial<SymbolForm> }
  | { type: "newProject/set"; patch: Partial<NewProjectForm> }
  | { type: "newProject/submitted" }
  | { type: "attach/open"; deviceId: string }
  | { type: "attach/set"; patch: Partial<AttachForm> }
  | { type: "deploy/set"; patch: Partial<DeployForm> }
  | { type: "fleet/set"; patch: Partial<Omit<FleetForm, "deviceIds">> }
  | { type: "fleet/toggleDevice"; deviceId: number };

/** WS-05 — build/mô phỏng/chẩn đoán thuộc phiên bản cũ thì bỏ. */
function withArtifact(s: WorkspaceState, artifactId: number | null): WorkspaceState {
  if (artifactId === s.artifactId) return s;
  return { ...s, artifactId, buildId: null, simResult: null, diagnostics: null };
}

export function workspaceReducer(s: WorkspaceState, a: WorkspaceAction): WorkspaceState {
  switch (a.type) {
    case "project/select":
      if (a.projectId === s.projectId) return s;
      // Tường minh cả bốn (không dựa vào withArtifact): kết quả validate/simulate về MUỘN sau khi
      // đã rời phiên bản (artifactId đã null) vẫn phải bị xoá khi đổi project — như handler cũ.
      return {
        ...s,
        projectId: a.projectId,
        artifactId: null,
        buildId: null,
        simResult: null,
        diagnostics: null,
        watching: false,
        fleet: { ...s.fleet, deviceIds: [] },
      };
    case "artifact/select":
      return withArtifact(s, a.artifactId);
    case "build/select":
      return { ...s, buildId: a.buildId, simResult: null };
    case "build/created":
      return { ...s, buildId: a.buildId };
    case "diagnostics/set":
      return { ...s, diagnostics: a.diagnostics };
    case "sim/set":
      return { ...s, simResult: a.simResult };
    case "watch/set":
      return { ...s, watching: a.watching };
    case "explorer/set":
      return { ...s, explorer: { ...s.explorer, ...a.patch } };
    case "buffer/loadArtifact":
      return { ...s, code: a.code, language: a.language };
    case "buffer/defaultLanguage":
      return { ...s, language: a.language };
    case "code/set":
      return { ...s, code: a.code };
    case "code/append":
      return { ...s, code: s.code.trim() ? `${s.code}\n\n${a.text}` : a.text };
    case "language/set":
      return { ...s, language: a.language };
    case "editorMode/set":
      return { ...s, editorMode: a.mode };
    case "diff/setBase":
      return { ...s, diffBaseId: a.artifactId };
    case "diff/setCompare":
      return { ...s, diffCompareId: a.artifactId };
    case "nav/guard":
      return { ...s, pendingNav: a.run };
    case "nav/clear":
      return { ...s, pendingNav: null };
    case "deleteSym/open":
      return { ...s, deleteSymTarget: { id: a.id } };
    case "deleteSym/close":
      return { ...s, deleteSymTarget: null };
    case "rollback/open":
      return { ...s, rollbackTarget: a.target };
    case "rollback/close":
      return { ...s, rollbackTarget: null };
    case "demo/creating":
      return { ...s, demoCreating: a.creating };
    case "sym/open": {
      const x = a.symbol;
      return {
        ...s,
        sym: {
          open: true,
          id: x?.id ?? null,
          name: x?.name ?? "",
          addr: x?.address ?? "",
          type: x?.dataType ?? "",
          comment: x?.comment ?? "",
          watchable: x?.watchable ?? true,
        },
      };
    }
    case "sym/set":
      return { ...s, sym: { ...s.sym, ...a.patch } };
    case "newProject/set":
      return { ...s, newProject: { ...s.newProject, ...a.patch } };
    case "newProject/submitted":
      return { ...s, newProject: { ...s.newProject, open: false, code: "", name: "", deviceId: "" } };
    case "attach/open":
      return { ...s, attach: { open: true, deviceId: a.deviceId } };
    case "attach/set":
      return { ...s, attach: { ...s.attach, ...a.patch } };
    case "deploy/set":
      return { ...s, deploy: { ...s.deploy, ...a.patch } };
    case "fleet/set":
      return { ...s, fleet: { ...s.fleet, ...a.patch } };
    case "fleet/toggleDevice": {
      const ids = s.fleet.deviceIds;
      return {
        ...s,
        fleet: {
          ...s.fleet,
          deviceIds: ids.includes(a.deviceId) ? ids.filter((x) => x !== a.deviceId) : [...ids, a.deviceId],
        },
      };
    }
    default: {
      const _never: never = a;
      return s;
    }
  }
}

/**
 * Setter ổn định cho các trường FORM thuần (không thuộc chuỗi reset) — giữ tên setter cũ để JSX
 * của trang không đổi. Cố ý KHÔNG có setter cho projectId / artifactId / buildId / simResult /
 * diagnostics / watching / fleet.deviceIds: những trường đó chỉ đổi qua hành động có tên ở trên,
 * để chuỗi reset không thể bị bỏ qua.
 */
export function fieldSetters(dispatch: (a: WorkspaceAction) => void) {
  return {
    setProjSearch: (v: string) => dispatch({ type: "explorer/set", patch: { search: v } }),
    setProjKindFilter: (v: string) => dispatch({ type: "explorer/set", patch: { kindFilter: v } }),
    setCode: (v: string) => dispatch({ type: "code/set", code: v }),
    setLanguage: (v: string) => dispatch({ type: "language/set", language: v }),
    setEditorMode: (v: "code" | "visual") => dispatch({ type: "editorMode/set", mode: v }),
    setDiffBaseId: (v: number) => dispatch({ type: "diff/setBase", artifactId: v }),
    setDiffCompareId: (v: number) => dispatch({ type: "diff/setCompare", artifactId: v }),
    setNpOpen: (v: boolean) => dispatch({ type: "newProject/set", patch: { open: v } }),
    setNpCode: (v: string) => dispatch({ type: "newProject/set", patch: { code: v } }),
    setNpName: (v: string) => dispatch({ type: "newProject/set", patch: { name: v } }),
    setNpKind: (v: Kind) => dispatch({ type: "newProject/set", patch: { kind: v } }),
    setNpDeviceId: (v: string) => dispatch({ type: "newProject/set", patch: { deviceId: v } }),
    setAttachOpen: (v: boolean) => dispatch({ type: "attach/set", patch: { open: v } }),
    setAttachDeviceId: (v: string) => dispatch({ type: "attach/set", patch: { deviceId: v } }),
    setSymOpen: (v: boolean) => dispatch({ type: "sym/set", patch: { open: v } }),
    setSymName: (v: string) => dispatch({ type: "sym/set", patch: { name: v } }),
    setSymAddr: (v: string) => dispatch({ type: "sym/set", patch: { addr: v } }),
    setSymType: (v: string) => dispatch({ type: "sym/set", patch: { type: v } }),
    setSymComment: (v: string) => dispatch({ type: "sym/set", patch: { comment: v } }),
    setSymWatchable: (v: boolean) => dispatch({ type: "sym/set", patch: { watchable: v } }),
    setDeployStage: (v: Stage) => dispatch({ type: "deploy/set", patch: { stage: v } }),
    setSignOff: (v: boolean) => dispatch({ type: "deploy/set", patch: { signOff: v } }),
    setApproverId: (v: string) => dispatch({ type: "deploy/set", patch: { approverId: v } }),
    setDeployReason: (v: string) => dispatch({ type: "deploy/set", patch: { reason: v } }),
    setFleetStage: (v: Stage) => dispatch({ type: "fleet/set", patch: { stage: v } }),
    setFleetSignOff: (v: boolean) => dispatch({ type: "fleet/set", patch: { signOff: v } }),
    setFleetCanary: (v: number) => dispatch({ type: "fleet/set", patch: { canary: v } }),
    setFleetPromoteVerified: (v: boolean) => dispatch({ type: "fleet/set", patch: { promoteVerified: v } }),
    setFleetAutoRollback: (v: boolean) => dispatch({ type: "fleet/set", patch: { autoRollback: v } }),
    setFleetApproverId: (v: string) => dispatch({ type: "fleet/set", patch: { approverId: v } }),
    setFleetReason: (v: string) => dispatch({ type: "fleet/set", patch: { reason: v } }),
  };
}
