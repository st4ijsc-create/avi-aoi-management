/**
 * Đợt 1 · T5 — hook một LƯỢT CHẠY agent trên `/ai-coding-workspace`: gửi · đọc luồng sự kiện · Dừng · duyệt/bác ·
 * hoàn tác · nối lại. Mọi gọi mạng đi qua `@/lib/agentApi` (lớp mỏng — hợp đồng T4 nằm ở đó).
 *
 * Bất biến:
 *   • Rời trang / unmount chỉ NGẮT ĐỌC luồng — KHÔNG huỷ lượt chạy (server giữ). Chỉ nút Dừng gọi `/huy`.
 *   • Trạng thái là `giamSuKien` THUẦN áp lên một ref đồng bộ (đọc `soSuKien` cho `?tu=n` không trễ một nhịp render).
 *   • Duyệt/Bác KHÔNG đổi thẻ lạc quan: thẻ đổi khi sự kiện `da-duyet`/`bi-bac` của server tới (một nguồn sự thật).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CheDoAgent, NgonNgu, SuKienAgent, TinNhan } from "@shared/agentCore/kieu";
import {
  agentTrpc,
  huyLuotChay,
  moLuotChay,
  noiLaiLuotChay,
  type KetQuaHoanTac,
  type TomTatLuotChay,
  type TuyChonLuong,
} from "@/lib/agentApi";
import { mapTrpcError } from "@/lib/trpcErrors";
import {
  TRANG_THAI_RONG,
  batDauGui,
  capNhatDeXuatNho,
  giamSuKien,
  idHanhDong,
  vanBanTraLoiCuoi,
  type MucDongThoiGian,
  type TrangThaiAgent,
} from "./trangThaiAgent";

/** Lịch sử hội thoại agent gửi kèm lượt sau (cặp hỏi/đáp) — trần để giữ ngữ cảnh 64k cho việc chính. */
const TRAN_LICH_SU = 8;

export interface DauVaoHookAgent {
  projectId: string;
  ngonNgu?: NgonNgu;
  /** Gọi khi tập tệp đã đổi lớn thêm (hoặc sau hoàn tác) — trang làm mới cây/tab. */
  onTepDaDoi?: (tep: string[]) => void;
}

export type TheDuyetMuc = Extract<MucDongThoiGian, { kieu: "duyet" }>;
export type TheNhoMuc = Extract<MucDongThoiGian, { kieu: "nho" }>;

export interface HookAgent {
  trangThai: TrangThaiAgent;
  /** Luồng đứt khi lượt chạy chưa xong (mạng / server) — hiện nút Nối lại. */
  matKetNoi: string | null;
  loiThaoTac: string | null;
  /** id hành động đang gửi duyệt/bác. */
  dangGuiDuyet: string | null;
  dangHoanTac: boolean;
  ketQuaHoanTac: KetQuaHoanTac | null;
  /** Lượt chạy còn sống của người dùng tìm thấy khi vào trang (dang-chay | cho-duyet). */
  luotDangChayCu: TomTatLuotChay | null;
  gui: (cauHoi: string, cheDo: Exclude<CheDoAgent, "hoi">) => Promise<void>;
  dung: () => Promise<void>;
  noiLai: (runId?: string) => Promise<void>;
  duyet: (m: TheDuyetMuc, chonKhoi?: number[]) => Promise<void>;
  bac: (m: TheDuyetMuc, lyDo: string) => Promise<void>;
  hoanTac: () => Promise<void>;
  /** (Đợt 2) "Nhớ" / "Bỏ qua" một đề xuất nhớ — thẻ đổi theo kết quả THẬT của máy chủ (không lạc quan). */
  quyetDeXuatNho: (m: TheNhoMuc, nho: boolean) => Promise<void>;
  datLai: () => void;
}

