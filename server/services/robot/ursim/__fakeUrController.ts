/**
 * doc 81 Đợt 1B Task 3 — FAKE UR CONTROLLER cho test (KHÔNG phải mã sản phẩm).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Một bộ điều khiển Universal Robots GIẢ chạy trong tiến trình test, trên 127.0.0.1 với
 * cổng 0 (hệ điều hành cấp). Hai socket, viết theo TÀI LIỆU HÃNG — KHÔNG suy ra từ mã
 * sản phẩm (oracle độc lập):
 *
 *   • DASHBOARD (vai 29999) — giao thức dòng văn bản của "Dashboard Server" UR:
 *       lời chào  "Connected: Universal Robots Dashboard Server"
 *       power on          → "Powering on"          (robotmode POWER_OFF → IDLE)
 *       brake release     → "Brake releasing"      (robotmode IDLE → RUNNING)
 *       power off         → "Powering off"
 *       robotmode         → "Robotmode: <MODE>"
 *       running           → "Program running: true" | "Program running: false"
 *       programState      → "PLAYING <unnamed>" | "STOPPED <unnamed>"
 *       safetystatus      → "Safetystatus: <STATUS>"   (e-series ≥ 5.4 / CB3 ≥ 3.11)
 *       safetymode        → "Safetymode: <MODE>"       (lệnh cũ)
 *       stop              → "Stopped"
 *       lệnh lạ           → "could not understand: '<cmd>'"
 *     ⇒ Lưu ý then chốt của tài liệu: sau `power on` + `brake release`, `robotmode` là
 *       RUNNING NGAY CẢ KHI KHÔNG CÓ CHƯƠNG TRÌNH NÀO CHẠY. "Robotmode: RUNNING" nghĩa là
 *       CÁNH TAY đã sẵn sàng, KHÔNG nghĩa là script đã được biên dịch/chạy.
 *
 *   • PRIMARY/SECONDARY (vai 30001/30002) — khi client nối vào, bộ điều khiển phát ngay
 *     luồng trạng thái nhị phân (gói ROBOT_STATE: uint32 BE độ dài + uint8 kiểu 16); client
 *     gửi một chương trình URScript dạng `def <tên>():` … `end`. Bộ điều khiển BIÊN DỊCH
 *     chương trình: lỗi cú pháp ⇒ KHÔNG chạy (Program running giữ false); hợp lệ và cánh tay
 *     ở RUNNING ⇒ chạy trong `programRunMs`.
 *
 * Bộ kiểm cú pháp ở đây là một bộ đếm khối/ngoặc TỐI GIẢN theo ngữ pháp URScript (mỗi
 * `def/if/while/for/thread/sec … :` đóng bằng `end`; ngoặc (), [] cân bằng) — viết độc lập
 * với transpiler sản phẩm.
 * ════════════════════════════════════════════════════════════════════════════
 */
import net from "node:net";

export interface FakeUrOptions {
  /** Thời gian (ms) một chương trình hợp lệ ở trạng thái chạy. Mặc định 1500. */
  programRunMs?: number;
  /** Khi chương trình bắt đầu chạy, trạng thái an toàn chuyển sang giá trị này (vd "PROTECTIVE_STOP"). */
  safetyOnProgramStart?: string;
  /** Bộ điều khiển đời cũ: KHÔNG hiểu `safetystatus`, chỉ trả lời `safetymode`. */
  legacySafetyOnly?: boolean;
  /** Không hiểu cả `safetystatus` lẫn `safetymode`. */
  noSafetyQuery?: boolean;
  /**
   * Kịch bản trạng thái an toàn theo TỪNG lượt hỏi (`safetystatus`/`safetymode`) KỂ TỪ KHI
   * chương trình bắt đầu chạy — vd ["PROTECTIVE_STOP", "NORMAL"] = sự cố thoáng qua ở lượt
   * hỏi đầu. Hết danh sách ⇒ dùng `safety` hiện hành.
   */
  safetyRepliesAfterStart?: string[];
}

/** Gói trạng thái nhị phân tối thiểu (≥ 79 byte — tài liệu URScript §2 yêu cầu client đọc ≥ 79 byte). */
function robotStatePacket(): Buffer {
  const len = 120;
  const b = Buffer.alloc(len);
  b.writeUInt32BE(len, 0);
  b.writeUInt8(16, 4); // MESSAGE_TYPE_ROBOT_STATE
  return b;
}

const BLOCK_OPENER = /^(def|if|while|for|thread|sec)\b.*:\s*$/;

/** Kết quả biên dịch URScript của bộ điều khiển giả: null = chưa đủ chương trình; boolean = hợp lệ? */
export function fakeCompile(text: string): { complete: boolean; ok: boolean; error?: string } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { complete: false, ok: false };
  if (!/^def\s+[A-Za-z_]\w*\s*\(\s*\)\s*:\s*$/.test(lines[0])) {
    return { complete: true, ok: false, error: "syntax_error_on_line:1 (program must start with def <name>():)" };
  }
  let depth = 0;
  let paren = 0;
  let bracket = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    for (const ch of l) {
      if (ch === "(") paren += 1;
      else if (ch === ")") paren -= 1;
      else if (ch === "[") bracket += 1;
      else if (ch === "]") bracket -= 1;
      if (paren < 0 || bracket < 0) return { complete: true, ok: false, error: `syntax_error_on_line:${i + 1}` };
    }
    if (BLOCK_OPENER.test(l)) depth += 1;
    else if (l === "end") {
      depth -= 1;
      if (depth === 0) {
        const ok = paren === 0 && bracket === 0 && i === lines.length - 1;
        return ok ? { complete: true, ok: true } : { complete: true, ok: false, error: `syntax_error_on_line:${i + 1}` };
      }
    }
  }
  return { complete: false, ok: false };
}

