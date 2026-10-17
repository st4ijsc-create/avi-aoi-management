/**
 * ★★★ ĐỢT 4B — PHIÊN AGENT của khung chat: chạy LÕI AGENT DÙNG CHUNG (`shared/agentCore#chayVongAgent`) với
 * `GoiModel` qua `/v1` (token device flow) + `BoThucThiVscode`, và nối nó với webview (`htmlBang.ts`, tin `ag_*`).
 *
 * Trách nhiệm (không hơn):
 *   · dựng NGỮ CẢNH: khối dự án (cây 2 tầng · lệnh được phép · tệp quy ước AGENTS.md/CLAUDE.md/copilot-instructions ·
 *     bộ nhớ dài hạn đã duyệt) + câu hỏi kèm tệp đang mở/vùng chọn/@tệp/@folder/@problems/@git; lệnh gạch;
 *   · chuyển SỰ KIỆN lõi ⇒ webview: chữ stream, suy luận, dòng thời gian tool, kế hoạch `todo_write`, thẻ duyệt TỪNG
 *     TỆP (diff native `vscode.diff`), đề xuất nhớ, đồng hồ token/ngữ cảnh, kết thúc;
 *   · đoạn chữ của model được dựng thành CÂY MARKDOWN AN TOÀN ở đây (host) — webview chỉ dựng DOM bằng textContent;
 *   · khối mã: Chép (clipboard) · Chèn vào con trỏ (qua `apBanVa`) · Áp dụng (đề xuất qua CỬA DUYỆT rồi `apBanVa`);
 *   · Dừng (AbortSignal) · Hoàn tác lượt chạy (checkpoint ⇒ `hoanTacLuotChay`).
 * KHÔNG có đường ghi riêng: mọi byte vẫn qua `apBanVa` (census canh).
 */
import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  chayVongAgent,
  uocLuongTinNhan,
  uocLuongTokenMacDinh,
  GIOI_HAN_MAC_DINH,
  type CheDoAgent,
  type GoiModel,
  type LoiGoiTool,
  type NgonNgu,
  type SuKienAgent,
  type TinNhan,
} from "../../../shared/agentCore/index";
import { taoGoiModelV1, TRAN_TOKEN_MOT_LUOT_MAC_DINH, type CauHinhGoiModelV1 } from "../mang/goiModelV1";
import { BoThucThiVscode, type QuyetDinhDuyet, type YeuCauDuyet } from "./boThucThiVscode";
import { apBanVa as apBanVaThat, type DauVaoApBanVa, type KetQuaApBanVa } from "./apBanVa";
import { hoanTacLuotChay } from "./hoanTac";
import { SoCheckpoint } from "../loi/checkpoint";
import { KHOA_TOKEN_GATEWAY } from "../loi/thietBi";
import { KHOA_COOKIE } from "../loi/dangNhap";
import { chuanHoaMucQuyen, NHAN_MUC_QUYEN, type MucQuyen } from "../loi/mucQuyen";
import { phanTichMarkdown, khoiMa as layKhoiMa } from "../loi/markdownAnToan";
import { docLenhGach, dungCauHoiLenhGach } from "../loi/lenhGach";
import { docTheDacBiet, dungCauHoiAgent, dungNguCanhDuAnExtension, LENH_DUOC_PHEP_HIEN_THI, TEP_QUY_UOC, type DinhKemAgent } from "../loi/nguCanhAgent";
import { dinhDangChanDoan, type MucChanDoan } from "../loi/congCuDoc";
import { bamNoiDung } from "../loi/bamTep";
import { duongTuongDoiTrongWorkspace } from "../loi/chanGhi";
import { duocPhepDoc } from "../loi/docCucBo";
import { cheBiMat, duocPhepRoiMay } from "../loi/nguCanh";
import { xetDuyetLenh, TRAN_MS_THEO_LENH } from "../loi/lenhChoPhep";
import { locDiffTepCam } from "../loi/locDiffTepCam";
import { docDanhSachBoNho, themMucBoNho } from "../loi/khoBoNho";
import { chayLenhCucBo as chayLenhCucBoThat } from "../mang/chayLenhCucBo";
import { gocDaGiai, nhanGon, quyVeDuongThat } from "../mang/toolCucBo";
import { dungKhoWorkspaceState } from "./khoWorkspaceState";
import type { KhoDeXuat } from "./diffDeXuat";

