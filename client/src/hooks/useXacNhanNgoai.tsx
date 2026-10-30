/**
 * Đợt 10.4b (L1) — HAI hộp hỏi người dùng cho bề mặt sinh chữ bằng model NGOÀI (kế hoạch §D4):
 *   1) `xacNhanNgoai(ma)` — đồng ý dùng `nhà cung cấp:model` (MỘT lần mỗi phiên trình duyệt) ⇒ mở `HopDongYNgoai` với thông tin máy chủ (`layThongTin`
 *      = `aiChonModel.thongTinNgoai`, không giữ chỗ, không gọi mạng ra ngoài). Gắn vào `ChonModel.xacNhanNgoai`.
 *   2) `hoiVanHanh(convKey, ma)` — khi máy chủ trả 428 `CAN_XAC_NHAN_VAN_HANH`: "câu bạn gõ được coi là dữ liệu vận hành" — MỘT lần mỗi hội thoại
 *      (nhớ ở `dongYNgoai`); đồng ý ⇒ bề mặt gửi lại với `context.xacNhanVanHanh: true`.
 * Hook CHỈ điều khiển hộp; việc gọi máy chủ do bề mặt tiêm vào (dễ thử với máy chủ giả). Hộp mới mở khi hộp cũ còn mở ⇒ hộp cũ coi như TỪ CHỐI.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HopDongYNgoai } from "@/components/ai/HopDongYNgoai";
import { daXacNhanVanHanh, datXacNhanVanHanh, tachMaNgoai } from "@/lib/dongYNgoai";
import type { BeMatSinhChuNgoai, ThongTinNgoai } from "@shared/ai/sinhChuNgoai";

interface DongYDangMo {
  ma: string;
  thongTin?: ThongTinNgoai;
  dangTai: boolean;
  loi?: string;
  xong: (dongY: boolean) => void;
}
interface VanHanhDangMo {
  convKey: string;
  ma: string;
  xong: (dongY: boolean) => void;
}

export function HopXacNhanVanHanh({ ma, onDongY, onTuChoi }: { ma: string; onDongY: () => void; onTuChoi: () => void }) {
  const { t } = useTranslation();
  const tach = tachMaNgoai(ma);
  return (
    <Dialog open onOpenChange={(v) => (!v ? onTuChoi() : undefined)}>
      <DialogContent className="max-w-md" data-testid="hop-xac-nhan-van-hanh">
        <DialogHeader>
          <DialogTitle>{t("xacNhanVanHanh.tieuDe", "Gửi câu hỏi ra AI ngoài?")}</DialogTitle>
          <DialogDescription data-testid="xnvh-mo-ta">
            {t("xacNhanVanHanh.moTa", "Đây là trợ lý vận hành: câu bạn gõ được coi là DỮ LIỆU VẬN HÀNH. Gửi tới model bên ngoài (trả phí) sau khi che dữ liệu nhạy cảm theo mẫu. Hỏi một lần cho cuộc trò chuyện này.")}
          </DialogDescription>
        </DialogHeader>
        {tach && (
          <p className="text-sm font-medium" data-testid="xnvh-model">
            {tach.nhaCungCap} · {tach.model}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" data-testid="xnvh-tu-choi" onClick={onTuChoi}>
            {t("xacNhanVanHanh.tuChoi", "Không gửi")}
          </Button>
          <Button type="button" size="sm" data-testid="xnvh-dong-y" onClick={onDongY}>
            {t("xacNhanVanHanh.dongY", "Đồng ý, gửi")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function useXacNhanNgoai(opts: { beMat: BeMatSinhChuNgoai; layThongTin: (ma: string) => Promise<ThongTinNgoai> }): {
  xacNhanNgoai: (ma: string) => Promise<boolean>;
  hoiVanHanh: (convKey: string, ma: string) => Promise<boolean>;
  hopThoai: ReactNode;
} {
  const { t } = useTranslation();
  const [dongY, setDongY] = useState<DongYDangMo | null>(null);
  const [vanHanh, setVanHanh] = useState<VanHanhDangMo | null>(null);
  const dongYRef = useRef<DongYDangMo | null>(null);
  const vanHanhRef = useRef<VanHanhDangMo | null>(null);
  const layRef = useRef(opts.layThongTin);
  layRef.current = opts.layThongTin;
  const daGo = useRef(false);
  useEffect(
    () => () => {
      // gỡ bề mặt khi hộp còn mở ⇒ coi như từ chối (không treo Promise)
      daGo.current = true;
      dongYRef.current?.xong(false);
      vanHanhRef.current?.xong(false);
    },
    [],
  );

  const xacNhanNgoai = useCallback((ma: string) => {
    dongYRef.current?.xong(false);
    return new Promise<boolean>((resolve) => {
      const mo: DongYDangMo = {
        ma,
        dangTai: true,
        xong: (v) => {
          if (dongYRef.current === mo) {
            dongYRef.current = null;
            if (!daGo.current) setDongY(null);
          }
          resolve(v);
        },
      };
      dongYRef.current = mo;
      setDongY({ ...mo });
      layRef
        .current(ma)
        .then((thongTin) => {
          if (dongYRef.current === mo) setDongY({ ...mo, thongTin, dangTai: false });
        })
        .catch(() => {
          if (dongYRef.current === mo) setDongY({ ...mo, dangTai: false, loi: t("hopDongYNgoai.khongTai", "Không tải được điều kiện dùng model này — thử lại sau.") });
        });
    });
  }, [t]);

  const hoiVanHanh = useCallback((convKey: string, ma: string) => {
    if (daXacNhanVanHanh(convKey, ma)) return Promise.resolve(true);
    vanHanhRef.current?.xong(false);
    return new Promise<boolean>((resolve) => {
      const mo: VanHanhDangMo = {
        convKey,
        ma,
        xong: (v) => {
          if (vanHanhRef.current === mo) {
            vanHanhRef.current = null;
            if (!daGo.current) setVanHanh(null);
          }
          if (v) datXacNhanVanHanh(convKey, ma);
          resolve(v);
        },
      };
      vanHanhRef.current = mo;
      setVanHanh({ ...mo });
    });
  }, []);

  const hopThoai: ReactNode = (
    <>
      {dongY && (
        <HopDongYNgoai
          ma={dongY.ma}
          beMat={opts.beMat}
          thongTin={dongY.thongTin}
          dangTai={dongY.dangTai}
          loi={dongY.loi}
          onDongY={() => dongYRef.current?.xong(true)}
          onTuChoi={() => dongYRef.current?.xong(false)}
        />
      )}
      {vanHanh && <HopXacNhanVanHanh ma={vanHanh.ma} onDongY={() => vanHanhRef.current?.xong(true)} onTuChoi={() => vanHanhRef.current?.xong(false)} />}
    </>
  );
  return { xacNhanNgoai, hoiVanHanh, hopThoai };
}
