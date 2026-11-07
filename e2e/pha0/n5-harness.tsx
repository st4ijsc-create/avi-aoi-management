/**
 * 50-N5 (pha 0 C0-3) — HARNESS trình duyệt THẬT cho "NÚT DỪNG MÁY KHÔNG BAO GIỜ BỊ CHE": gắn đúng các thành phần THẬT của ứng dụng
 * (`NutDungMay`, `LopDungMayNoi`, Dialog Radix, Sonner, i18n vi, Tailwind) vào MỘT trang tối giản, KHÔNG có máy chủ / DB. Mục đích: đo bằng
 * hình học thật (`elementFromPoint`, `pointer-events` của Radix, z-index của Sonner) điều mà jsdom không đo được.
 * Không import bất cứ thứ gì có thể gọi thiết bị: `trpc` trỏ `/api/trpc` của chính Vite harness (404) — mutation chỉ chạy khi bấm GỬI, test KHÔNG bấm.
 */
import * as React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { toast } from "sonner";
import "@/index.css";
import vi from "@/i18n/locales/vi.json";
import { trpc } from "@/lib/trpc";
import { createAppTrpcLinks } from "@/lib/trpcLinks";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/sonner";
import { LopDungMayNoi } from "@/components/scada/LopDungMayNoi";
import { NutDungMay } from "@/components/scada/DungMay";

await i18next.use(initReactI18next).init({ lng: "vi", fallbackLng: "vi", resources: { vi: { translation: vi } }, interpolation: { escapeValue: false } });

const queryClient = new QueryClient();
const trpcClient = trpc.createClient({ links: createAppTrpcLinks({ url: "/api/trpc" }) });

function Trang() {
  const [faceplate, setFaceplate] = React.useState(false);
  const [hopLong, setHopLong] = React.useState(false);
  React.useEffect(() => {
    (window as unknown as { __bonToast: () => void }).__bonToast = () => {
      for (let i = 1; i <= 3; i++) toast(`Thông báo thử ${i} — nội dung đủ dài để chiếm chỗ ở góc màn hình`, { duration: Infinity });
    };
  }, []);
  return (
    <main style={{ padding: 24 }}>
      <h1>Harness 50-N5</h1>
      <button type="button" data-testid="mo-faceplate" onClick={() => setFaceplate(true)}>
        Mở faceplate
      </button>
      <Dialog open={faceplate} onOpenChange={setFaceplate}>
        <DialogContent data-testid="faceplate" className="sm:max-w-md">
          <DialogTitle>Faceplate thử (máy SCR-06)</DialogTitle>
          <DialogDescription>Mô phỏng faceplate: nút DỪNG MÁY thật + nút "Đổi…" mở hộp xác nhận lồng.</DialogDescription>
          <NutDungMay machineId={7} tenMay="SCR-06" soAdapter={1} />
          <button type="button" data-testid="mo-hop-long" onClick={() => setHopLong(true)}>
            Đổi…
          </button>
          <Dialog open={hopLong} onOpenChange={setHopLong}>
            <DialogContent data-testid="hop-xac-nhan-long" className="sm:max-w-sm">
              <DialogTitle>Xác nhận đổi giá trị</DialogTitle>
              <DialogDescription>Hộp xác nhận lồng trong faceplate (che nút DỪNG trong luồng).</DialogDescription>
            </DialogContent>
          </Dialog>
        </DialogContent>
      </Dialog>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <LopDungMayNoi />
      <Trang />
    </QueryClientProvider>
  </trpc.Provider>,
);
