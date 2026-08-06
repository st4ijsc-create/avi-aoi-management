/**
 * ★★★ Pha 4 Task 4 — **PANEL VRAM ĐỌC TỪ BROKER.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO PANEL NÀY TỒN TẠI: HAI ĐỒNG HỒ ĐANG NÓI HAI SỐ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `AIBrainDashboard` in `vram.used / vram.total` lấy từ `trpc.aiGguf.health` ⇐
 * `llamaInstance.getVramState()` — **số THÔ của thiết bị, KHÔNG qua broker**. Bảy pha vừa rồi dựng
 * một phép ghép hoàn toàn khác (trần · sổ cục bộ + sổ chung · `computeHeadroom` · `applyEnforcement`)
 * và **chính con số đó** mới là thứ đang TỪ CHỐI các lượt xin. Hai nguồn số cho cùng một câu hỏi là
 * lớp lỗi "hai bản sao vị từ": người trực đọc card còn trống rồi không hiểu vì sao model không nạp
 * được. ⇒ Panel này đọc `trpc.vram.state` (⇐ `buildVramAgentState()` ⇐ `broker.decisionStateFor()`),
 * tức **đúng phép ghép mà `reserve()` chạy**.
 *
 * ⚠⚠ **KHÔNG MỘT CÂU CHỮ VIẾT TAY NÀO CHO KẾT CỤC LỆNH / Ô ĐỘ-CHẮC-CHẮN.** Mọi câu đi qua tám hàm
 * `translateVram*` của Task 3 (`client/src/lib/errorCodes.ts`) — ba locale, đã làm sạch, không
 * đường tiêm. Cổng (i) quét template literal chứa CẢ `outcome` LẪN `reason`/`rowKind`/`durability`
 * — và nó vừa BẮT ĐƯỢC chính khối chú thích này ở bản đầu (nó quét **văn bản thô**, kể cả comment),
 * nên đoạn mẫu ấy đã bị gỡ. Nhưng cổng đó **mù** với biến trung gian, `+`, `.join()` và với việc
 * render thô một trường mô tả trong JSX; **mù không phải là cho phép** — file này KHÔNG render
 * `reason`/`rowKind`/`durability` thô ở bất kỳ đâu.
 *
 * ⚠ `owner`/`leaseKey` **KHÔNG BAO GIỜ bị cắt ngắn**: chúng là DANH TÍNH mà Agent/người vận hành
 * lấy từ mặt đọc rồi truyền THẲNG vào lệnh (ràng buộc 3). Dùng `break-all`, không dùng `slice()`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * 🟠 F1 / I-1 (nghiệm thu sống → review TOÀN NHÁNH) — **HAI NÚT PHÁ HUỶ TỪNG KHÔNG BẤM ĐƯỢC VỚI
 * BẤT KỲ VAI NÀO.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `.env:568` → `ACTUATION_STEPUP_2FA=true` (cấu hình ĐANG CHẠY). `vramRouter.preempt` và
 * `releaseStale` đứng trên `deployProcedure = actuationProcedure.use(requireFreshTotp)`
 * (`_core/trpc.ts:450`), và `requireFreshTotp` đọc `totpCode` **từ raw input**: thiếu ⇒
 * `FORBIDDEN INVALID_VALUE{field:"twoFactorCode"}`. Panel **không gửi `totpCode`** ⇒ **lượt bấm
 * ĐẦU TIÊN của mọi phiên luôn 403**, với mọi vai. Hệ quả kép: `onSuccess` — chỗ **duy nhất** gọi
 * `translateVramPreemptCommand`/`translateVramReleaseStaleCommand` — là **nhánh không tới được từ
 * UI**, nên "người đọc thật" của Task 4 chỉ là **5/8 câu**, không phải 8/8.
 *
 * ⚠ Bản vá dùng **ĐÚNG khuôn ba màn đang chạy** (`EngineeringWorkspace.tsx:1248,1454,1907` ·
 * `ApprovalsInbox.tsx` · `OrchestrationStudio.tsx`): `stepUp.guard((totpCode) => m.mutate({…,
 * totpCode}))` + render `{stepUp.dialog}` **một lần**. KHÔNG hook thứ hai, KHÔNG dialog tự viết.
 * ⚠ `retryDeferred` đứng trên `actuationProcedure` (KHÔNG có `requireFreshTotp`) và `input` của nó
 * **không khai** `totpCode` ⇒ bọc nó vào step-up là gửi một khoá mà `z.object().strict()` từ chối.
 * Ba lệnh, hai sàn khác nhau — và đó là **chủ ý** (`vramRouter.ts:42-44`), không phải thiếu sót.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { usePollingInterval } from "@/hooks/usePollingInterval";
import { mapTrpcError } from "@/lib/trpcErrors";
import {
  vramRetryButtonDisabled,
  vramDestructiveButtonDisabled,
  type VramCommandReach,
} from "@/lib/vramCommandReach";
/**
 * ★ Pha 5 Task 2 (C-1) — mặt đọc có thể TỪ CHỐI, và trước bản này file không biết điều đó tồn tại
 * (tập truy cập thuộc tính trên `state` đúng bằng `["data","isLoading","refetch"]` ⇒ FORBIDDEN cho
 * khung xương QUAY MÃI MÃI). Quyết định "đọc không được thì nói gì" ở **một** chỗ, dùng chung với
 * thẻ KPI của `AIBrainDashboard` — không hai bản sao.
 */