export type CheDoGiaoDien = CheDoAgent;

export interface PhuThuocPhienAgent {
  context: vscode.ExtensionContext;
  gui: (m: Record<string, unknown>) => void;
  khoDeXuat: KhoDeXuat;
  mucQuyen: () => MucQuyen;
  /** Thư mục workspace, gốc dự án đang chọn ĐỨNG ĐẦU. */
  goc: () => string[];
  /** Lưu một lượt vào lịch sử hội thoại của khung (kho "Lịch sử"). */
  ghiLuot?: (cauHoi: string, traLoi: string) => void;
  // ── đường nối cho lưới ──
  taoGoiModel?: (ch: CauHinhGoiModelV1) => GoiModel;
  apBanVa?: (dv: DauVaoApBanVa) => Promise<KetQuaApBanVa>;
  chayLenh?: typeof chayLenhCucBoThat;
}

const TRAN_DIFF_STAGED = 40_000;
const TRAN_KY_TU_TEP_DINH_KEM = 24_000;
const THU_MUC_AN = new Set(["node_modules", ".git", "dist", "build", "out", "bin", "obj", ".next", "coverage", ".venv", "venv", "target", ".vs"]);

function moTaGoi(g: LoiGoiTool): string {
  const t = g.thamSo;
  const s = (k: string) => (typeof t[k] === "string" ? String(t[k]) : "");
  switch (g.ten) {
    case "read_file":
      return `đọc ${s("path")}${t.start_line ? ` (dòng ${t.start_line}${t.end_line ? `–${t.end_line}` : ""})` : ""}`;
    case "list_dir":
      return `liệt kê ${s("path")}`;
    case "find_files":
      return `tìm tệp ${s("pattern")}`;
    case "grep":
      return `grep /${s("pattern")}/${s("include") ? ` trong ${s("include")}` : ""}`;
    case "find_symbol":
      return `tìm ký hiệu ${s("name")}`;
    case "get_diagnostics":
      return `xem lỗi ${s("path") || "workspace"}`;
    case "edit_file":
      return `sửa ${s("path")}`;
    case "write_file":
      return `ghi ${s("path")}`;
    case "delete_file":
      return `xoá ${s("path")}`;
    case "rename_file":
      return `đổi tên ${s("from")} → ${s("to")}`;
    case "run_command":
      return `chạy ${s("command")}`;
    case "todo_write":
      return "cập nhật kế hoạch";
    case "remember":
      return "đề xuất nhớ";
    default:
      return g.ten;
  }
}

export class PhienAgent {
  private lichSu: TinNhan[] = [];
  private huy: AbortController | undefined;
  private soCuoi: SoCheckpoint | undefined;
  private readonly choDuyet = new Map<string, (qd: QuyetDinhDuyet) => void>();
  private readonly yeuCauDuyet = new Map<string, YeuCauDuyet>();
  private readonly deXuatNho = new Map<string, string>();
  private readonly dsKhoiMa: Array<{ ngonNgu: string; ma: string }> = [];
  private doan = "";
  private dangChay = false;

  constructor(private readonly pt: PhuThuocPhienAgent) {}

  get dangChayLuot(): boolean {
    return this.dangChay;
  }

  private cfg() {
    return vscode.workspace.getConfiguration("aviAiLocal");
  }

  private serverUrl(): string {
    return this.cfg().get<string>("serverUrl", "http://localhost:3000");
  }

  async guiTrangThaiToken(): Promise<void> {
    const co = !!(await this.pt.context.secrets.get(KHOA_TOKEN_GATEWAY));
    this.pt.gui({ loai: "ag_token", coToken: co });
  }

  /** Chat mới / đổi hội thoại: quên lịch sử agent (giữ checkpoint lượt cuối để còn hoàn tác). */
  datLaiLichSu(luot: Array<{ role: "user" | "assistant"; content: string }> = []): void {
    this.dung();
    this.lichSu = luot.map((l) => ({ role: l.role, content: l.content }));
  }

  dung(): void {
    this.huy?.abort("nguoi-dung-dung");
    for (const id of [...this.choDuyet.keys()]) this.quyet(id, { duyet: false, lyDo: "the run was stopped" });
  }

  // ─── LƯỢT CHẠY ───────────────────────────────────────────────────────────────────────────────

