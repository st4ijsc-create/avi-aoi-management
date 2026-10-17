/**
 * ★★★ ĐỢT 4B — `BoThucThiVscode`: bộ thực thi tool của LÕI AGENT DÙNG CHUNG (`shared/agentCore`) trên workspace
 * VSCode của máy lập trình viên (quyết định Q2-A: server chạy lõi cho trình duyệt, extension chạy CÙNG lõi cho VSCode).
 *
 * ĐỌC (không cần duyệt): `read_file` (vscode.workspace.fs, đánh số dòng, che bí mật) · `list_dir` · `find_files`
 *   (workspace.findFiles) · `grep` (regex JS trên tệp đọc qua workspace.fs — QUYẾT ĐỊNH: KHÔNG gọi ripgrep đi kèm
 *   VSCode: đường nhị phân nằm trong `appRoot/node_modules/@vscode/ripgrep` là chi tiết nội bộ, không phải API, và
 *   spawn nó là thêm một đường tiến trình ngoài allowlist) · `find_symbol` (LSP sẵn có: workspace symbol + references)
 *   · `get_diagnostics` (tool RIÊNG của extension, ghép thêm vào `congCu()` — lõi không đổi).
 *   Mọi lượt đọc qua đúng hàng rào cũ: `duocPhepDoc` (trong workspace, không tệp nhạy cảm, không `.git`) + `cheBiMat`.
 * KHÔNG BÀY: `search_code` (chưa có chỉ mục ngữ nghĩa trong extension) và `search_docs` (kho tài liệu ở máy chủ) — lõi
 *   tự trả lời model "tool không có trong chế độ này" nếu nó vẫn gọi.
 * GHI: `edit_file`/`write_file`/`delete_file`/`rename_file` ⇒ ĐIỂM GHI DUY NHẤT `apBanVa` (thao tác `thay`/`tao`/`xoa`/
 *   `doi-ten`), sau cửa duyệt TỪNG TỆP (chế độ `sua`; `tu-dong` chỉ bỏ duyệt khi mức quyền là `tu_ghi`). Mức quyền
 *   `chi_doc` không hiện thẻ — đi thẳng tới `apBanVa` để bị chặn TẠI ĐIỂM GHI (một nguồn sự thật cho lời từ chối).
 *   Trước mỗi lượt ghi, nội dung GỐC được chụp vào checkpoint của lượt chạy (hoàn tác: `ui/hoanTac.ts`).
 * LỆNH: `run_command` ⇒ allowlist của extension (`xetDuyetLenh`) ⇒ LUÔN hỏi (kể cả tự động — giữ quyết định cũ của
 *   extension: chạy tiến trình là hành động khác hẳn ghi tệp) ⇒ `chayLenhCucBo` ⇒ ĐẦU RA + EXIT CODE TRẢ VỀ MODEL.
 * NHỚ: `remember` ⇒ sự kiện `de-xuat-nho` (đề xuất); chỉ người bấm "Nhớ" mới ghi vào `khoBoNho`.
 */
import * as vscode from "vscode";
import { existsSync } from "node:fs";
import {
  apDungEdits,
  congCuTheoCheDo,
  type BoThucThi,
  type CheDoAgent,
  type KetQuaTool,
  type LoiGoiTool,
  type MotEdit,
  type NguCanhThucThi,
  type WireTool,
} from "../../../shared/agentCore/index";
import { apBanVa as apBanVaThat, type DauVaoApBanVa, type KetQuaApBanVa, type ThaoTacGhi } from "./apBanVa";
import { bamNoiDung } from "../loi/bamTep";
import { duocPhepGhi, duongTuongDoiTrongWorkspace, giaiDuongDeXuat } from "../loi/chanGhi";
import { giaiDuongThatChoTaoMoi } from "../loi/duongThat";
import { duocPhepDoc, lamSachLyDo } from "../loi/docCucBo";
import { cheBiMat, duocPhepRoiMay } from "../loi/nguCanh";
import { chuanHoaMucQuyen, type MucQuyen } from "../loi/mucQuyen";
import { xetDuyetLenh, TRAN_MS_THEO_LENH } from "../loi/lenhChoPhep";
import { dinhDangKetQuaLenh } from "../loi/dinhDangKetQuaLenh";
import { chayLenhCucBo as chayLenhCucBoThat } from "../mang/chayLenhCucBo";
import { LOAI_TRU, gocDaGiai, locUngVien, nhanGon, quyVeDuongThat } from "../mang/toolCucBo";
import { dinhDangChanDoan, dinhDangDocFile, grepTrenTep, type MucChanDoan, type TepQuet } from "../loi/congCuDoc";
import type { SoCheckpoint } from "../loi/checkpoint";

