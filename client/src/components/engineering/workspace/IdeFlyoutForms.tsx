/**
 * doc 81 Đợt 8 task P1 — ba form sheet của IDE `/engineering` trên `FlyoutHost` (thay `<Sheet open={state}>` tự quản):
 *
 *   `?flyout=ide-new-project`             Dự án mới
 *   `?flyout=ide-symbol&flyoutId=<id|"">` Thêm biến (id rỗng) / Sửa biến <id> của dự án đang mở
 *   `?flyout=ide-attach&flyoutId=<pid>`   Gắn / đổi thiết bị nguồn cho dự án <pid>
 *
 * URL là nguồn sự thật (F5 / Back / deep link — FlyoutHost). Mỗi lần MỞ là một form MỚI (state cục bộ, khởi tạo từ bản
 * ghi theo id trong URL), nên "Bỏ thay đổi" bỏ thật; form báo dữ liệu chưa lưu qua `layer.setDirty` (Esc / Back / Huỷ ⇒
 * hỏi). Lưu thành công ⇒ `done()` đóng CHÍNH lớp của nó (useCloseOwnLayer). Lỗi server ⇒ lớp GIỮ mở với dữ liệu đã nhập.
 * Payload gửi server y hệt các sheet cũ (không đổi hợp đồng).
 *
 * Đợt cuối Đợt 8 (review P): #1 — form SỬA biến chỉ được dựng SAU một lượt tải lại danh sách biến bắt đầu từ lúc mở lớp
 * (IdeSymbolEditGate), nên giá trị khởi tạo không bao giờ lấy từ bản cache cũ (Lưu không ghi đè dữ liệu mới hơn của server);
 * #2 — lỗi tải danh sách là "lỗi tải", KHÔNG phải "không tìm thấy"; #3 — "Bỏ thay đổi" khi Tạo dự án đang chạy ⇒ kết quả về
 * sau bị BỎ QUA (không mở dự án vừa tạo; chỉ làm mới danh sách).
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { WifiOff } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { useCloseOwnLayer } from "@/components/patterns/useCloseOwnLayer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KINDS, type Kind } from "./programKinds";

export const IDE_FLYOUT = {
  newProject: "ide-new-project",
  symbol: "ide-symbol",
  attach: "ide-attach",
} as const;

export interface IdeMachineOption {
  id: number;
  name: string;
}

export interface IdeSymbolRow {
  id: number;
  name: string;
  address: string | null;
  dataType: string | null;
  comment: string | null;
  watchable: boolean;
}

/** Danh sách máy cho ô "Thiết bị nguồn" (dùng chung cho Dự án mới và Gắn thiết bị). */
function MachineSelect({ id, value, onChange, machines }: { id: string; value: string; onChange: (v: string) => void; machines: IdeMachineOption[] }) {
  const { t } = useTranslation();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id}>
        <SelectValue placeholder={t("engineering.sourceDevicePh", "Chọn thiết bị (tùy chọn)…")} />
      </SelectTrigger>
      <SelectContent>
        {machines.map((m) => (
          <SelectItem key={m.id} value={String(m.id)}>{m.name} · #{m.id}</SelectItem>
        ))}
        {machines.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {t("engineering.noMachines", "Chưa có máy nào — có thể gắn sau ở Online Monitor")}
          </div>
        )}
      </SelectContent>
    </Select>
  );
}

function FormFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex justify-end gap-2 border-t pt-3">{children}</div>;
}