  async chay(cauHoiTho: string, cheDoChon: CheDoAgent, tepMention: string[] = []): Promise<void> {
    if (this.dangChay) {
      this.pt.gui({ loai: "ag_loi", thongDiep: "Một lượt agent đang chạy — bấm Dừng trước khi hỏi tiếp.", ma: "DANG_CHAY" });
      return;
    }
    this.dangChay = true;
    const ac = new AbortController();
    this.huy = ac;
    this.doan = "";
    let cuoi = "";
    let daBaoXong = false;
    try {
      const goc = this.pt.goc();
      if (goc.length === 0) {
        this.pt.gui({ loai: "ag_loi", thongDiep: "Chưa mở thư mục workspace nào — agent cần một dự án để làm việc.", ma: "KHONG_WORKSPACE" });
        return;
      }
      const gocThat = gocDaGiai(goc);

      // ── lệnh gạch + thẻ @ ──
      let cheDo = cheDoChon;
      let cauHoi: string;
      const gach = docLenhGach(cauHoiTho);
      const ed = vscode.window.activeTextEditor;
      const tepDangMo =
        ed && ed.document.uri.scheme === "file" && duocPhepDoc(ed.document.uri.fsPath, gocThat).ok
          ? { rel: nhanGon(ed.document.uri.fsPath, gocThat), uri: ed.document.uri, ngonNgu: ed.document.languageId }
          : undefined;
      const vungChon =
        tepDangMo && ed && !ed.selection.isEmpty
          ? { rel: tepDangMo.rel, dongDau: ed.selection.start.line + 1, dongCuoi: ed.selection.end.line + 1, noiDung: ed.document.getText(ed.selection) }
          : undefined;
      if (gach && "loi" in gach) {
        this.pt.gui({ loai: "ag_loi", thongDiep: gach.loi, ma: "LENH_GACH" });
        return;
      }
      if (gach) {
        const chanDoanTep = tepDangMo ? this.chanDoanCua(tepDangMo.uri, gocThat) : [];
        const diffStaged = gach.ten === "commit" ? await this.diffStaged(goc[0]) : undefined;
        const kq = dungCauHoiLenhGach(gach, {
          cheDoChon,
          tepDangMo: tepDangMo?.rel,
          vungChon,
          chanDoan: tepDangMo ? dinhDangChanDoan(chanDoanTep, tepDangMo.rel) : undefined,
          soLoi: chanDoanTep.length,
          diffStaged,
        });
        if (!kq.ok) {
          this.pt.gui({ loai: "ag_loi", thongDiep: kq.loi, ma: "LENH_GACH" });
          return;
        }
        cauHoi = kq.cauHoi;
        cheDo = kq.cheDo;
        if (kq.canhBao) this.pt.gui({ loai: "ag_thong_bao", thongDiep: kq.canhBao });
        if (gach.ten === "commit") this.pt.gui({ loai: "ag_thong_bao", thongDiep: "/commit chỉ SINH thông điệp — extension không tự commit." });
      } else {
        const the = docTheDacBiet(cauHoiTho);
        const dk: DinhKemAgent = { tepDangMo: tepDangMo ? { rel: tepDangMo.rel, ngonNgu: tepDangMo.ngonNgu } : undefined, vungChon };
        await this.dinhKemMention([...tepMention, ...the.thuMuc], gocThat, dk);
        if (the.problems) dk.problems = this.chanDoanWorkspace(gocThat);
        if (the.git) dk.gitDiff = await this.chayLenhDoc("git diff", goc[0]);
        cauHoi = dungCauHoiAgent(the.conLai || cauHoiTho, dk);
      }

      const mucQuyen = chuanHoaMucQuyen(this.pt.mucQuyen());
      if (cheDo === "tu-dong" && mucQuyen !== "tu_ghi") {
        this.pt.gui({
          loai: "ag_thong_bao",
          thongDiep: `Chế độ tự động chỉ bỏ bước duyệt khi mức quyền là "${NHAN_MUC_QUYEN.tu_ghi}" — mức hiện tại "${NHAN_MUC_QUYEN[mucQuyen]}", lượt này vẫn hỏi duyệt từng tệp.`,
        });
      }

      const nguCanhDuAn = await this.dungNguCanhDuAn(goc[0], gocThat);
      const runId = randomUUID();
      const so = new SoCheckpoint(runId);
      this.soCuoi = so;
      const boThucThi = new BoThucThiVscode({
        goc: () => this.pt.goc(),
        mucQuyen: () => this.pt.mucQuyen(),
        serverUrl: () => this.serverUrl(),
        layCookie: async () => this.pt.context.secrets.get(KHOA_COOKIE),
        nhanWorkspace: () => this.pt.goc()[0] ?? "",
        xinDuyet: (yc, signal) => this.xinDuyet(yc, signal),
        checkpoint: () => so,
        apBanVa: this.pt.apBanVa,
        chayLenh: this.pt.chayLenh,
      });
      const ngonNgu = this.cfg().get<string>("uiLanguage", "vi") as NgonNgu;
      const kq = await chayVongAgent({
        cauHoi,
        lichSu: this.lichSu,
        cheDo,
        runId,
        nguCanhDuAn,
        goiModel: this.goiModelCoDongHo(),
        boThucThi,
        phat: (e) => this.xuLySuKien(e),
        signal: ac.signal,
        ngonNgu: ["vi", "en", "zh"].includes(ngonNgu) ? ngonNgu : "vi",
      });
      this.xaDoan();
      this.lichSu = kq.tinNhan.filter((m) => m.role !== "system");
      cuoi = [...kq.tinNhan].reverse().find((m) => m.role === "assistant" && m.content.trim())?.content ?? "";
      this.pt.gui({ loai: "ag_xong", lyDo: kq.lyDo, coHoanTac: !so.rong, soTep: so.danhSach().length });
      daBaoXong = true;
      this.pt.ghiLuot?.(cauHoiTho, cuoi);
    } catch (e) {
      this.xaDoan();
      this.pt.gui({ loai: "ag_loi", thongDiep: `Lượt agent hỏng: ${cheBiMat((e as Error)?.message ?? String(e))}`, ma: "LOI" });
      this.pt.gui({ loai: "ag_xong", lyDo: "loi-model", coHoanTac: !!this.soCuoi && !this.soCuoi.rong });
      daBaoXong = true;
    } finally {
      // Lượt dừng TRƯỚC khi vào vòng (lệnh gạch sai, chưa có workspace…) vẫn phải đóng giao diện (nút Dừng, chỉ báo chờ).
      if (!daBaoXong) this.pt.gui({ loai: "ag_xong", lyDo: "khong-chay", coHoanTac: !!this.soCuoi && !this.soCuoi.rong });
      for (const id of [...this.choDuyet.keys()]) this.quyet(id, { duyet: false, lyDo: "the run ended" });
      this.dangChay = false;
      if (this.huy === ac) this.huy = undefined;
    }
  }