/** Tool riêng của extension (không thuộc bộ 14 của lõi) — đọc, có ở MỌI chế độ. */
export const CONG_CU_CHAN_DOAN: WireTool = {
  type: "function",
  function: {
    name: "get_diagnostics",
    description:
      "Get the problems (compiler/linter errors and warnings) VSCode currently reports for one file, or for the whole workspace " +
      "when path is omitted. Use it after editing to check that your change compiles, before running a full build.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "File path relative to the project root (optional)." } },
      required: [],
    },
  },
};

const KHONG_BAY = new Set(["search_code", "search_docs"]);
const TRAN_TEP_GREP = 4000;
const TRAN_BYTE_TEP_GREP = 1024 * 1024;
const TRAN_BYTE_MO = 16 * 1024 * 1024;
const TTL_DUYET_MS = 30 * 60 * 1000;

export interface YeuCauDuyet {
  id: string;
  loai: "ghi" | "lenh";
  ten: string;
  duongTuongDoi?: string;
  duongTuyetDoi?: string;
  duongDichTuongDoi?: string;
  thaoTac?: ThaoTacGhi["loai"];
  /** nội dung gốc (null = tệp chưa có) và nội dung đề xuất — cho `vscode.diff` */
  goc?: string | null;
  moi?: string | null;
  tomTat: string;
  lenh?: string;
}

export type QuyetDinhDuyet = { duyet: true } | { duyet: false; lyDo?: string };

export interface PhuThuocBoThucThi {
  /** Các thư mục workspace (fsPath), gốc DỰ ÁN đang chọn đứng đầu. */
  goc: () => string[];
  mucQuyen: () => MucQuyen;
  serverUrl: () => string;
  layCookie: () => Promise<string | undefined>;
  nhanWorkspace: () => string;
  xinDuyet: (yc: YeuCauDuyet, signal: AbortSignal) => Promise<QuyetDinhDuyet>;
  checkpoint: () => SoCheckpoint;
  apBanVa?: (dv: DauVaoApBanVa) => Promise<KetQuaApBanVa>;
  chayLenh?: typeof chayLenhCucBoThat;
}

const loiModel = (choModel: string, ma: string): KetQuaTool => ({ ok: false, ma, choModel });