export class FakeUrController {
  robotMode = "POWER_OFF";
  programRunning = false;
  safety = "NORMAL";
  readonly dashboardLog: string[] = [];
  readonly programs: string[] = [];
  readonly compileErrors: string[] = [];
  dashboardPort = 0;
  primaryPort = 0;

  private readonly opts: Required<Pick<FakeUrOptions, "programRunMs">> & FakeUrOptions;
  private dash: net.Server | null = null;
  private prim: net.Server | null = null;
  private readonly sockets = new Set<net.Socket>();
  private readonly timers = new Set<NodeJS.Timeout>();

  constructor(opts: FakeUrOptions = {}) {
    this.opts = { programRunMs: 1500, ...opts, safetyRepliesAfterStart: opts.safetyRepliesAfterStart ? [...opts.safetyRepliesAfterStart] : undefined };
  }

  private safetyNow(): string {
    if (this.programStarted && this.opts.safetyRepliesAfterStart && this.opts.safetyRepliesAfterStart.length > 0) {
      return this.opts.safetyRepliesAfterStart.shift()!;
    }
    return this.safety;
  }

  private programStarted = false;

  private reply(cmd: string): string {
    switch (cmd) {
      case "power on":
        if (this.robotMode === "POWER_OFF") this.robotMode = "IDLE";
        return "Powering on";
      case "brake release":
        if (this.robotMode === "IDLE") this.robotMode = "RUNNING";
        return "Brake releasing";
      case "power off":
        this.robotMode = "POWER_OFF";
        this.programRunning = false;
        return "Powering off";
      case "robotmode":
        return `Robotmode: ${this.robotMode}`;
      case "running":
        return `Program running: ${this.programRunning ? "true" : "false"}`;
      case "programState":
        return `${this.programRunning ? "PLAYING" : "STOPPED"} <unnamed>`;
      case "safetystatus":
        if (this.opts.legacySafetyOnly || this.opts.noSafetyQuery) return `could not understand: '${cmd}'`;
        return `Safetystatus: ${this.safetyNow()}`;
      case "safetymode":
        if (this.opts.noSafetyQuery) return `could not understand: '${cmd}'`;
        return `Safetymode: ${this.safetyNow()}`;
      case "stop":
        this.programRunning = false;
        return "Stopped";
      default:
        return `could not understand: '${cmd}'`;
    }
  }

  private runProgram(text: string): void {
    const res = fakeCompile(text);
    if (!res.ok) {
      this.compileErrors.push(res.error ?? "incomplete program");
      return;
    }
    this.programs.push(text);
    if (this.robotMode !== "RUNNING") {
      this.compileErrors.push("robot not in RUNNING mode — program not started");
      return;
    }
    this.programRunning = true;
    this.programStarted = true;
    if (this.opts.safetyOnProgramStart) this.safety = this.opts.safetyOnProgramStart;
    const t = setTimeout(() => {
      this.timers.delete(t);
      this.programRunning = false;
    }, this.opts.programRunMs);
    this.timers.add(t);
  }

  async start(): Promise<{ dashboardPort: number; primaryPort: number }> {
    const track = (s: net.Socket) => {
      this.sockets.add(s);
      s.on("close", () => this.sockets.delete(s));
      s.on("error", () => { /* client teardown reset — ignore */ });
    };
    this.dash = net.createServer((sock) => {
      track(sock);
      sock.write("Connected: Universal Robots Dashboard Server\n");
      let buf = "";
      sock.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const cmd = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!cmd) continue;
          this.dashboardLog.push(cmd);
          sock.write(this.reply(cmd) + "\n");
        }
      });
    });
    this.prim = net.createServer((sock) => {
      track(sock);
      sock.write(robotStatePacket());
      let text = "";
      let handled = false;
      sock.on("data", (chunk) => {
        if (handled) return;
        text += chunk.toString("utf8");
        const c = fakeCompile(text);
        if (c.complete) {
          handled = true;
          this.runProgram(text);
        }
      });
      sock.on("end", () => {
        if (!handled && text.trim()) {
          handled = true;
          this.runProgram(text); // incomplete ⇒ compile error recorded
        }
      });
    });
    const listen = (srv: net.Server) =>
      new Promise<number>((resolve, reject) => {
        srv.once("error", reject);
        srv.listen(0, "127.0.0.1", () => resolve((srv.address() as net.AddressInfo).port));
      });
    this.dashboardPort = await listen(this.dash);
    this.primaryPort = await listen(this.prim);
    return { dashboardPort: this.dashboardPort, primaryPort: this.primaryPort };
  }

  async close(): Promise<void> {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const s of this.sockets) s.destroy();
    const closeSrv = (srv: net.Server | null) =>
      new Promise<void>((r) => (srv ? srv.close(() => r()) : r()));
    await Promise.all([closeSrv(this.dash), closeSrv(this.prim)]);
  }
}