export function useLuotChayAgent({ projectId, ngonNgu, onTepDaDoi }: DauVaoHookAgent): HookAgent {
  const sRef = useRef<TrangThaiAgent>(TRANG_THAI_RONG);
  const [trangThai, setTrangThai] = useState<TrangThaiAgent>(TRANG_THAI_RONG);
  const [matKetNoi, setMatKetNoi] = useState<string | null>(null);
  const [loiThaoTac, setLoiThaoTac] = useState<string | null>(null);
  const [dangGuiDuyet, setDangGuiDuyet] = useState<string | null>(null);
  const [dangHoanTac, setDangHoanTac] = useState(false);
  const [ketQuaHoanTac, setKetQuaHoanTac] = useState<KetQuaHoanTac | null>(null);
  const [luotDangChayCu, setLuotDangChayCu] = useState<TomTatLuotChay | null>(null);
  const docRef = useRef<AbortController | null>(null);
  const lichSuRef = useRef<TinNhan[]>([]);
  const soTepDaBaoRef = useRef(0);
  const onTepRef = useRef(onTepDaDoi);
  onTepRef.current = onTepDaDoi;

  const datTrangThai = useCallback((s: TrangThaiAgent) => {
    sRef.current = s;
    setTrangThai(s);
    // Tệp đã đổi lớn thêm ⇒ báo trang (làm mới cây + tab đang mở).
    if (s.tepDaDoi.length > soTepDaBaoRef.current) {
      const moi = s.tepDaDoi.slice(soTepDaBaoRef.current);
      soTepDaBaoRef.current = s.tepDaDoi.length;
      onTepRef.current?.(moi);
    } else if (s.tepDaDoi.length < soTepDaBaoRef.current) {
      soTepDaBaoRef.current = s.tepDaDoi.length;
    }
  }, []);

  const apDung = useCallback((e: SuKienAgent) => datTrangThai(giamSuKien(sRef.current, e)), [datTrangThai]);

  /** Đọc một luồng; luồng đóng mà lượt chưa `xong` (và không phải ta tự ngắt) ⇒ báo mất kết nối. */
  const docLuong = useCallback(
    async (chay: (o: TuyChonLuong) => Promise<void>) => {
      docRef.current?.abort();
      const ac = new AbortController();
      docRef.current = ac;
      setMatKetNoi(null);
      try {
        await chay({ signal: ac.signal, onSuKien: apDung });
        if (!ac.signal.aborted && sRef.current.dangChay) setMatKetNoi("");
      } catch (e) {
        if (ac.signal.aborted) return;
        setMatKetNoi(mapTrpcError(e));
        // Chưa từng có `bat-dau` ⇒ không có gì để nối lại: kết thúc cục bộ, giữ câu hỏi + lỗi trên dòng thời gian.
        if (!sRef.current.runId) {
          datTrangThai({ ...sRef.current, dangChay: false, choDuyet: false });
        }
      } finally {
        if (docRef.current === ac) docRef.current = null;
      }
    },
    [apDung, datTrangThai],
  );

  const gui = useCallback<HookAgent["gui"]>(
    async (cauHoi, cheDo) => {
      const cau = cauHoi.trim();
      if (!cau || sRef.current.dangChay) return;
      setLoiThaoTac(null);
      setKetQuaHoanTac(null);
      soTepDaBaoRef.current = 0;
      datTrangThai(batDauGui(cau, cheDo));
      const lichSu = lichSuRef.current.slice(-TRAN_LICH_SU);
      await docLuong((o) =>
        moLuotChay({ cauHoi: cau, projectId, cheDo, ...(lichSu.length ? { lichSu } : {}), ...(ngonNgu ? { ngonNgu } : {}) }, o),
      );
      const s = sRef.current;
      if (s.ketThuc) {
        const traLoi = vanBanTraLoiCuoi(s);
        lichSuRef.current = [...lichSuRef.current, { role: "user" as const, content: cau }, ...(traLoi ? [{ role: "assistant" as const, content: traLoi }] : [])].slice(-TRAN_LICH_SU);
      }
    },
    [datTrangThai, docLuong, ngonNgu, projectId],
  );

  const dung = useCallback(async () => {
    const runId = sRef.current.runId;
    setLoiThaoTac(null);
    if (!runId) {
      // Chưa có lượt chạy phía server để huỷ (chưa nhận `bat-dau`): ngắt đọc và đóng cục bộ.
      docRef.current?.abort();
      datTrangThai(giamSuKien(sRef.current, { loai: "xong", lyDo: "huy" }));
      return;
    }
    try {
      await huyLuotChay(runId); // server phát `xong{lyDo:"huy"}` trên luồng đang mở
    } catch (e) {
      setLoiThaoTac(mapTrpcError(e));
    }
  }, [datTrangThai]);

  const noiLai = useCallback<HookAgent["noiLai"]>(
    async (runIdVao) => {
      const runId = runIdVao ?? sRef.current.runId;
      if (!runId) return;
      setLoiThaoTac(null);
      let tu = sRef.current.soSuKien;
      if (sRef.current.runId !== runId) {
        // Lượt khác (vào lại trang) ⇒ phát lại TOÀN BỘ bộ đệm để dựng lại dòng thời gian.
        soTepDaBaoRef.current = 0;
        datTrangThai({ ...TRANG_THAI_RONG, runId, dangChay: true });
        tu = 0;
      }
      setLuotDangChayCu(null);
      await docLuong((o) => noiLaiLuotChay(runId, tu, o));
    },
    [datTrangThai, docLuong],
  );

  const duyet = useCallback<HookAgent["duyet"]>(async (m, chonKhoi) => {
    const id = idHanhDong(m);
    setDangGuiDuyet(id);
    setLoiThaoTac(null);
    try {
      await agentTrpc.duyet(id, chonKhoi);
    } catch (e) {
      setLoiThaoTac(mapTrpcError(e));
    } finally {
      setDangGuiDuyet(null);
    }
  }, []);

  const bac = useCallback<HookAgent["bac"]>(async (m, lyDo) => {
    const id = idHanhDong(m);
    setDangGuiDuyet(id);
    setLoiThaoTac(null);
    try {
      await agentTrpc.bac(id, lyDo.trim());
    } catch (e) {
      setLoiThaoTac(mapTrpcError(e));
    } finally {
      setDangGuiDuyet(null);
    }
  }, []);

  const hoanTac = useCallback(async () => {
    const runId = sRef.current.runId;
    if (!runId) return;
    setDangHoanTac(true);
    setLoiThaoTac(null);
    try {
      const kq = await agentTrpc.hoanTac(runId);
      setKetQuaHoanTac(kq);
      if (kq.khoiPhuc.length) onTepRef.current?.(kq.khoiPhuc);
    } catch (e) {
      setLoiThaoTac(mapTrpcError(e));
    } finally {
      setDangHoanTac(false);
    }
  }, []);

  const quyetDeXuatNho = useCallback<HookAgent["quyetDeXuatNho"]>(
    async (m, nho) => {
      const runId = sRef.current.runId;
      if (!runId || m.trangThai !== "cho") return;
      datTrangThai(capNhatDeXuatNho(sRef.current, m.id, { trangThai: "dang-gui" }));
      try {
        const kq = nho ? await agentTrpc.nhoDeXuat(runId, m.id) : await agentTrpc.boDeXuat(runId, m.id);
        datTrangThai(
          capNhatDeXuatNho(
            sRef.current,
            m.id,
            kq.ok ? { trangThai: nho ? "da-nho" : "da-bo" } : { trangThai: "loi", maLoi: kq.ma ?? "LOI" },
          ),
        );
      } catch (e) {
        datTrangThai(capNhatDeXuatNho(sRef.current, m.id, { trangThai: "loi", maLoi: mapTrpcError(e) }));
      }
    },
    [datTrangThai],
  );

  const datLai = useCallback(() => {
    if (sRef.current.dangChay) return;
    soTepDaBaoRef.current = 0;
    setKetQuaHoanTac(null);
    setMatKetNoi(null);
    setLoiThaoTac(null);
    datTrangThai(TRANG_THAI_RONG);
  }, [datTrangThai]);

  // Vào trang / đổi dự án: tìm lượt chạy còn sống của người dùng để mời nối lại. Lỗi (route chưa có) ⇒ im lặng.
  useEffect(() => {
    let huy = false;
    agentTrpc
      .danhSach()
      .then((ds) => {
        if (huy) return;
        const song = ds.find(
          (r) => (r.trangThai === "dang-chay" || r.trangThai === "cho-duyet") && (!r.projectId || !projectId || r.projectId === projectId),
        );
        setLuotDangChayCu(song && song.id !== sRef.current.runId ? song : null);
      })
      .catch(() => {
        /* chưa có thủ tục / mất mạng — không mời nối lại */
      });
    return () => {
      huy = true;
    };
  }, [projectId]);

  // Rời trang: chỉ ngắt ĐỌC; lượt chạy vẫn sống ở server.
  useEffect(() => () => docRef.current?.abort(), []);

  return {
    trangThai,
    matKetNoi,
    loiThaoTac,
    dangGuiDuyet,
    dangHoanTac,
    ketQuaHoanTac,
    luotDangChayCu,
    gui,
    dung,
    noiLai,
    duyet,
    bac,
    hoanTac,
    quyetDeXuatNho,
    datLai,
  };
}
