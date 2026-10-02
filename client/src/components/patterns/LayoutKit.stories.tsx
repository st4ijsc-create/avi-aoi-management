import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Code2, FolderTree, GitBranch, Rocket, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EngineeringShell } from "@/components/engineering/shell/EngineeringShell";
import { PageHeaderCompact } from "./PageHeaderCompact";
import { NoticeStack, WhenToUseHint } from "./NoticeChip";
import { StatusChipStrip } from "./StatusChipStrip";
import { FlyoutHost, useFlyout, useFlyoutLayer } from "./FlyoutHost";
import { DetailSheet } from "./DetailSheet";
import { WizardDialog } from "./WizardDialog";
import { VersionHistoryPanel } from "./VersionHistoryPanel";
import { RollbackConfirm } from "./RollbackConfirm";
import { ApprovalQueue } from "./ApprovalQueue";
import { SplitListDetail } from "./SplitListDetail";
import { CockpitLayout } from "./CockpitLayout";

/**
 * Doc 81 Đợt 2 Task 3 — bộ layout dùng chung cho 14 màn Kỹ thuật & Điều khiển.
 * Mỗi story dựng component THẬT với dữ liệu giả cố định; i18n do preview.ts khởi tạo.
 * Dấu đo `data-layout-*` xem `layoutMarkers.ts`.
 */