  private goiModelCoDongHo(): GoiModel {
    const ch: CauHinhGoiModelV1 = {
      serverUrl: this.serverUrl(),
      layToken: async () => this.pt.context.secrets.get(KHOA_TOKEN_GATEWAY),
      model: this.cfg().get<string>("agentModel", "chat"),
      maxTokens: this.cfg().get<number>("agentMaxTokens", TRAN_TOKEN_MOT_LUOT_MAC_DINH),
      khi401: () => this.pt.gui({ loai: "ag_token", coToken: false, hong: true }),
    };
    const goc = (this.pt.taoGoiModel ?? taoGoiModelV1)(ch);
    return (vao) => {
      // Cổng /v1 hiện không trả `usage` trong luồng ⇒ đồng hồ ƯỚC LƯỢNG (khai rõ) từ chính tin nhắn gửi đi.
      const uoc = uocLuongTinNhan(vao.tinNhan) + uocLuongTokenMacDinh(JSON.stringify(vao.congCu));
      this.pt.gui({
        loai: "ag_usage",
        vao: uoc,
        ctxPhanTram: Math.round((uoc * 100) / GIOI_HAN_MAC_DINH.nganSachNguCanhToken),
        uocLuong: true,
      });
      return goc(vao);
    };
  }

  private xuLySuKien(e: SuKienAgent): void {
    switch (e.loai) {
      case "bat-dau":
        this.pt.gui({ loai: "ag_bat_dau", runId: e.runId, cheDo: e.cheDo });
        break;
      case "chu":
        this.doan += e.noiDung;
        this.pt.gui({ loai: "ag_chu", chu: e.noiDung });
        break;
      case "nghi":
        this.pt.gui({ loai: "ag_nghi", chu: e.noiDung });
        break;
      case "goi-tool":
        this.xaDoan();
        this.pt.gui({ loai: "ag_goi_tool", id: e.goi.id, ten: e.goi.ten, moTa: moTaGoi(e.goi) });
        break;
      case "ket-qua-tool":
        this.pt.gui({ loai: "ag_ket_qua_tool", id: e.id, ok: e.ok, tomTat: e.tomTat, ma: e.ma });
        break;
      case "ke-hoach":
        this.pt.gui({ loai: "ag_ke_hoach", viec: e.viec });
        break;
      case "de-xuat-nho":
        this.deXuatNho.set(e.id, e.note);
        this.pt.gui({ loai: "ag_de_xuat_nho", id: e.id, note: e.note, scope: e.scope });
        break;
      case "checkpoint":
        this.pt.gui({ loai: "ag_checkpoint", soTep: e.tep.length });
        break;
      case "usage":
        this.pt.gui({ loai: "ag_usage", vao: e.vao, ra: e.ra, ctxPhanTram: e.ctxPhanTram, uocLuong: false });
        break;
      case "dang-cho-model":
        this.pt.gui({ loai: "ag_thong_bao", thongDiep: `Đang xếp hàng chờ model (${e.phiaTruoc} lượt phía trước)…` });
        break;
      case "loi":
        this.pt.gui({ loai: "ag_loi", thongDiep: e.thongDiep, ma: e.ma });
        break;
      default:
        break; // can-duyet/da-duyet/bi-bac: thẻ do xinDuyet/quyet dựng; xong: xử lý sau vòng
    }
  }