function chuoiThamSo(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

async function docVanBanFs(uri: vscode.Uri, tranByte: number): Promise<string | undefined> {
  const buf = Buffer.from(await vscode.workspace.fs.readFile(uri));
  if (buf.length > tranByte) return undefined;
  if (buf.subarray(0, 8192).includes(0)) return undefined;
  return buf.toString("utf8");
}

async function tonTaiFs(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

const MUC_DO: Record<number, MucChanDoan["mucDo"]> = { 0: "error", 1: "warning", 2: "info", 3: "hint" };

export class BoThucThiVscode implements BoThucThi {
  constructor(private readonly pt: PhuThuocBoThucThi) {}

  congCu(cheDo: CheDoAgent): WireTool[] {
    return [...congCuTheoCheDo(cheDo).filter((t) => !KHONG_BAY.has(t.function.name)), structuredClone(CONG_CU_CHAN_DOAN)];
  }

  async chay(goi: LoiGoiTool, ctx: NguCanhThucThi): Promise<KetQuaTool> {
    const gocThat = gocDaGiai(this.pt.goc());
    if (gocThat.length === 0) return loiModel("No workspace folder is open — no file can be read or written.", "KHONG_WORKSPACE");
    const t = goi.thamSo;
    try {
      switch (goi.ten) {
        case "read_file":
          return await this.docFile(String(t.path), gocThat, t.start_line as number | undefined, t.end_line as number | undefined);
        case "list_dir":
          return await this.lietKe(String(t.path), gocThat);
        case "find_files":
          return await this.timTep(String(t.pattern), gocThat);
        case "grep":
          return await this.grep(String(t.pattern), chuoiThamSo(t.path), chuoiThamSo(t.include), gocThat);
        case "find_symbol":
          return await this.timKyHieu(String(t.name), chuoiThamSo(t.kind), gocThat);
        case "get_diagnostics":
          return this.chanDoan(chuoiThamSo(t.path), gocThat);
        case "search_code":
        case "search_docs":
          return loiModel(
            `${goi.ten} is not available in the VSCode extension (no semantic index / documentation store here). Use grep, find_files or find_symbol instead.`,
            "KHONG_CO_TRONG_EXTENSION",
          );
        case "remember":
          return this.nho(goi, ctx);
        case "edit_file":
          return await this.suaTep(goi, String(t.path), t.edits as MotEdit[], ctx);
        case "write_file":
          return await this.vietTep(goi, String(t.path), String(t.content ?? ""), ctx);
        case "delete_file":
          return await this.xoaTep(goi, String(t.path), ctx);
        case "rename_file":
          return await this.doiTen(goi, String(t.from), String(t.to), ctx);
        case "run_command":
          return await this.chayLenh(goi, String(t.command), ctx);
        default:
          return loiModel(`Unknown tool "${goi.ten}".`, "CONG_CU_KHONG_CO");
      }
    } catch (e) {
      // Không lộ nguyên văn lỗi hệ thống (mang đường tuyệt đối máy dev) — che + chỉ tên lỗi.
      return loiModel(`Tool ${goi.ten} failed: ${lamSachLyDo((e as Error)?.message ?? String(e))}`, "LOI_THUC_THI");
    }
  }

  // ─── ĐỌC ─────────────────────────────────────────────────────────────────────────────────────

  private giaiDoc(duongModel: string, gocThat: string[], choPhepGoc = false): { ok: true; duong: string; rel: string } | { ok: false; kq: KetQuaTool } {
    const that = quyVeDuongThat(duongModel === "." ? gocThat[0] : duongModel, gocThat);
    if (!that.ok) return { ok: false, kq: loiModel(lamSachLyDo(that.lyDo), "DUONG_SAI") };
    const rao = duocPhepDoc(that.duong, gocThat, choPhepGoc);
    if (!rao.ok) return { ok: false, kq: loiModel(`Access denied: ${lamSachLyDo(rao.lyDo)}`, "BI_CHAN") };
    return { ok: true, duong: that.duong, rel: nhanGon(that.duong, gocThat) };
  }

  private async docFile(duong: string, gocThat: string[], tu?: number, den?: number): Promise<KetQuaTool> {
    const g = this.giaiDoc(duong, gocThat);
    if (!g.ok) return g.kq;
    const uri = vscode.Uri.file(g.duong);
    let st: vscode.FileStat;
    try {
      st = await vscode.workspace.fs.stat(uri);
    } catch {
      return loiModel(`File not found: ${g.rel}. Use find_files or list_dir to locate it.`, "KHONG_TON_TAI");
    }
    if (st.type === vscode.FileType.Directory) return loiModel(`${g.rel} is a directory — use list_dir.`, "LA_THU_MUC");
    const nd = await docVanBanFs(uri, TRAN_BYTE_MO);
    if (nd === undefined) return loiModel(`${g.rel} is binary or larger than 16 MB — not sent.`, "NHI_PHAN");
    return { ok: true, choModel: dinhDangDocFile(g.rel, nd, tu, den) };
  }

  private async lietKe(duong: string, gocThat: string[]): Promise<KetQuaTool> {
    const g = this.giaiDoc(duong, gocThat, true);
    if (!g.ok) return g.kq;
    let muc: [string, vscode.FileType][];
    try {
      muc = await vscode.workspace.fs.readDirectory(vscode.Uri.file(g.duong));
    } catch {
      return loiModel(`Directory not found: ${g.rel || "."}`, "KHONG_TON_TAI");
    }
    const an = new Set(["node_modules", ".git", "dist", "build", "out", "bin", "obj", ".next", "coverage", ".venv", "venv", "target"]);
    let boQua = 0;
    const dong = muc
      .filter(([ten, loai]) => {
        const day = `${g.duong}${g.duong.endsWith("\\") || g.duong.endsWith("/") ? "" : "/"}${ten}`;
        if (!duocPhepRoiMay(day)) {
          boQua++;
          return false;
        }
        return !(loai === vscode.FileType.Directory && an.has(ten));
      })
      .sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] === vscode.FileType.Directory ? -1 : 1))
      .map(([ten, loai]) => (loai === vscode.FileType.Directory ? `${ten}/` : ten));
    const tran = 300;
    const ra = [`Directory ${g.rel || "."} (${dong.length} entries):`, ...dong.slice(0, tran)];
    if (dong.length > tran) ra.push(`[cut: ${dong.length - tran} more]`);
    if (boQua) ra.push(`(${boQua} sensitive entries hidden)`);
    return { ok: true, choModel: ra.join("\n") };
  }

  private async timTep(mau: string, gocThat: string[]): Promise<KetQuaTool> {
    const uris: vscode.Uri[] = [];
    for (const g of gocThat) {
      if (uris.length >= 400) break;
      uris.push(...(await vscode.workspace.findFiles(new vscode.RelativePattern(vscode.Uri.file(g), mau), LOAI_TRU, 400 - uris.length)));
    }
    const { giu, soNhayCam } = locUngVien(uris, gocThat);
    const ds = [...new Set(giu.map((u) => u.nhan))].sort();
    const ra = [`${ds.length} files match ${cheBiMat(mau)}:`, ...ds.slice(0, 200)];
    if (ds.length > 200) ra.push(`[cut: ${ds.length - 200} more — use a narrower pattern]`);
    if (soNhayCam) ra.push(`(${soNhayCam} sensitive files hidden)`);
    return { ok: true, choModel: ra.join("\n") };
  }

  private async grep(mau: string, duong: string | undefined, include: string | undefined, gocThat: string[]): Promise<KetQuaTool> {
    let ds: vscode.Uri[];
    if (duong) {
      const g = this.giaiDoc(duong, gocThat, true);
      if (!g.ok) return g.kq;
      ds = [vscode.Uri.file(g.duong)];
    } else {
      ds = gocThat.map((x) => vscode.Uri.file(x));
    }
    const uris: vscode.Uri[] = [];
    for (const goc of ds) {
      if (uris.length >= TRAN_TEP_GREP) break;
      const laTep = await vscode.workspace.fs.stat(goc).then(
        (s) => s.type !== vscode.FileType.Directory,
        () => false,
      );
      if (laTep) {
        uris.push(goc);
        continue;
      }
      const loc = include ? (include.includes("/") ? include : `**/${include}`) : "**/*";
      uris.push(...(await vscode.workspace.findFiles(new vscode.RelativePattern(goc, loc), LOAI_TRU, TRAN_TEP_GREP - uris.length)));
    }
    const { giu, soNhayCam } = locUngVien(uris, gocThat);
    const tep: TepQuet[] = [];
    let boQua = soNhayCam;
    for (const u of giu) {
      try {
        const nd = await docVanBanFs(vscode.Uri.file(u.duong), TRAN_BYTE_TEP_GREP);
        if (nd === undefined) boQua++;
        else tep.push({ rel: u.nhan, noiDung: nd });
      } catch {
        boQua++;
      }
    }
    return { ok: true, choModel: grepTrenTep(mau, tep, { tapNguonBiCat: uris.length >= TRAN_TEP_GREP, soBoQua: boQua }) };
  }

  private async timKyHieu(ten: string, loai: string | undefined, gocThat: string[]): Promise<KetQuaTool> {
    const K = vscode.SymbolKind;
    const theoLoai: Record<string, number[]> = {
      function: [K.Function],
      class: [K.Class],
      method: [K.Method, K.Constructor],
      interface: [K.Interface],
      type: [K.TypeParameter, K.Interface, K.Class, K.Struct],
      enum: [K.Enum],
      variable: [K.Variable, K.Constant, K.Property, K.Field],
    };
    const tho = (await vscode.commands.executeCommand<vscode.SymbolInformation[]>("vscode.executeWorkspaceSymbolProvider", ten)) ?? [];
    const dinhNghia = tho
      .filter((s) => s.name === ten || s.name.replace(/\(.*$/, "") === ten)
      .filter((s) => !loai || (theoLoai[loai] ?? []).includes(s.kind))
      .filter((s) => duocPhepDoc(s.location.uri.fsPath, gocThat).ok)
      .slice(0, 10);
    if (dinhNghia.length === 0) {
      return {
        ok: true,
        choModel: `No definition of "${cheBiMat(ten)}"${loai ? ` (${loai})` : ""} found by the language servers (they may not be loaded for this file type yet). Fall back to grep.`,
      };
    }
    const ra: string[] = [`Definitions of "${cheBiMat(ten)}":`];
    const dongCua = new Map<string, string[]>();
    const docDong = async (fsPath: string, dong: number): Promise<string> => {
      if (!dongCua.has(fsPath)) {
        const nd = await docVanBanFs(vscode.Uri.file(fsPath), TRAN_BYTE_TEP_GREP).catch(() => undefined);
        dongCua.set(fsPath, nd ? nd.split(/\r?\n/) : []);
      }
      return cheBiMat((dongCua.get(fsPath)![dong] ?? "").trim()).slice(0, 200);
    };
    for (const s of dinhNghia) {
      const l = s.location.range.start.line;
      ra.push(`${nhanGon(s.location.uri.fsPath, gocThat)}:${l + 1}  [${K[s.kind] ?? s.kind}${s.containerName ? ` in ${s.containerName}` : ""}]  ${await docDong(s.location.uri.fsPath, l)}`);
    }
    const thamChieu: string[] = [];
    for (const s of dinhNghia.slice(0, 3)) {
      const refs =
        (await vscode.commands.executeCommand<vscode.Location[]>("vscode.executeReferenceProvider", s.location.uri, s.location.range.start)) ?? [];
      for (const r of refs) {
        if (thamChieu.length >= 30) break;
        if (!duocPhepDoc(r.uri.fsPath, gocThat).ok) continue;
        const dong = r.range.start.line;
        const nhan = `${nhanGon(r.uri.fsPath, gocThat)}:${dong + 1}`;
        if (thamChieu.some((x) => x.startsWith(`${nhan} `))) continue;
        thamChieu.push(`${nhan}  ${await docDong(r.uri.fsPath, dong)}`);
      }
    }
    if (thamChieu.length) ra.push("", `References (${thamChieu.length}${thamChieu.length >= 30 ? "+, cut" : ""}):`, ...thamChieu);
    return { ok: true, choModel: ra.join("\n") };
  }

  private chanDoan(duong: string | undefined, gocThat: string[]): KetQuaTool {
    const doi = (uri: vscode.Uri, ds: readonly vscode.Diagnostic[]): MucChanDoan[] =>
      ds.map((d) => ({
        rel: nhanGon(uri.fsPath, gocThat),
        dong: d.range.start.line + 1,
        cot: d.range.start.character + 1,
        mucDo: MUC_DO[d.severity] ?? "info",
        thongDiep: d.message,
        nguon: d.source,
        ma: typeof d.code === "object" && d.code ? String(d.code.value) : d.code !== undefined ? String(d.code) : undefined,
      }));
    if (duong) {
      const g = this.giaiDoc(duong, gocThat);
      if (!g.ok) return g.kq;
      const uri = vscode.Uri.file(g.duong);
      return { ok: true, choModel: dinhDangChanDoan(doi(uri, vscode.languages.getDiagnostics(uri)), g.rel) };
    }
    const tatCa: MucChanDoan[] = [];
    for (const [uri, ds] of vscode.languages.getDiagnostics()) {
      if (uri.scheme !== "file" || !duocPhepDoc(uri.fsPath, gocThat).ok) continue;
      tatCa.push(...doi(uri, ds));
    }
    return { ok: true, choModel: dinhDangChanDoan(tatCa, "workspace") };
  }

  private nho(goi: LoiGoiTool, ctx: NguCanhThucThi): KetQuaTool {
    const note = cheBiMat(String(goi.thamSo.note ?? "").replace(/\s+/g, " ").trim());
    const scope = goi.thamSo.scope === "user" ? "user" : "project";
    ctx.phat({ loai: "de-xuat-nho", id: goi.id, note, scope });
    return { ok: true, choModel: "Proposed to the user. Nothing is saved unless they approve it." };
  }

  // ─── GHI ─────────────────────────────────────────────────────────────────────────────────────

  /**
   * Đường model khai ⇒ tuyệt đối + tương đối, KÈM KIỂM TRƯỚC hàng rào ghi trên đường THẬT — để không hiện thẻ duyệt
   * (và không đọc nội dung tệp cấm như `.env` vào bộ nhớ) cho một lượt chắc chắn bị chặn. `apBanVa` vẫn kiểm LẠI ở
   * điểm ghi: đây chỉ là chặn sớm, không thay hàng rào.
   */
  private giaiGhi(duongModel: string): { ok: true; abs: string; rel: string } | { ok: false; kq: KetQuaTool } {
    const goc = this.pt.goc();
    const gocDangChon = goc[0] ?? "";
    const g = giaiDuongDeXuat(duongModel, gocDangChon, goc, (p) => existsSync(p));
    if (!g.ok) return { ok: false, kq: loiModel(lamSachLyDo(g.lyDo), "DUONG_MO_HO") };
    const that = giaiDuongThatChoTaoMoi(g.duong);
    if (!that.ok) return { ok: false, kq: loiModel(`Write blocked: ${lamSachLyDo(that.lyDo)}`, "BI_CHAN") };
    const rao = duocPhepGhi(that.duong, gocDaGiai(goc));
    if (!rao.ok) return { ok: false, kq: loiModel(`Write blocked: ${lamSachLyDo(rao.lyDo)}`, "BI_CHAN") };
    const rel = duongTuongDoiTrongWorkspace(g.duong, goc)?.duongTuongDoi ?? duongModel.replace(/\\/g, "/");
    return { ok: true, abs: g.duong, rel };
  }

  private async docHienTai(abs: string): Promise<string | null> {
    const uri = vscode.Uri.file(abs);
    if (!(await tonTaiFs(uri))) return null;
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
  }

  private async suaTep(goi: LoiGoiTool, duong: string, edits: MotEdit[], ctx: NguCanhThucThi): Promise<KetQuaTool> {
    const gg = this.giaiGhi(duong);
    if (!gg.ok) return gg.kq;
    const { abs, rel } = gg;
    const goc = await this.docHienTai(abs);
    if (goc === null) return loiModel(`File not found: ${rel}. To create a new file use write_file.`, "KHONG_TON_TAI");
    const kq = apDungEdits(goc, edits);
    if (!kq.ok) return loiModel(kq.loi, kq.ma);
    return this.ghi(goi, ctx, { abs, rel, goc, moi: kq.noiDung, thaoTac: { loai: "thay", noiDungMoi: kq.noiDung } });
  }

  private async vietTep(goi: LoiGoiTool, duong: string, noiDung: string, ctx: NguCanhThucThi): Promise<KetQuaTool> {
    const gg = this.giaiGhi(duong);
    if (!gg.ok) return gg.kq;
    const { abs, rel } = gg;
    const goc = await this.docHienTai(abs);
    if (goc !== null && goc === noiDung) return { ok: true, choModel: `${rel} already has exactly this content; nothing to change.` };
    return this.ghi(goi, ctx, {
      abs,
      rel,
      goc,
      moi: noiDung,
      thaoTac: goc === null ? { loai: "tao", noiDungMoi: noiDung } : { loai: "thay", noiDungMoi: noiDung },
    });
  }

  private async xoaTep(goi: LoiGoiTool, duong: string, ctx: NguCanhThucThi): Promise<KetQuaTool> {
    const gg = this.giaiGhi(duong);
    if (!gg.ok) return gg.kq;
    const { abs, rel } = gg;
    const goc = await this.docHienTai(abs);
    if (goc === null) return loiModel(`File not found: ${rel}.`, "KHONG_TON_TAI");
    return this.ghi(goi, ctx, { abs, rel, goc, moi: null, thaoTac: { loai: "xoa" } });
  }

  private async doiTen(goi: LoiGoiTool, tu: string, den: string, ctx: NguCanhThucThi): Promise<KetQuaTool> {
    const a = this.giaiGhi(tu);
    if (!a.ok) return a.kq;
    const b = this.giaiGhi(den);
    if (!b.ok) return b.kq;
    const goc = await this.docHienTai(a.abs);
    if (goc === null) return loiModel(`File not found: ${a.rel}.`, "KHONG_TON_TAI");
    if ((await this.docHienTai(b.abs)) !== null) return loiModel(`Destination already exists: ${b.rel}. Choose another name.`, "DICH_DA_CO");
    return this.ghi(goi, ctx, {
      abs: a.abs,
      rel: a.rel,
      goc,
      moi: goc,
      thaoTac: { loai: "doi-ten", duongDichTuyetDoi: b.abs, duongDichTuongDoi: b.rel },
    });
  }

  /** Cửa chung của MỌI lượt ghi: (duyệt) ⇒ `apBanVa` ⇒ checkpoint. */
  private async ghi(
    goi: LoiGoiTool,
    ctx: NguCanhThucThi,
    v: { abs: string; rel: string; goc: string | null; moi: string | null; thaoTac: ThaoTacGhi },
  ): Promise<KetQuaTool> {
    const mucQuyen = chuanHoaMucQuyen(this.pt.mucQuyen());
    const nhanThaoTac =
      v.thaoTac.loai === "tao" ? "create" : v.thaoTac.loai === "xoa" ? "delete" : v.thaoTac.loai === "doi-ten" ? "rename" : "edit";
    const dauVao = async (): Promise<DauVaoApBanVa> => ({
      thaoTac: v.thaoTac,
      duongTuyetDoi: v.abs,
      duongTuongDoi: v.rel,
      bamGoc: bamNoiDung(v.goc ?? ""),
      thuMucWorkspace: this.pt.goc(),
      nhanWorkspace: this.pt.nhanWorkspace(),
      serverUrl: this.pt.serverUrl(),
      cookie: (await this.pt.layCookie()) ?? "",
      mucQuyen,
    });
    const ap = this.pt.apBanVa ?? apBanVaThat;

    if (mucQuyen !== "chi_doc") {
      const cookie = await this.pt.layCookie();
      if (!cookie) {
        return loiModel(
          "Write not performed: every file change must be recorded in the server audit log, which needs the user's session login. " +
            'Ask the user to run "AI Local: Đăng nhập phiên (mật khẩu)" and then retry.',
          "CHUA_DANG_NHAP_PHIEN",
        );
      }
      const canDuyet = !(ctx.cheDo === "tu-dong" && mucQuyen === "tu_ghi");
      if (canDuyet) {
        const tomTat =
          v.thaoTac.loai === "doi-ten"
            ? `Đổi tên ${v.rel} → ${v.thaoTac.duongDichTuongDoi}`
            : v.thaoTac.loai === "xoa"
              ? `Xoá ${v.rel}`
              : v.thaoTac.loai === "tao"
                ? `Tạo ${v.rel}`
                : `Sửa ${v.rel}`;
        ctx.phat({ loai: "can-duyet", id: goi.id, deXuat: { ten: goi.ten, thamSo: { path: v.rel }, moTa: tomTat } });
        const qd = await this.choDuyet(
          {
            id: goi.id,
            loai: "ghi",
            ten: goi.ten,
            duongTuongDoi: v.rel,
            duongTuyetDoi: v.abs,
            duongDichTuongDoi: v.thaoTac.loai === "doi-ten" ? v.thaoTac.duongDichTuongDoi : undefined,
            thaoTac: v.thaoTac.loai,
            goc: v.goc,
            moi: v.moi,
            tomTat,
          },
          ctx.signal,
        );
        if (!qd.duyet) {
          ctx.phat({ loai: "bi-bac", id: goi.id, ...(qd.lyDo ? { lyDo: qd.lyDo } : {}) });
          return loiModel(
            `The user rejected this ${nhanThaoTac} of ${v.rel}${qd.lyDo ? `. Reason: ${cheBiMat(qd.lyDo)}` : " (no reason given)"}. Adapt; do not repeat it unchanged.`,
            "BI_BAC",
          );
        }
        ctx.phat({ loai: "da-duyet", id: goi.id });
      }
    }

    const kq = await ap(await dauVao());
    if (!kq.ok) return { ok: false, ma: "KHONG_GHI", choModel: `Not applied (${nhanThaoTac} ${v.rel}): ${cheBiMat(kq.thongDiep)}`, hienThi: { thongDiep: kq.thongDiep } };

    const so = this.pt.checkpoint();
    if (v.thaoTac.loai === "doi-ten") {
      so.ghiNhan(v.abs, v.rel, v.goc, null);
      so.ghiNhan(v.thaoTac.duongDichTuyetDoi, v.thaoTac.duongDichTuongDoi, null, kq.bamSauThat ?? null);
    } else {
      so.ghiNhan(v.abs, v.rel, v.goc, kq.bamSauThat === undefined ? null : kq.bamSauThat);
    }
    ctx.phat({ loai: "checkpoint", checkpointId: so.runId, tep: so.danhSach().map((m) => m.duongTuongDoi) });
    return {
      ok: true,
      choModel: `Applied: ${nhanThaoTac} ${v.rel}${v.thaoTac.loai === "doi-ten" ? ` → ${v.thaoTac.duongDichTuongDoi}` : ""}.`,
      hienThi: { thongDiep: kq.thongDiep },
      thayDoi: [
        {
          duong: v.thaoTac.loai === "doi-ten" ? v.thaoTac.duongDichTuongDoi : v.rel,
          loai: v.thaoTac.loai === "thay" ? "sua" : v.thaoTac.loai,
          ...(v.thaoTac.loai === "doi-ten" ? { tuDuong: v.rel } : {}),
          bamSau: kq.bamSauThat ?? null,
        },
      ],
    };
  }

  private async choDuyet(yc: YeuCauDuyet, signal: AbortSignal): Promise<QuyetDinhDuyet> {
    let hen: ReturnType<typeof setTimeout> | undefined;
    const ttl = new Promise<QuyetDinhDuyet>((res) => {
      hen = setTimeout(() => res({ duyet: false, lyDo: "approval timed out (30 min)" }), TTL_DUYET_MS);
    });
    try {
      return await Promise.race([this.pt.xinDuyet(yc, signal), ttl]);
    } finally {
      if (hen) clearTimeout(hen);
    }
  }

  // ─── LỆNH ────────────────────────────────────────────────────────────────────────────────────

  private async chayLenh(goi: LoiGoiTool, lenh: string, ctx: NguCanhThucThi): Promise<KetQuaTool> {
    const xet = xetDuyetLenh(lenh.trim());
    if (!xet.ok) {
      return loiModel(
        `Command not allowed: ${cheBiMat(xet.lyDo)}. Allowed commands: git status · git diff · git diff --staged · npm run check · ` +
          "npx vitest run <path> · dotnet build <path> · dotnet test <path>.",
        "LENH_KHONG_DUOC_PHEP",
      );
    }
    if (chuanHoaMucQuyen(this.pt.mucQuyen()) === "chi_doc") {
      return loiModel('Command not run: the permission level is "read-only" (Chỉ đọc).', "CHI_DOC");
    }
    const cwd = this.pt.goc()[0];
    ctx.phat({ loai: "can-duyet", id: goi.id, deXuat: { ten: goi.ten, thamSo: { command: xet.lenh.hienThi }, moTa: `Chạy: ${xet.lenh.hienThi}` } });
    const qd = await this.choDuyet({ id: goi.id, loai: "lenh", ten: goi.ten, lenh: xet.lenh.hienThi, tomTat: `Chạy lệnh: ${xet.lenh.hienThi}` }, ctx.signal);
    if (!qd.duyet) {
      ctx.phat({ loai: "bi-bac", id: goi.id, ...(qd.lyDo ? { lyDo: qd.lyDo } : {}) });
      return loiModel(`The user rejected running "${xet.lenh.hienThi}"${qd.lyDo ? `. Reason: ${cheBiMat(qd.lyDo)}` : ""}.`, "BI_BAC");
    }
    ctx.phat({ loai: "da-duyet", id: goi.id });
    const kq = await (this.pt.chayLenh ?? chayLenhCucBoThat)({ lenh: xet.lenh, cwd, tranMs: TRAN_MS_THEO_LENH[xet.lenh.ten] });
    const vanBan = dinhDangKetQuaLenh({
      lenhHienThi: xet.lenh.hienThi,
      output: kq.output,
      exitCode: kq.exitCode,
      timedOut: kq.timedOut,
      daCatSomODongChay: kq.daCatSom,
    });
    return {
      ok: kq.ok,
      ...(kq.ok ? {} : { ma: kq.timedOut ? "HET_GIO" : "EXIT_KHAC_0" }),
      choModel: `exit code: ${kq.exitCode ?? "none"}${kq.timedOut ? " (timed out)" : ""}\n${vanBan}`,
      hienThi: { lenh: xet.lenh.hienThi, exitCode: kq.exitCode, output: vanBan },
    };
  }
}