// ── Dự án mới ─────────────────────────────────────────────────────────────────────────────────────
export function IdeNewProjectForm({
  machines,
  isImplemented,
  canCreate,
  createReason,
  onCreated,
}: {
  machines: IdeMachineOption[];
  isImplemented: (k: string) => boolean;
  canCreate: boolean;
  createReason?: string;
  /** Như createProject.onSuccess cũ của trang: toast + làm mới danh sách + mở SẠCH dự án mới (R-2-r). */
  onCreated: (row: { id: number }) => void;
}) {
  const { t } = useTranslation();
  const { layer, done, mountedRef } = useCloseOwnLayer();
  const utils = trpc.useUtils();
  const fid = useId();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("stub");
  // U2 — thiết bị nguồn (tùy chọn); "" = chưa gắn.
  const [deviceId, setDeviceId] = useState("");
  const dirty = code !== "" || name !== "" || kind !== "stub" || deviceId !== "";
  useEffect(() => { layer.setDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const createProject = trpc.programming.createProject.useMutation({
    onSuccess: (row) => {
      // review P #3 — the layer was discarded while the create was in flight ⇒ ignore the result (the project exists on the
      // server: the list is refreshed, but it is NOT opened behind the user's back).
      if (!mountedRef.current) {
        void utils.programming.listProjects.invalidate();
        return;
      }
      onCreated(row);
      done();
    },
    onError: (e) => {
      if (mountedRef.current) toastTrpcError(e);
    },
  });

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor={`${fid}-code`}>{t("engineering.code", "Mã")}</Label>
        <Input id={`${fid}-code`} value={code} onChange={(e) => setCode(e.target.value)} placeholder="ZMC-CELL-01" />
      </div>
      <div>
        <Label htmlFor={`${fid}-name`}>{t("engineering.name", "Tên")}</Label>
        <Input id={`${fid}-name`} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <Label htmlFor={`${fid}-kind`}>{t("engineering.kind", "Loại thiết bị")}</Label>
        <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
          <SelectTrigger id={`${fid}-kind`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {k}{isImplemented(k) ? "" : ` (${t("engineering.planned", "sắp có")})`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {/* U2 — thiết bị nguồn (tùy chọn): gắn ngay để mở khoá Online Monitor sau này. */}
      <div>
        <Label htmlFor={`${fid}-device`}>{t("engineering.sourceDevice", "Thiết bị nguồn")}</Label>
        <MachineSelect id={`${fid}-device`} value={deviceId} onChange={setDeviceId} machines={machines} />
        <p className="mt-1 text-xs text-muted-foreground">
          {t("engineering.sourceDeviceHint", "Gắn thiết bị để mở khoá theo dõi trực tiếp (Online Monitor). Có thể để trống rồi gắn sau.")}
        </p>
      </div>
      <FormFooter>
        <Button
          disabled={!canCreate || !code || !name || createProject.isPending}
          title={createReason}
          onClick={() =>
            createProject.mutate({
              code,
              name,
              kind,
              deviceId: deviceId ? Number(deviceId) : undefined,
            })
          }
        >
          {t("common.create", "Tạo")}
        </Button>
      </FormFooter>
    </div>
  );
}

// ── Thêm / sửa biến (bảng tag) ────────────────────────────────────────────────────────────────────
export function IdeSymbolForm({
  symbol,
  projectId,
  canEdit,
  editReason,
}: {
  /** null ⇒ thêm biến mới. */
  symbol: IdeSymbolRow | null;
  projectId: number;
  canEdit: boolean;
  editReason?: string;
}) {
  const { t } = useTranslation();
  const { layer, done } = useCloseOwnLayer();
  const utils = trpc.useUtils();
  const fid = useId();
  const [initial] = useState(() => ({
    name: symbol?.name ?? "",
    addr: symbol?.address ?? "",
    type: symbol?.dataType ?? "",
    comment: symbol?.comment ?? "",
    watchable: symbol?.watchable ?? true,
  }));
  const [name, setName] = useState(initial.name);
  const [addr, setAddr] = useState(initial.addr);
  const [type, setType] = useState(initial.type);
  const [comment, setComment] = useState(initial.comment);
  const [watchable, setWatchable] = useState(initial.watchable);
  const dirty =
    name !== initial.name || addr !== initial.addr || type !== initial.type || comment !== initial.comment || watchable !== initial.watchable;
  useEffect(() => { layer.setDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const upsertSymbol = trpc.programming.upsertSymbol.useMutation({
    onSuccess: () => {
      toast.success(t("engineering.symbolSaved", "Đã lưu biến"));
      utils.programming.listSymbols.invalidate();
      done();
    },
    onError: (e) => toastTrpcError(e),
  });

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor={`${fid}-name`}>{t("engineering.symbolName", "Tên")}</Label>
        <Input id={`${fid}-name`} value={name} onChange={(e) => setName(e.target.value)} placeholder="X0 / Motor_Speed" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor={`${fid}-addr`}>{t("engineering.address", "Địa chỉ")}</Label>
          <Input id={`${fid}-addr`} value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="D100 / %MW10" />
        </div>
        <div>
          <Label htmlFor={`${fid}-type`}>{t("engineering.dataType", "Kiểu")}</Label>
          <Input id={`${fid}-type`} value={type} onChange={(e) => setType(e.target.value)} placeholder="INT / BOOL / REAL" />
        </div>
      </div>
      <div>
        <Label htmlFor={`${fid}-comment`}>{t("engineering.comment", "Ghi chú")}</Label>
        <Input id={`${fid}-comment`} value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={watchable} onCheckedChange={(v) => setWatchable(Boolean(v))} />
        {t("engineering.watchable", "Cho phép theo dõi (watch)")}
      </label>
      <FormFooter>
        <Button
          disabled={!canEdit || !name.trim() || upsertSymbol.isPending}
          title={editReason}
          onClick={() =>
            upsertSymbol.mutate({
              projectId,
              name: name.trim(),
              address: addr.trim() || undefined,
              dataType: type.trim() || undefined,
              comment: comment.trim() || undefined,
              watchable,
            })
          }
        >
          {t("common.save", "Lưu")}
        </Button>
      </FormFooter>
    </div>
  );
}

/**
 * review P #1 / #2 — the EDIT form of symbol <symbolId> mounts only after a reload of the project's symbol list that
 * STARTED when this layer opened (a cached row may be older than the server's: its values would prefill the form and a Save
 * would overwrite newer data). Until then: "loading". The reload failing ⇒ "could not load" (never "not found"); the id
 * absent from the FRESH list ⇒ "not found" (no Save). Once mounted, the form keeps its values (later refetches never
 * re-initialise a form being edited).
 */
export function IdeSymbolEditGate({
  projectId,
  symbolId,
  canEdit,
  editReason,
  note,
}: {
  projectId: number;
  symbolId: string;
  canEdit: boolean;
  editReason?: string;
  note: (text: string, testId?: string) => ReactNode;
}) {
  const { t } = useTranslation();
  const q = trpc.programming.listSymbols.useQuery({ projectId });
  const [reloaded, setReloaded] = useState(false);
  useEffect(() => {
    let live = true;
    // settled (ok OR failed) ⇒ judge by the query's own state below (a failed reload ⇒ q.isError, cached data or not)
    Promise.resolve()
      .then(() => q.refetch())
      .catch(() => undefined)
      .finally(() => {
        if (live) setReloaded(true);
      });
    return () => {
      live = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — ONE reload per opened layer
  const [frozen, setFrozen] = useState<IdeSymbolRow | null>(null);
  const fresh = reloaded && !q.isError ? ((q.data ?? []) as IdeSymbolRow[]).find((x) => String(x.id) === symbolId) ?? null : null;
  useEffect(() => {
    if (fresh && !frozen) setFrozen(fresh);
  }, [fresh, frozen]);
  if (frozen) return <IdeSymbolForm key={`${projectId}:${frozen.id}`} symbol={frozen} projectId={projectId} canEdit={canEdit} editReason={editReason} />;
  if (!reloaded) return note(t("common.loading", "Đang tải..."), "ide-symbol-loading");
  if (q.isError) return note(t("engineering.symbolLoadError", "Không tải được danh sách biến — thử lại sau (chưa sửa gì)."), "ide-symbol-error");
  if (!fresh) return note(t("engineering.symbolNotFound", "Không tìm thấy biến #{{id}} trong dự án đang mở.", { id: symbolId }), "ide-symbol-missing");
  return note(t("common.loading", "Đang tải..."), "ide-symbol-loading"); // fresh row found: the form mounts on the next render
}

// ── Gắn / đổi thiết bị nguồn (U2) ─────────────────────────────────────────────────────────────────
export function IdeAttachForm({
  project,
  machines,
  canEdit,
  editReason,
}: {
  project: { id: number; deviceId: number | null };
  machines: IdeMachineOption[];
  canEdit: boolean;
  editReason?: string;
}) {
  const { t } = useTranslation();
  const { layer, done } = useCloseOwnLayer();
  const utils = trpc.useUtils();
  const fid = useId();
  const [initial] = useState(() => (project.deviceId != null ? String(project.deviceId) : ""));
  const [deviceId, setDeviceId] = useState(initial);
  const dirty = deviceId !== initial;
  useEffect(() => { layer.setDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateProject = trpc.programming.updateProject.useMutation({
    onSuccess: () => {
      toast.success(t("engineering.deviceAttached", "Đã cập nhật thiết bị nguồn"));
      utils.programming.listProjects.invalidate();
      done();
    },
    onError: (e) => toastTrpcError(e),
  });

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor={`${fid}-device`}>{t("engineering.sourceDevice", "Thiết bị nguồn")}</Label>
        <MachineSelect id={`${fid}-device`} value={deviceId} onChange={setDeviceId} machines={machines} />
      </div>
      {project.deviceId != null && (
        // Cho phép gỡ gắn (đặt lại về chưa gắn thiết bị).
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          disabled={!canEdit || updateProject.isPending}
          title={editReason}
          onClick={() => updateProject.mutate({ id: project.id, deviceId: null })}
        >
          <WifiOff className="mr-1 h-4 w-4" /> {t("engineering.detachDevice", "Gỡ gắn thiết bị")}
        </Button>
      )}
      <FormFooter>
        <Button
          disabled={!canEdit || !deviceId || updateProject.isPending}
          title={editReason}
          onClick={() => updateProject.mutate({ id: project.id, deviceId: Number(deviceId) })}
        >
          {t("common.save", "Lưu")}
        </Button>
      </FormFooter>
    </div>
  );
}