  /** Đoạn chữ đang stream ⇒ cây markdown an toàn (khối mã đánh số TOÀN CỤC cho nút Chép/Chèn/Áp dụng). */
  private xaDoan(): void {
    if (!this.doan.trim()) {
      this.doan = "";
      return;
    }
    const cay = phanTichMarkdown(this.doan);
    const chiSoMaDau = this.dsKhoiMa.length;
    this.dsKhoiMa.push(...layKhoiMa(cay));
    this.pt.gui({ loai: "ag_md", cay, chiSoMaDau });
    this.doan = "";
  }

  // ─── DUYỆT ───────────────────────────────────────────────────────────────────────────────────

  private xinDuyet(yc: YeuCauDuyet, signal: AbortSignal): Promise<QuyetDinhDuyet> {
    return new Promise<QuyetDinhDuyet>((res) => {
      this.choDuyet.set(yc.id, res);
      this.yeuCauDuyet.set(yc.id, yc);
      this.pt.gui({
        loai: "ag_the_duyet",
        id: yc.id,
        loaiDuyet: yc.loai,
        tomTat: yc.tomTat,
        duong: yc.duongTuongDoi,
        lenh: yc.lenh,
        coDiff: yc.loai === "ghi",
      });
      if (signal.aborted) this.quyet(yc.id, { duyet: false, lyDo: "the run was stopped" });
      else signal.addEventListener("abort", () => this.quyet(yc.id, { duyet: false, lyDo: "the run was stopped" }), { once: true });
    });
  }

  quyet(id: string, qd: QuyetDinhDuyet): void {
    const res = this.choDuyet.get(id);
    if (!res) return;
    this.choDuyet.delete(id);
    this.yeuCauDuyet.delete(id);
    this.pt.khoDeXuat.quen(`ag-${id}`);
    this.pt.gui({ loai: "ag_an_the_duyet", id, ketQua: qd.duyet ? "duyet" : "bac" });
    res(qd);
  }

  async xemDiff(id: string): Promise<void> {
    const yc = this.yeuCauDuyet.get(id);
    if (!yc || yc.loai !== "ghi") return;
    const { cu, moi } = this.pt.khoDeXuat.datDeXuat({
      actionId: `ag-${id}`,
      path: yc.duongTuongDoi ?? "tep",
      original: yc.goc ?? "",
      modified: yc.moi ?? "",
    });
    await vscode.commands.executeCommand("vscode.diff", cu, moi, `AI Local — ${yc.tomTat} (đề xuất, chưa ghi)`);
  }

  // ─── HOÀN TÁC / NHỚ ──────────────────────────────────────────────────────────────────────────