import {
  vramReadSurfaceKind,
  vramReadSurfaceErrorCode,
  VRAM_READ_SURFACE_NOTICE,
} from "@/lib/vramReadSurface";
/** ★ F1 — step-up 2FA cho HAI lệnh phá huỷ. Hook ĐÃ CÓ, 3 màn khác đang dùng đúng khuôn này. */
import { useStepUpOtp } from "@/components/security/StepUpOtpDialog";
import {
  translateVramScope,
  translateVramHostedHere,
  translateVramHolderListIsLowerBound,
  translateVramEstimateUsable,
  translateVramNonFiniteFields,
  translateVramPreemptCommand,
  translateVramReleaseStaleCommand,
  translateVramRetryDeferredCommand,
} from "@/lib/errorCodes";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Gauge, ShieldAlert, RotateCcw, Trash2, Ban } from "lucide-react";

const MIB = 1024 * 1024;

/** MiB chỉ ở câu chữ (Đ4). `null` ra chữ, **không** ra `0` — `0` là một lời khẳng định. */
function fmtMiB(bytes: number | null | undefined, unknown: string): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return unknown;
  return `${Math.round(bytes / MIB).toLocaleString()} MiB`;
}

interface Props {
  /**
   * ★★★ Pha 5 Task 3 (N9) — tầm với của vai đang đăng nhập trên mặt lệnh VRAM.
   *
   * ⚠⚠ Trước bản này ô này là một `boolean` tên `canCommand`, và màn cha đổ thẳng `isOpsRole`
   * (`admin || engineer`) vào ⇒ `supervisor` **không bao giờ** bấm được, còn `engineer` thấy hai nút
   * **chắc chắn 403** (`canDelete` không có). Nay là một **KIỂU** chỉ `vramCommandReach(...)` tạo ra
   * được, mang **hai** ô đúng bằng **hai** sàn quyền của máy chủ.
   * ⚠ Máy chủ vẫn cưỡng chế **độc lập** (role-floor + 2FA + step-up + `requirePermission`).
   */
  commandReach: VramCommandReach;
  /**
   * Nhịp poll dùng chung với dashboard (`usePollingInterval` — đã tạm dừng khi tab ẩn).
   * ⚠ Kiểu lấy THẲNG từ hook, không khai lại bằng tay: bản đầu viết
   * `{ refetchOnWindowFocus?: boolean }` và `tsc` bắt ngay (hook trả `"always"`).
   */
  polling: ReturnType<typeof usePollingInterval>;
}