const meta: Meta = {
  title: "Patterns/LayoutKit (doc 81 Đợt 2)",
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj;

const chips = (
  <StatusChipStrip
    items={[
      { id: "ok", label: "Đang chạy", value: 12, state: "ok", source: "fleet.tasks (DB)" },
      { id: "loading", label: "Chờ sạc", value: null, state: "loading", source: "fleet.chargers" },
      { id: "error", label: "Cảnh báo", value: 0, state: "error", source: "safety.events" },
      { id: "degraded", label: "Chờ duyệt", value: 3, state: "degraded", source: "oversight.pendingSummary" },
    ]}
  />
);

export const HeaderVoiChipVaNotice: Story = {
  render: () => (
    <main className="p-4">
      <PageHeaderCompact
        icon={<Truck />}
        title="Điều phối đội xe"
        chips={
          <>
            <NoticeStack
              items={[
                { id: "beta", kind: "beta", content: <p>Tính năng xem trước.</p> },
                { id: "sim", kind: "simGate", content: <p>Lệnh chỉ chạy mô phỏng.</p> },
              ]}
            />
            <WhenToUseHint i18nKey="fleet.whenToUse" fallback="When to use — assign tasks across a robot/AGV fleet." />
            {chips}
          </>
        }
        actions={<Button size="sm">Tạo tác vụ</Button>}
      />
    </main>
  ),
};

function FlyoutDemoBody() {
  const layer = useFlyoutLayer();
  const f = useFlyout();
  return (
    <div className="space-y-2">
      <input className="w-full rounded border px-2 py-1" placeholder="Gõ để đánh dấu chưa lưu" onChange={(e) => layer.setDirty(e.target.value !== "")} />
      <Button size="sm" onClick={() => f.push("history", { id: layer.id })}>
        Mở lịch sử (push)
      </Button>
    </div>
  );
}

function FlyoutDemoOpener() {
  const f = useFlyout();
  return (
    <Button onClick={() => f.open("detail", { id: 42 })} className="m-4">
      Mở chi tiết ECN-42
    </Button>
  );
}

export const FlyoutStack: Story = {
  render: () => (
    <FlyoutHost
      flyouts={{
        detail: { title: (id) => `ECN-${id}`, render: () => <FlyoutDemoBody /> },
        history: {
          title: "Lịch sử phiên bản",
          size: "lg",
          render: () => (
            <VersionHistoryPanel
              status="ready"
              versions={[
                { id: 3, label: "v3", current: true, content: { speed: 30 } },
                { id: 2, label: "v2", content: { speed: 25 } },
              ]}
              renderRowActions={(v) => (
                <RollbackConfirm
                  versionLabel={v.label}
                  requireOtp
                  minReasonLength={3}
                  onRollback={() => undefined}
                  trigger={<Button size="sm" variant="outline">Khôi phục</Button>}
                />
              )}
            />
          ),
        },
      }}
    >
      <FlyoutDemoOpener />
    </FlyoutHost>
  ),
};

function ChiTietVaWizardDemo() {
  const [open, setOpen] = useState(false);
  return (
    <div className="h-[480px] p-4">
      <DetailSheet
        title="ECN-0003"
        subtitle="Đổi keo SMT"
        tabs={[
          { value: "overview", label: "Tổng quan", content: <p>Tổng quan</p> },
          { value: "approval", label: "Duyệt", content: <p>Duyệt</p> },
        ]}
        actions={<Button size="sm" onClick={() => setOpen(true)}>Triển khai…</Button>}
      />
      <WizardDialog
        open={open}
        onOpenChange={setOpen}
        title="Triển khai"
        onFinish={() => setOpen(false)}
        steps={[
          { id: "a", title: "Chọn máy", content: <p>Máy</p> },
          { id: "b", title: "Canary", content: <p>Canary</p> },
          { id: "c", title: "Xem lại", content: <p>Xem lại</p> },
        ]}
      />
    </div>
  );
}
export const ChiTietVaWizard: Story = { render: () => <ChiTietVaWizardDemo /> };

export const HangDoiDuyet: Story = {
  render: () => (
    <div className="p-4">
      <ApprovalQueue
        status="ready"
        currentUserId={5}
        onTransition={() => undefined}
        items={[
          {
            id: 1,
            key: "ECN-0003",
            title: "Đổi keo",
            status: "Đang xem xét",
            authorId: 5,
            authorName: "Bạn",
            actions: [
              { key: "approve", label: "Phê duyệt", kind: "approve" },
              { key: "reject", label: "Từ chối", kind: "reject" },
            ],
          },
          {
            id: 2,
            key: "ECN-0004",
            title: "Đổi nhiệt",
            status: "Đang xem xét",
            authorId: 9,
            authorName: "Kỹ sư B",
            actions: [
              { key: "approve", label: "Phê duyệt", kind: "approve" },
              { key: "reject", label: "Từ chối", kind: "reject" },
            ],
          },
        ]}
      />
    </div>
  ),
};

export const DanhSachChiTiet: Story = {
  render: () => (
    <main className="p-4">
      <SplitListDetail
        layoutId="story-ecn"
        userId={1}
        heightClass="h-[420px]"
        hasSelection
        listToolbar={<input className="w-full rounded border px-2 py-1 text-sm" placeholder="Tìm ECN" />}
        list={<table className="w-full text-sm"><tbody><tr><td className="p-2">ECN-0003</td></tr></tbody></table>}
        detail={<p className="p-2">Chi tiết ECN-0003</p>}
      />
    </main>
  ),
};

export const Cockpit: Story = {
  render: () => (
    <main className="p-4">
      <CockpitLayout
        title="An toàn"
        chips={chips}
        main={<table className="w-full text-sm"><tbody><tr><td className="p-2">Sự kiện</td></tr></tbody></table>}
        side={<p>Xu hướng</p>}
        sideLabel="Xu hướng"
      />
    </main>
  ),
};

function WorkbenchDemo() {
  const [tab, setTab] = useState("main");
  const [act, setAct] = useState("projects");
  return (
    <main>
      <EngineeringShell
        layoutId="story-ide"
        userId={1}
        heightClass="h-[640px]"
        activityItems={[
          { id: "projects", label: "Dự án", icon: <FolderTree /> },
          { id: "versions", label: "Phiên bản", icon: <GitBranch /> },
          { id: "deploy", label: "Triển khai", icon: <Rocket /> },
        ]}
        activeActivity={act}
        onActivityChange={setAct}
        explorer={<p className="p-2 text-sm">Cây {act}</p>}
        editorTabs={[
          { id: "main", label: "Main.bas", dirty: true, closable: true },
          { id: "tags", label: "Tags" },
        ]}
        activeTabId={tab}
        onTabChange={setTab}
        editor={<pre className="p-2 text-xs"><Code2 className="inline h-3 w-3" /> {tab}</pre>}
        inspector={<p className="p-2 text-sm">Copilot</p>}
        inspectorLabel="Copilot"
        inspectorIsAi
        bottomPanel={<p className="p-2 text-sm">Vấn đề</p>}
        statusBar={<span>Ln 1, Col 1</span>}
      />
    </main>
  );
}
export const Workbench: Story = { render: () => <WorkbenchDemo /> };