  private async dauVaoChung(): Promise<Pick<DauVaoApBanVa, "thuMucWorkspace" | "nhanWorkspace" | "serverUrl" | "cookie" | "mucQuyen">> {
    return {
      thuMucWorkspace: this.pt.goc(),
      nhanWorkspace: this.pt.goc()[0] ?? "",
      serverUrl: this.serverUrl(),
      cookie: (await this.pt.context.secrets.get(KHOA_COOKIE)) ?? "",
      mucQuyen: this.pt.mucQuyen(),
    };
  }

  async hoanTac(): Promise<void> {
    if (this.dangChay) {
      this.pt.gui({ loai: "ag_loi", thongDiep: "Hãy Dừng lượt đang chạy trước khi hoàn tác.", ma: "DANG_CHAY" });
      return;
    }
    if (!this.soCuoi) {
      this.pt.gui({ loai: "ag_thong_bao", thongDiep: "Chưa có lượt chạy nào để hoàn tác." });
      return;
    }
    const kq = await hoanTacLuotChay(this.soCuoi, {
      apBanVa: this.pt.apBanVa ?? apBanVaThat,
      dauVaoChung: () => this.dauVaoChung(),
      docBam: async (p) => {
        try {
          return bamNoiDung(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(p))).toString("utf8"));
        } catch (e) {
          const ma = String((e as { code?: unknown })?.code ?? "");
          return /FileNotFound|EntryNotFound|ENOENT/.test(`${ma} ${(e as Error)?.message}`) ? null : undefined;
        }
      },
    });
    if (kq.ok) this.soCuoi = undefined;
    this.pt.gui({ loai: "ag_hoan_tac", ok: kq.ok, thongDiep: kq.thongDiep, chiTiet: kq.chiTiet, conHoanTac: !kq.ok && !!this.soCuoi });
  }

  async nho(id: string, dongY: boolean): Promise<void> {
    const note = this.deXuatNho.get(id);
    this.deXuatNho.delete(id);
    if (!note) return;
    if (dongY) {
      await themMucBoNho(dungKhoWorkspaceState(this.pt.context), randomUUID(), note, "ai_de_xuat_duyet");
      this.pt.gui({ loai: "ag_thong_bao", thongDiep: `Đã nhớ: "${note}"` });
    }
    this.pt.gui({ loai: "ag_an_de_xuat_nho", id });
  }

  // ─── KHỐI MÃ: Chép · Chèn vào con trỏ · Áp dụng ─────────────────────────────────────────────

  async hanhDongKhoiMa(chiSo: number, hanhDong: string): Promise<void> {
    const k = this.dsKhoiMa[chiSo];
    if (!k) return;
    if (hanhDong === "chep") {
      await vscode.env.clipboard.writeText(k.ma);
      this.pt.gui({ loai: "ag_thong_bao", thongDiep: "Đã chép khối mã." });
      return;
    }
    const ed = vscode.window.activeTextEditor;
    const goc = this.pt.goc();
    const gocThat = gocDaGiai(goc);
    if (!ed || ed.document.uri.scheme !== "file") {
      this.pt.gui({ loai: "ag_loi", thongDiep: "Hãy mở (và đặt con trỏ trong) tệp cần chèn/áp dụng trước.", ma: "KHONG_EDITOR" });
      return;
    }
    if (ed.document.isDirty) {
      this.pt.gui({ loai: "ag_loi", thongDiep: "Tệp đang có thay đổi CHƯA LƯU — hãy lưu trước (điểm ghi không nuốt phần chưa lưu).", ma: "TEP_BAN" });
      return;
    }
    const abs = ed.document.uri.fsPath;
    const rel = duongTuongDoiTrongWorkspace(abs, goc)?.duongTuongDoi ?? nhanGon(abs, gocThat);
    let dia: string;
    try {
      dia = Buffer.from(await vscode.workspace.fs.readFile(ed.document.uri)).toString("utf8");
    } catch (e) {
      this.pt.gui({ loai: "ag_loi", thongDiep: `Không đọc được tệp: ${cheBiMat((e as Error).message)}`, ma: "DOC_LOI" });
      return;
    }
    const vb = ed.document.getText();
    if (vb !== dia) {
      this.pt.gui({ loai: "ag_loi", thongDiep: "Nội dung editor khác byte trên đĩa (BOM/EOL) — không chèn để khỏi đổi những dòng bạn không chạm.", ma: "LECH_DIA" });
      return;
    }
    const dau = ed.document.offsetAt(ed.selection.start);
    const cuoi = ed.document.offsetAt(ed.selection.end);
    const moi =
      hanhDong === "chen"
        ? `${dia.slice(0, cuoi)}${k.ma}${dia.slice(cuoi)}`
        : ed.selection.isEmpty
          ? k.ma.endsWith("\n") || !dia.endsWith("\n")
            ? k.ma
            : `${k.ma}\n`
          : `${dia.slice(0, dau)}${k.ma}${dia.slice(cuoi)}`;
    if (hanhDong === "ap-dung") {
      // Áp dụng = ĐỀ XUẤT qua cửa duyệt (diff), không ghi thẳng.
      const id = `apdung-${randomUUID()}`;
      const ac = new AbortController();
      const qd = await this.xinDuyet(
        {
          id,
          loai: "ghi",
          ten: "edit_file",
          duongTuongDoi: rel,
          duongTuyetDoi: abs,
          thaoTac: "thay",
          goc: dia,
          moi,
          tomTat: ed.selection.isEmpty ? `Thay TOÀN BỘ ${rel} bằng khối mã` : `Thay vùng chọn trong ${rel} bằng khối mã`,
        },
        ac.signal,
      );
      if (!qd.duyet) return;
    }
    const kq = await (this.pt.apBanVa ?? apBanVaThat)({
      ...(await this.dauVaoChung()),
      thaoTac: { loai: "thay", noiDungMoi: moi },
      duongTuyetDoi: abs,
      duongTuongDoi: rel,
      bamGoc: bamNoiDung(dia),
    });
    this.pt.gui({ loai: kq.ok ? "ag_thong_bao" : "ag_loi", thongDiep: kq.thongDiep, ma: kq.ok ? undefined : "KHONG_GHI" });
  }

  // ─── NGỮ CẢNH ────────────────────────────────────────────────────────────────────────────────

  private async dungNguCanhDuAn(gocDuAn: string, gocThat: string[]): Promise<string> {
    const cay: string[] = [];
    const doc = async (p: string) => {
      try {
        return await vscode.workspace.fs.readDirectory(vscode.Uri.file(p));
      } catch {
        return [] as [string, vscode.FileType][];
      }
    };
    const sapXep = (ds: [string, vscode.FileType][]) =>
      [...ds].sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] === vscode.FileType.Directory ? -1 : 1));
    for (const [ten, loai] of sapXep(await doc(gocDuAn))) {
      const p = join(gocDuAn, ten);
      if (!duocPhepRoiMay(p)) continue;
      if (loai === vscode.FileType.Directory) {
        if (THU_MUC_AN.has(ten)) continue;
        cay.push(`${ten}/`);
        for (const [ten2, loai2] of sapXep(await doc(p)).slice(0, 25)) {
          if (!duocPhepRoiMay(join(p, ten2)) || THU_MUC_AN.has(ten2)) continue;
          cay.push(`${ten}/${ten2}${loai2 === vscode.FileType.Directory ? "/" : ""}`);
        }
      } else cay.push(ten);
    }
    const tepQuyUoc: Array<{ duong: string; noiDung: string }> = [];
    for (const rel of TEP_QUY_UOC) {
      const p = join(gocDuAn, ...rel.split("/"));
      if (!duocPhepDoc(p, gocThat).ok) continue;
      try {
        const buf = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(p)));
        if (buf.length <= 64 * 1024 && !buf.subarray(0, 8192).includes(0)) tepQuyUoc.push({ duong: rel, noiDung: buf.toString("utf8") });
      } catch {
        /* không có tệp này */
      }
    }
    const boNho = docDanhSachBoNho(dungKhoWorkspaceState(this.pt.context)).map((m) => m.noiDung);
    const ten = vscode.workspace.workspaceFolders?.find((f) => f.uri.fsPath === gocDuAn)?.name ?? gocDuAn.split(/[\\/]/).pop() ?? "project";
    return dungNguCanhDuAnExtension({ ten, cay, lenhDuocPhep: LENH_DUOC_PHEP_HIEN_THI, tepQuyUoc, boNho });
  }

  private async dinhKemMention(ds: string[], gocThat: string[], dk: DinhKemAgent): Promise<void> {
    for (const duong of [...new Set(ds)].slice(0, 10)) {
      const that = quyVeDuongThat(duong, gocThat);
      if (!that.ok || !duocPhepDoc(that.duong, gocThat, true).ok) continue;
      const uri = vscode.Uri.file(that.duong);
      const rel = nhanGon(that.duong, gocThat);
      try {
        const st = await vscode.workspace.fs.stat(uri);
        if (st.type === vscode.FileType.Directory) {
          const muc = await vscode.workspace.fs.readDirectory(uri);
          const lietKe = muc
            .filter(([t]) => duocPhepRoiMay(join(that.duong, t)))
            .map(([t, l]) => (l === vscode.FileType.Directory ? `${t}/` : t))
            .slice(0, 200)
            .join("\n");
          (dk.thuMuc ??= []).push({ rel: rel || ".", lietKe });
        } else {
          const buf = Buffer.from(await vscode.workspace.fs.readFile(uri));
          if (buf.subarray(0, 8192).includes(0)) continue;
          let nd = buf.toString("utf8");
          if (nd.length > TRAN_KY_TU_TEP_DINH_KEM) nd = `${nd.slice(0, TRAN_KY_TU_TEP_DINH_KEM)}\n…[cut — use read_file with start_line]`;
          (dk.tep ??= []).push({ rel, noiDung: nd });
        }
      } catch {
        /* bỏ qua đường không đọc được */
      }
    }
  }

  private chanDoanCua(uri: vscode.Uri, gocThat: string[]): MucChanDoan[] {
    return vscode.languages.getDiagnostics(uri).map((d) => ({
      rel: nhanGon(uri.fsPath, gocThat),
      dong: d.range.start.line + 1,
      cot: d.range.start.character + 1,
      mucDo: (["error", "warning", "info", "hint"] as const)[d.severity] ?? "info",
      thongDiep: d.message,
      nguon: d.source,
    }));
  }

  private chanDoanWorkspace(gocThat: string[]): string {
    const ds: MucChanDoan[] = [];
    for (const [uri] of vscode.languages.getDiagnostics()) {
      if (uri.scheme !== "file" || !duocPhepDoc(uri.fsPath, gocThat).ok) continue;
      ds.push(...this.chanDoanCua(uri, gocThat));
    }
    return dinhDangChanDoan(ds, "workspace");
  }

  /**
   * Lệnh ĐỌC do NGƯỜI DÙNG chủ động gọi (@git) — argv cố định từ allowlist, không qua model.
   * ★★★ (rà bảo mật 9d26ad568) loại khối tệp cấm (`.env` đã theo dõi…) TRƯỚC khi che + cắt, và báo người dùng.
   */
  private async chayLenhDoc(lenh: string, cwd: string): Promise<string> {
    const xet = xetDuyetLenh(lenh);
    if (!xet.ok) return `(không chạy được: ${xet.lyDo})`;
    const kq = await (this.pt.chayLenh ?? chayLenhCucBoThat)({ lenh: xet.lenh, cwd, tranMs: TRAN_MS_THEO_LENH[xet.lenh.ten] });
    if (!kq.ok) return `(lệnh "${lenh}" hỏng, exit ${kq.exitCode ?? "?"}: ${cheBiMat(locDiffTepCam(kq.output).diff.slice(0, 500))})`;
    const loc = locDiffTepCam(kq.output);
    if (loc.tepBiLoai.length) {
      this.pt.gui({
        loai: "ag_thong_bao",
        thongDiep: `⚠ "${lenh}" có ${loc.tepBiLoai.length} tệp nhạy cảm (${loc.tepBiLoai.slice(0, 10).map((p) => `"${cheBiMat(p)}"`).join(", ")}) — nội dung của chúng KHÔNG được gửi cho model.`,
      });
    }
    const ra = cheBiMat(loc.diff);
    return ra.length > TRAN_DIFF_STAGED ? `${ra.slice(0, TRAN_DIFF_STAGED)}\n…[diff cut]` : ra;
  }

  /** `/commit`: trả đầu ra THÔ — `dungCauHoiLenhGach` là cửa chót (loại tệp cấm + che + cắt + cảnh báo người dùng). */
  private async diffStaged(cwd: string): Promise<string> {
    const xet = xetDuyetLenh("git diff --staged");
    if (!xet.ok) return "";
    const kq = await (this.pt.chayLenh ?? chayLenhCucBoThat)({ lenh: xet.lenh, cwd, tranMs: TRAN_MS_THEO_LENH[xet.lenh.ten] });
    return kq.ok ? kq.output : "";
  }
}