export function VramBrokerPanel({ commandReach, polling }: Props) {
  const { t } = useTranslation();
  const stepUp = useStepUpOtp();
  const state = trpc.vram.state.useQuery(undefined, { ...polling });
  /** Câu KẾT CỤC gần nhất của một lệnh — LUÔN là đầu ra của một hàm `translateVram*Command`. */
  const [lastOutcome, setLastOutcome] = useState<string | null>(null);

  const onFail = (err: unknown) =>
    toast.error(t("vramBroker.commandError", "Lệnh VRAM không chạy được."), {
      description: mapTrpcError(err as never),
    });

  const preempt = trpc.vram.preempt.useMutation({
    onSuccess: (r) => {
      // ★ Cổng (ii) — call-site SẢN PHẨM của `translateVramPreemptCommand`.
      // ⚠ `detailTruncated` ĐỌC từ máy chủ (nguồn duy nhất), KHÔNG đo `detail.length` ở đây.
      const sentence = translateVramPreemptCommand({
        outcome: r.outcome,
        reason: r.reason,
        owner: r.owner,
        detail: r.detail,
        detailTruncated: r.detailTruncated,
        freedBytes: r.freedBytes,
      });
      setLastOutcome(sentence);
      state.refetch();
    },
    onError: onFail,
  });

  const releaseStale = trpc.vram.releaseStale.useMutation({
    onSuccess: (r) => {
      // ★ Cổng (ii) — call-site SẢN PHẨM của `translateVramReleaseStaleCommand`.
      const sentence = translateVramReleaseStaleCommand({
        outcome: r.outcome,
        reason: r.reason,
        leaseKey: r.leaseKey,
        processKey: r.processKey,
        rowKind: r.rowKind,
        durability: r.durability,
      });
      setLastOutcome(sentence);
      state.refetch();
    },
    onError: onFail,
  });

  const retryDeferred = trpc.vram.retryDeferred.useMutation({
    onSuccess: (r) => {
      // ★ Cổng (ii) — call-site SẢN PHẨM của `translateVramRetryDeferredCommand`.
      const sentence = translateVramRetryDeferredCommand({
        outcome: r.outcome,
        reason: r.reason,
        owner: r.owner,
        host: r.host,
      });
      setLastOutcome(sentence);
      state.refetch();
    },
    onError: onFail,
  });

  const s = state.data;
  /**
   * ⚠ Đọc `isError` + mã lỗi **trước** mọi thứ khác: một lượt TỪ CHỐI QUYỀN không được đi tiếp vào
   * nhánh "chưa có số". `kind` là ô DUY NHẤT quyết định phần thân dưới đây.
   */
  const kind = vramReadSurfaceKind({
    isLoading: state.isLoading,
    isError: state.isError,
    errorCode: vramReadSurfaceErrorCode(state.error),
    hasData: s !== undefined,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Gauge className="h-4 w-4 text-primary" />
          {t("vramBroker.title", "Bộ điều phối VRAM (số ĐANG CƯỠNG CHẾ)")}
        </CardTitle>
        <CardDescription>
          {t(
            "vramBroker.subtitle",
            "Đọc từ chính phép ghép mà reserve() chạy — không phải số thô của thiết bị. Mỗi ô nói đúng độ chắc chắn của nó.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {kind === "loading" ? (
          <>
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-20 w-full" />
          </>
        ) : kind !== "ready" || s === undefined ? (
          /**
           * ⚠⚠ MỘT LƯỢT TỪ CHỐI QUYỀN NÓI ĐÚNG LÀ MỘT LƯỢT TỪ CHỐI QUYỀN. Không khung xương vĩnh
           * viễn, không một chữ nào về phần cứng. `s === undefined` đứng cùng vế chỉ để `tsc` thu
           * hẹp kiểu — nó **không** thêm một đường quyết định thứ hai.
           */
          <div
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive"
            role="status"
          >
            <ShieldAlert className="size-4 shrink-0 mt-0.5" />
            <span>
              {t(
                VRAM_READ_SURFACE_NOTICE[kind === "denied" ? "denied" : "unreadable"].key,
                VRAM_READ_SURFACE_NOTICE[kind === "denied" ? "denied" : "unreadable"].fallback,
              )}
            </span>
          </div>
        ) : (
          <>
            {/* ── Dư địa + độ chắc chắn ─────────────────────────────────────────────────── */}
            <div>
              <div className="text-lg font-semibold">
                {fmtMiB(s.headroom.effectiveBytes, t("vramBroker.unknown", "KHÔNG BIẾT"))}
                <span className="text-sm text-muted-foreground font-normal">
                  {" / "}
                  {fmtMiB(s.headroom.ceilingBytes, t("vramBroker.unknown", "KHÔNG BIẾT"))}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <Badge variant="outline">basis: {s.headroom.basis}</Badge>
                {s.headroom.blind ? (
                  <Badge variant="destructive">
                    {t("vramBroker.blind", "MÙ — con số này là CHẶN TRÊN, không phải trạng thái an toàn")}
                  </Badge>
                ) : null}
                <Badge variant={s.headroom.trusted ? "default" : "secondary"}>
                  {s.headroom.trusted
                    ? t("vramBroker.trusted", "tin cậy")
                    : t("vramBroker.untrusted", "ĐANG SUY GIẢM")}
                </Badge>
                {s.headroom.degradedReasons.map((r) => (
                  <Badge key={r} variant="secondary">
                    {r}
                  </Badge>
                ))}
                {s.baseline.verified ? null : (
                  <Badge variant="secondary">
                    {t("vramBroker.baselineUnverified", "nền CHƯA xác minh")}
                    {s.baseline.unverifiedReasons === null
                      ? ` · ${t("vramBroker.noTickYet", "chưa có nhịp nào")}`
                      : s.baseline.unverifiedReasons.length === 0
                        ? ""
                        : ` · ${s.baseline.unverifiedReasons.join(", ")}`}
                  </Badge>
                )}
              </div>
              {/* ★ translateVramScope — phạm vi quan sát của MỌI ô hoãn ở dưới. */}
              <p className="text-xs text-muted-foreground mt-2">{translateVramScope(s.defer.scope)}</p>
              {/* ★ translateVramNonFiniteFields — mảng rỗng CŨNG là một câu trả lời. */}
              <p className="text-xs text-muted-foreground mt-1">{translateVramNonFiniteFields(s.nonFiniteFields)}</p>
            </div>

            {/* ── Ước lượng ngoài sổ + số lượt beginVramAllocation() hỏng ────────────────── */}
            <div className="rounded-md border p-3">
              <div className="text-sm font-medium">
                {t("vramBroker.unledgered", "Chạy NGOÀI sổ (ước lượng)")}:{" "}
                {fmtMiB(s.unledgered.estimateBytes, t("vramBroker.unknown", "KHÔNG BIẾT"))}
              </div>
              {/* ★ translateVramEstimateUsable — nói cả "là ước lượng" LẪN "có dùng được để tính không". */}
              <p className="text-xs text-muted-foreground mt-1">
                {translateVramEstimateUsable(s.unledgered.estimateUsable, s.unledgered.unknownCount)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("vramBroker.beginFailures", "Lượt beginVramAllocation() đã hỏng")}:{" "}
                {s.unledgered.beginFailureCount ?? "?"}
                {s.unledgered.lastReason === null ? "" : ` · ${s.unledgered.lastReason}`}
              </p>
            </div>

            {/* ── Hộ đang giữ: cục bộ + ANH EM ──────────────────────────────────────────── */}
            <div>
              <div className="text-sm font-medium">
                {t("vramBroker.holders", "Đang giữ theo sổ")} ·{" "}
                {t("vramBroker.local", "cục bộ")} {fmtMiB(s.ledger.localBytes, "?")} ·{" "}
                {t("vramBroker.foreign", "anh em")}{" "}
                {s.ledger.foreign.known
                  ? fmtMiB(s.ledger.foreign.bytes, "?")
                  : t("vramBroker.blindToSiblings", "ĐANG MÙ (chưa làm mới sổ chung lần nào)")}
              </div>
              {/* ★ translateVramHolderListIsLowerBound — danh sách rỗng KHÔNG nghĩa là card trống. */}
              <p className="text-xs text-muted-foreground mt-1">{translateVramHolderListIsLowerBound()}</p>
              {/*
                ★★★ I-3 (F, review vòng 1) — BA ô `unattributed.*` trước đó **không ai đọc**: câu
                cảnh báo ở trên là câu TĨNH (hàm dịch không nhận tham số — đúng, vì cờ LUÔN `true`),
                nên nó không mang được ba con số nói *"cận dưới tới mức nào"*. Thiếu chúng, người đọc
                biết "đây là cận dưới" mà không biết nó hụt bao nhiêu.
                ⚠ `excludesBaselineBytes` LUÔN `true` và **phải nói ra**: con số ngoài-sổ đã TRỪ toàn
                bộ NỀN THIẾT BỊ, nên `0` KHÔNG nghĩa là cả card đã được giải thích.
              */}
              <p className="text-xs text-muted-foreground mt-1">
                {t("vramBroker.coverage", "Độ phủ của sổ")}: {s.unattributed.wiredSiteCount ?? "?"}/
                {s.unattributed.knownSiteRowCount ?? "?"} {t("vramBroker.sites", "điểm cấp phát đã nối")} ·{" "}
                {t("vramBroker.unattributedBytes", "ngoài sổ")}{" "}
                {fmtMiB(s.unattributed.bytes, t("vramBroker.unknown", "KHÔNG BIẾT"))}
                {s.unattributed.excludesBaselineBytes
                  ? ` · ${t("vramBroker.excludesBaseline", "con số này ĐÃ TRỪ toàn bộ NỀN THIẾT BỊ — 0 KHÔNG nghĩa là cả card đã được giải thích")}`
                  : ""}
              </p>
              <div className="flex flex-col gap-2 mt-2">
                {[...s.ledger.localHolders, ...(s.ledger.foreign.known ? s.ledger.foreign.holders : [])].map((h) => (
                  <div
                    key={`${h.processKey ?? "self"}#${h.leaseKey ?? h.owner}`}
                    className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-xs"
                  >
                    {/* ⚠ owner KHÔNG cắt ngắn — danh tính đi thẳng vào lệnh. */}
                    <span className="font-mono break-all">{h.owner}</span>
                    <Badge variant="outline">{h.kind}</Badge>
                    <Badge variant="outline">{h.priority}</Badge>
                    <span className="text-muted-foreground">{fmtMiB(h.bytes, "?")}</span>
                    {h.measured ? null : (
                      <Badge variant="secondary">{t("vramBroker.estimated", "ước lượng")}</Badge>
                    )}
                    {h.processKey === null ? null : (
                      <Badge variant="secondary" className="font-mono">
                        {h.processKey}
                      </Badge>
                    )}
                    {h.ttlExpired ? (
                      <Badge variant="destructive">
                        {t("vramBroker.ttlExpired", "quá TTL — KHÔNG có nhịp nào tự gặt, phải ra lệnh")}
                      </Badge>
                    ) : null}
                    {h.reclaim.kind === "reclaimable-here" ? (
                      <Button
                        data-testid="vram-preempt"
                        size="sm"
                        variant="destructive"
                        /*
                          ★★★ N9 — MỘT Ô DUY NHẤT, và nó là một LỜI GỌI. `commandReach.destructive`
                          KHÔNG được đọc ở bất kỳ đâu khác trong file này (lưới canh việc đó): mọi
                          `||`/`?:`/`&&`/biến trung gian/điều kiện bọc render đều là một ô THỨ HAI.
                        */
                        disabled={vramDestructiveButtonDisabled(commandReach, preempt.isPending)}
                        // ★ F1 — `deployProcedure` + `ACTUATION_STEPUP_2FA=true` ⇒ KHÔNG có
                        // `totpCode` thì lượt bấm đầu tiên của mọi phiên luôn 403.
                        onClick={() => stepUp.guard((totpCode) => preempt.mutate({ owner: h.owner, totpCode }))}
                      >
                        <Trash2 className="h-3 w-3 mr-1" />
                        {t("vramBroker.preempt", "Thu hồi")} ({h.reclaim.reclaimer})
                      </Button>
                    ) : h.reclaim.kind === "declared-by-owner-process" ? (
                      <span className="text-muted-foreground inline-flex items-center gap-1">
                        <Ban className="h-3 w-3" />
                        {t(
                          "vramBroker.ownerProcessOnly",
                          "chỉ tiến trình chủ thu hồi được — lệnh từ đây sẽ bị từ chối",
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground inline-flex items-center gap-1">
                        <Ban className="h-3 w-3" />
                        {t("vramBroker.noCommandReaches", "không lệnh nào với tới")}
                      </span>
                    )}
                    {h.leaseKey === null ? null : (
                      <Button
                        data-testid="vram-release-stale"
                        size="sm"
                        variant="outline"
                        /* ★★★ N9 — cùng sàn `canDelete` với `preempt` ⇒ cùng MỘT lời gọi. */
                        disabled={vramDestructiveButtonDisabled(commandReach, releaseStale.isPending)}
                        // ★ F1 — cùng sàn `deployProcedure` với `preempt`: phải có `totpCode`.
                        onClick={() =>
                          stepUp.guard((totpCode) => releaseStale.mutate({ leaseKey: h.leaseKey!, totpCode }))
                        }
                      >
                        <ShieldAlert className="h-3 w-3 mr-1" />
                        {t("vramBroker.releaseStale", "Kiểm rồi dọn nếu đã chết")}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* ── Sáu hộ nền: đang hoãn / KHÔNG CÓ cơ chế hoãn — không gộp ───────────────── */}
            <div>
              <div className="text-sm font-medium">{t("vramBroker.deferHosts", "Hộ nền (background)")}</div>
              <div className="flex flex-col gap-2 mt-2">
                {s.defer.hosts.map((h) => {
                  const owner =
                    h.status.kind === "deferring" || h.status.kind === "exceeded" ? h.status.owner : h.host;
                  return (
                    <div key={h.host} className="rounded-md border p-2 text-xs flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono break-all">{h.host}</span>
                        <Badge variant="outline">
                          {h.mechanism === "waits-and-retries"
                            ? t("vramBroker.waits", "có chờ + thử lại")
                            : t("vramBroker.noWait", "KHÔNG có cơ chế chờ — suy giảm tại chỗ")}
                        </Badge>
                        {h.status.kind === "deferring" ? (
                          <Badge variant="secondary">{t("vramBroker.deferring", "đang hoãn")}</Badge>
                        ) : h.status.kind === "exceeded" ? (
                          <Badge variant="destructive">{t("vramBroker.exceeded", "đã quá đáy hoãn")}</Badge>
                        ) : null}
                        {/*
                          ★★★ I-1 + N-5 — **MỘT Ô DUY NHẤT quyết định nút này bấm được hay không**,
                          và nó là `disabled`. Bản trước bọc nút trong `{canRetry ? … : null}`: bất
                          biến đúng nhưng **neo sai một nấc** — người review giữ nguyên khai báo
                          `canRetry` rồi đặt `||` ở ĐIỂM DÙNG và khôi phục nguyên vẹn lỗi (D) trong
                          khi lưới vẫn XANH. Nay `disabled` **LÀ** một lời gọi
                          `vramRetryButtonDisabled(...)`; thêm bất kỳ `||`/`?:`/biến trung gian nào
                          đều làm nó **thôi LÀ** lời gọi ấy ⇒ lưới ĐỎ.
                          ⚠ Nút LUÔN render (không bọc điều kiện): nút biến mất là chiều an toàn;
                          thứ nguy hiểm là một nút **bấm được** cho lệnh chắc chắn bị từ chối.
                        */}
                        <Button
                          data-testid="vram-retry"
                          size="sm"
                          variant="outline"
                          disabled={vramRetryButtonDisabled(h.retryReach.kind, commandReach, retryDeferred.isPending)}
                          onClick={() => retryDeferred.mutate({ owner })}
                        >
                          <RotateCcw className="h-3 w-3 mr-1" />
                          {t("vramBroker.retryNow", "Thử lại ngay")}
                        </Button>
                      </div>
                      {/* ★ translateVramHostedHere — `null` KHÔNG được đọc thành `false`. */}
                      <p className="text-muted-foreground">{translateVramHostedHere(h.hostedHere)}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Câu KẾT CỤC của lệnh gần nhất — LUÔN từ lớp dịch, không ghép tay ───────── */}
            {lastOutcome === null ? null : (
              <div className="rounded-md border bg-muted/40 p-3 text-xs" role="status">
                {lastOutcome}
              </div>
            )}
          </>
        )}
        {/* ★ F1 — dialog OTP render MỘT LẦN cho cả hai nút phá huỷ (khuôn của 3 màn đang chạy). */}
        {stepUp.dialog}
      </CardContent>
    </Card>
  );
}
