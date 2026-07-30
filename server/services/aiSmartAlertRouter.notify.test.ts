/**
 * Sprint 5 §2 — routeAlert phải TÁCH "ghi nhật ký" (luôn đủ) khỏi "gửi thông
 * báo" (được phép gộp). Trước đây thông báo gửi ở Step 4, TRƯỚC cả quyết định
 * insert/update ⇒ máy tái diễn 22 lần/ngày vẫn tới 22 lượt push dù bảng cảnh
 * báo chỉ còn 1 dòng.
 *
 * Mock dùng lại đúng khuôn aiSmartAlertRouter.occurrence.test.ts (Wave 4), thêm
 * nhánh `users` seed được (determineTargets) — bản cũ luôn trả rỗng nên không
 * test nào chạy qua đường gửi thật.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { predictiveAlerts, machines, predictiveAlertOccurrences, users } from "../../drizzle/schema";

const calls: { kind: "insert" | "update" | "insert-occurrence"; payload?: any }[] = [];
const notified: { userId: number }[] = [];

let seedOpenAlertRows: any[] = [];
let seedUserRows: any[] = [];
let patternQueried = false;
// I-1 (vòng sửa cuối) — cho checkPatterns() (db.execute) NÉM lỗi thật, để test chạm
// đúng đường I/O không bọc giữa quyết-định và đường-ghi.
let patternExecuteThrows = false;
// Finding 1 (review round 1) — driver THẬT ném lỗi ở đúng điểm await cuối chuỗi
// (.returning() thật thi hành query). Không push vào `calls` khi hỏng — dòng
// chưa từng thực sự được ghi, giữ đúng quy ước đã dùng cho occurrence ở
// aiSmartAlertRouter.occurrence.test.ts (case "ghi nhật ký NÉM LỖI").
let alertInsertThrows = false;
// Sprint 5 debt E3 — cho sendAlertNotification (kênh in-app) NÉM lỗi thật, để
// khẳng định routeAlert() KHÔNG đóng dấu notificationSentAt khi gửi thất bại
// (trước đây dấu đóng ngay trong khối ghi, TRƯỚC cả lượt gửi — không cách nào
// biết gửi có thành công hay không).
let sendAlertNotificationThrows = false;
// Review round 1, Minor-3 (nâng lên) — notificationService.sendNotification()
// trả `null` một cách HỢP LỆ (không ném) khi người dùng tắt in-app hoặc đang
// trong giờ yên lặng. Cờ này mô phỏng ĐÚNG hình dạng đó (khác với
// sendAlertNotificationThrows — throw là lỗi kỹ thuật, còn đây là "gửi có chủ
// đích không tới ai").
let sendAlertNotificationReturnsNull = false;

function chain(getRows: () => any[]) {
  const node: any = {
    where: () => node,
    orderBy: () => node,
    limit: async () => getRows(),
    then: (resolve: any, reject: any) => Promise.resolve(getRows()).then(resolve, reject),
    catch: (reject: any) => Promise.resolve(getRows()).catch(reject),
  };
  return node;
}

vi.mock("../db/connection", () => ({
  getDb: async () => ({
    select: (_cols?: any) => ({
      from: (table: any) => {
        if (table === predictiveAlerts) return chain(() => seedOpenAlertRows);
        if (table === machines) return chain(() => [{ code: "M-01" }]);
        if (table === users) return chain(() => seedUserRows);
        return chain(() => []);
      },
    }),
    insert: (table: any) => {
      if (table === predictiveAlertOccurrences) {
        return {
          values: (v: any) => {
            calls.push({ kind: "insert-occurrence", payload: v });
            return Promise.resolve(undefined);
          },
        };
      }
      return {
        values: (v: any) => {
          // Finding 1 — hỏng ở .returning(), điểm await thật của drizzle
          // postgres-js. KHÔNG push vào `calls`: dòng chưa từng ghi được.
          if (alertInsertThrows) {
            return { returning: async () => { throw new Error("ghi predictive_alerts (INSERT) LỖI (giả lập Postgres hỏng)"); } };
          }
          calls.push({ kind: "insert", payload: v });
          return { returning: async () => [{ id: 1 }] };
        },
      };
    },
    update: (_table: any) => ({
      set: (v: any) => {
        calls.push({ kind: "update", payload: v });
        return { where: (_cond: any) => Promise.resolve(undefined) };
      },
    }),
    // checkPatterns() gọi db.execute — dùng để khẳng định nó KHÔNG chạy khi im lặng.
    execute: async (_q: any) => {
      patternQueried = true;
      if (patternExecuteThrows) {
        throw new Error("truy vấn pattern 30 ngày LỖI (giả lập Postgres time-out tải cao)");
      }
      return { rows: [] };
    },
  }),
}));

const generateText = vi.fn(async () => ({ text: "" }));
vi.mock("./aiGgufEngine", () => ({
  generateText,
  isGgufAvailable: vi.fn(async () => false),
}));
vi.mock("./notificationService", () => ({
  sendAlertNotification: vi.fn(async (userId: number) => {
    if (sendAlertNotificationThrows) {
      throw new Error("gửi thông báo in-app LỖI (giả lập kênh push hỏng)");
    }
    if (sendAlertNotificationReturnsNull) {
      // Review round 1, Minor-3 — "im lặng CÓ CHỦ ĐÍCH" (tắt in-app / giờ yên
      // lặng): sendNotification() thật trả null, KHÔNG ném. KHÔNG push vào
      // `notified` — không ai thật sự nhận được thông báo này.
      return null;
    }
    notified.push({ userId });
    // Mô phỏng bản ghi notification THẬT (createNotification trả về, có id) —
    // sendSmartNotification() giờ kiểm `result != null`, không chỉ "không ném".
    return { id: notified.length };
  }),
}));
vi.mock("./emailService", () => ({ sendAlertEmail: vi.fn(async () => undefined) }));

beforeEach(() => {
  calls.length = 0;
  notified.length = 0;
  seedOpenAlertRows = [];
  seedUserRows = [];
  patternQueried = false;
  patternExecuteThrows = false;
  alertInsertThrows = false;
  sendAlertNotificationThrows = false;
  sendAlertNotificationReturnsNull = false;
  generateText.mockClear();
  process.env.ALERT_RENOTIFY_COOLDOWN_MINUTES = "240";
  process.env.ALERT_RENOTIFY_COOLDOWN_CRITICAL_MINUTES = "0";
});
afterEach(() => {
  delete process.env.ALERT_RENOTIFY_COOLDOWN_MINUTES;
  delete process.env.ALERT_RENOTIFY_COOLDOWN_CRITICAL_MINUTES;
});

const MAINTENANCE = [{ userId: 7, username: "kt1", role: "maintenance", email: null }];

describe("routeAlert — tách gửi thông báo khỏi ghi nhật ký", () => {
  // Sprint 5 debt E3 (cập nhật assertion — KHÔNG phải nới lỏng) — bài test này
  // trước đây khẳng định đúng cái BUG đang sửa: dòng INSERT tự stamp
  // notificationSent=true/notificationSentAt=Date NGAY LÚC GHI, tức TRƯỚC cả
  // lượt gửi thật (:517 trở đi trong code). Tiến trình chết giữa hai việc đó
  // để lại một cảnh báo "đã báo" giả. Nay INSERT phải ghi CHƯA GỬI (false/null)
  // — dấu thật chỉ xuất hiện ở một UPDATE riêng SAU khi gửi xong.
  it("cảnh báo MỚI ⇒ gửi thông báo, INSERT ghi CHƯA GỬI, UPDATE riêng SAU đó mới stamp", async () => {
    seedUserRows = MAINTENANCE;
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({ type: "MACHINE_FAILURE", machineId: 8101, severity: "HIGH", message: "x", data: {} } as any);

    expect(notified).toHaveLength(1);
    const ins = calls.find((c) => c.kind === "insert")!;
    expect(ins.payload.notificationSent).toBe(false);      // chưa biết lúc ghi — đúng ý (debt E3)
    expect(ins.payload.notificationSentAt).toBeNull();
    const stampUpd = calls.find((c) => c.kind === "update")!; // UPDATE riêng, SAU khi gửi xong
    expect(stampUpd.payload.notificationSent).toBe(true);
    expect(stampUpd.payload.notificationSentAt).toBeInstanceOf(Date);
  });

  it("tái diễn trong cooldown, mức KHÔNG đổi ⇒ IM LẶNG nhưng VẪN ghi nhật ký", async () => {
    seedUserRows = MAINTENANCE;
    seedOpenAlertRows = [{
      id: 55, severity: "HIGH", occurrenceCount: 3,
      notificationSentAt: new Date(Date.now() - 5 * 60_000), // báo 5 phút trước
    }];
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({ type: "MACHINE_FAILURE", machineId: 8102, severity: "HIGH", message: "x", data: {} } as any);

    expect(notified).toHaveLength(0);                                   // KHÔNG làm phiền
    expect(calls.some((c) => c.kind === "insert-occurrence")).toBe(true); // NHƯNG vẫn ghi sổ
    const upd = calls.find((c) => c.kind === "update")!;
    expect(upd.payload.occurrenceCount).toBe(4);
    expect(upd.payload.notificationSentAt).toBeUndefined();              // không stamp lượt không gửi
    expect(upd.payload.aiAnalysis).toBeUndefined();                      // không đè lý giải cũ
  });

  it("im lặng ⇒ KHÔNG gọi LLM và KHÔNG chạy truy vấn pattern 30 ngày", async () => {
    seedUserRows = MAINTENANCE;
    seedOpenAlertRows = [{ id: 56, severity: "HIGH", occurrenceCount: 1, notificationSentAt: new Date() }];
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({ type: "MACHINE_FAILURE", machineId: 8103, severity: "HIGH", message: "x", data: {} } as any);

    expect(generateText).not.toHaveBeenCalled();
    expect(patternQueried).toBe(false);
  });

  // Sprint 5 debt E3 (cập nhật assertion — KHÔNG phải nới lỏng) — trước đây
  // `calls.find(kind==="update")` (lấy call ĐẦU TIÊN) trúng ngay khối ghi
  // chính (bump occurrenceCount) vì stamp từng nằm CHUNG khối đó. Nay stamp bị
  // TÁCH sang một UPDATE riêng chạy SAU lượt gửi ⇒ có 2 lệnh update: cái ĐẦU là
  // khối ghi chính (không còn field stamp), cái SAU mới là stamp thật.
  it("mức TĂNG (HIGH → CRITICAL) ⇒ báo ngay dù còn trong cooldown", async () => {
    seedUserRows = MAINTENANCE;
    seedOpenAlertRows = [{ id: 57, severity: "HIGH", occurrenceCount: 1, notificationSentAt: new Date() }];
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({ type: "MACHINE_FAILURE", machineId: 8104, severity: "CRITICAL", message: "x", data: {} } as any);

    expect(notified).toHaveLength(1);
    const updates = calls.filter((c) => c.kind === "update");
    expect(updates[0].payload.notificationSentAt).toBeUndefined(); // khối ghi chính không còn stamp (debt E3)
    expect(updates[1].payload.notificationSentAt).toBeInstanceOf(Date); // UPDATE riêng SAU khi gửi xong
    expect(updates[1].payload.notificationSent).toBe(true);
  });

  it("không có người nhận (targets rỗng) ⇒ KHÔNG stamp — nếu không cảnh báo im 4 giờ vì một lượt gửi không tồn tại", async () => {
    seedUserRows = [];
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({ type: "MACHINE_FAILURE", machineId: 8105, severity: "HIGH", message: "x", data: {} } as any);

    const ins = calls.find((c) => c.kind === "insert")!;
    expect(ins.payload.notificationSent).toBe(false);
    expect(ins.payload.notificationSentAt).toBeNull();
  });

  // Sprint 5 debt E3 — test chốt lõi của mục sửa: gửi thất bại thật (mock ném
  // lỗi ở sendAlertNotification, kênh in-app) KHÔNG được phép biến thành "đã
  // báo" giả. MAINTENANCE có email:null nên không có kênh email dự phòng —
  // allDelivered chắc chắn false, không mập mờ với khả năng email cứu vãn.
  it("gửi thông báo THẤT BẠI (sendAlertNotification ném lỗi) ⇒ KHÔNG stamp — còn cơ hội thử lại", async () => {
    seedUserRows = MAINTENANCE;
    sendAlertNotificationThrows = true;
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({ type: "MACHINE_FAILURE", machineId: 8109, severity: "HIGH", message: "x", data: {} } as any);

    // Dòng cảnh báo vẫn được ghi (KHÔNG mất cảnh báo)...
    const ins = calls.find((c) => c.kind === "insert")!;
    expect(ins.payload.notificationSent).toBe(false);
    expect(ins.payload.notificationSentAt).toBeNull();
    // ...nhưng KHÔNG có UPDATE stamp nào chạy tiếp theo — gửi thất bại thật.
    expect(calls.some((c) => c.kind === "update")).toBe(false);
  });

  // Review round 1, Minor-3 (nâng lên) — sendAlertNotification() KHÔNG NÉM khi
  // người nhận tắt in-app hoặc đang trong giờ yên lặng: nó trả `null` một
  // cách HỢP LỆ (notificationService.ts). `delivered = !threw` cũ sẽ coi đây
  // là "đã gửi" dù không ai thật sự nhận được gì ⇒ đúng bug E3, chỉ ở tầng
  // khác. MAINTENANCE có email:null nên không có kênh dự phòng nào cứu vãn.
  it("người nhận đang trong giờ yên lặng (sendAlertNotification trả null, KHÔNG ném) ⇒ KHÔNG stamp", async () => {
    seedUserRows = MAINTENANCE;
    sendAlertNotificationReturnsNull = true;
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({ type: "MACHINE_FAILURE", machineId: 8110, severity: "HIGH", message: "x", data: {} } as any);

    expect(notified).toHaveLength(0); // không ai thật sự nhận được thông báo
    const ins = calls.find((c) => c.kind === "insert")!;
    expect(ins.payload.notificationSent).toBe(false);
    expect(ins.payload.notificationSentAt).toBeNull();
    // KHÔNG có UPDATE stamp nào chạy tiếp theo — "gửi" không ném lỗi nhưng
    // cũng không tới tay ai, không được phép đóng dấu "đã báo".
    expect(calls.some((c) => c.kind === "update")).toBe(false);
  });

  // Review round 1, Finding 1 — §2.6(2): sau khi đảo trật tự, thông báo gửi
  // SAU khi ghi. Nếu GHI predictive_alerts hỏng, try/catch fail-open (:369-380)
  // là tuyến duy nhất giữ máy sắp hỏng không bị im lặng. Trước đây (thông báo
  // gửi TRƯỚC ghi) lỗi ghi vô hại với người nhận; nay nếu try/catch này bị gỡ,
  // routeAlert() sẽ NÉM ra ngoài và không ai được báo — chỉ tsc/mắt người canh,
  // không có test nào. Test này lấp đúng khoảng trống đó.
  it("GHI predictive_alerts (INSERT) hỏng ⇒ fail-open: KHÔNG ném ra ngoài, VẪN gửi thông báo", async () => {
    seedUserRows = MAINTENANCE;
    alertInsertThrows = true;
    const { routeAlert } = await import("./aiSmartAlertRouter");

    await expect(
      routeAlert({ type: "MACHINE_FAILURE", machineId: 8106, severity: "HIGH", message: "x", data: {} } as any),
    ).resolves.toBeTruthy();

    expect(notified).toHaveLength(1); // vẫn báo dù dòng cảnh báo chưa từng được ghi
    expect(calls.some((c) => c.kind === "insert")).toBe(false); // ghi hỏng ⇒ không có gì được ghi thật
    // Không có alertRecord.id để nối vào ⇒ buildOccurrence trả null, không INSERT
    // nhật ký occurrence (đúng ý — không phải bỏ sót, không có gì để nối vào).
    expect(calls.some((c) => c.kind === "insert-occurrence")).toBe(false);
  });

  // Review round 1, Finding 2 — nhánh insert đã có test "targets rỗng ⇒ không
  // stamp"; nhánh UPDATE thì chưa. Tổ hợp có thật: cảnh báo CRITICAL tái diễn
  // trên một dòng đang mở (⇒ notifyDecision.notify = true, xuyên cooldown)
  // nhưng nhà máy CHƯA cấu hình role `maintenance` (⇒ targets = [], willStamp
  // = false). `...(willStamp ? {...} : {})` phải bỏ hẳn hai trường khỏi SET.
  it("UPDATE + notify=true (CRITICAL xuyên cooldown) + targets rỗng ⇒ KHÔNG stamp", async () => {
    seedUserRows = [];
    seedOpenAlertRows = [{
      id: 58, severity: "HIGH", occurrenceCount: 2,
      notificationSentAt: new Date(), // vừa báo — nếu không phải CRITICAL sẽ bị cooldown chặn
    }];
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({ type: "MACHINE_FAILURE", machineId: 8107, severity: "CRITICAL", message: "x", data: {} } as any);

    expect(notified).toHaveLength(0); // không có ai để gửi thật
    const upd = calls.find((c) => c.kind === "update")!;
    expect(upd).toBeTruthy();
    expect(upd.payload.notificationSentAt).toBeUndefined();
    expect(upd.payload.notificationSent).toBeUndefined();
  });

  // Vòng sửa cuối, I-1 — `determineTargets`/`checkPatterns` (:270-271) là I/O DB
  // KHÔNG bọc lỗi, nằm GIỮA quyết-định và đường-ghi. checkPatterns chạy GROUP BY
  // 30 ngày trên predictive_alerts — dễ time-out nhất trong hàm, đúng lúc tải cao
  // là đúng lúc KPI cần đếm nhất. Trước khi sửa: lỗi ở đây ném thẳng ra ngoài
  // routeAlert() ⇒ KHÔNG dòng cảnh báo, KHÔNG dòng nhật ký, KPI mất một lần, không
  // dấu vết — đúng luận điểm cốt lõi của sprint bị thủng ngay tại đây.
  it("checkPatterns (truy vấn pattern 30 ngày) NÉM lỗi ⇒ fail-open: KHÔNG ném ra ngoài, VẪN ghi cảnh báo + nhật ký", async () => {
    seedUserRows = MAINTENANCE;
    patternExecuteThrows = true;
    const { routeAlert } = await import("./aiSmartAlertRouter");

    await expect(
      routeAlert({ type: "MACHINE_FAILURE", machineId: 8108, severity: "HIGH", message: "x", data: {} } as any),
    ).resolves.toBeTruthy();

    expect(calls.some((c) => c.kind === "insert")).toBe(true); // dòng cảnh báo vẫn được ghi
    expect(calls.some((c) => c.kind === "insert-occurrence")).toBe(true); // nhật ký lần-tái-diễn vẫn được ghi
  });
});

// Sprint 5 debt E2 — cảnh báo KHÔNG gắn máy (vd YIELD_DROP cấp nhà máy) là nhóm
// DUY NHẤT còn đứng ngoài cooldown: routeAlert chỉ tra cảnh báo đang mở khi có
// machineId (:212), nên decideAlertWrite() luôn trả action="insert" cho nhóm này
// — MỌI lượt gọi, không riêng lượt đầu — và luật #1 của decideNotify
// (action==="insert" ⇒ báo NGAY) khiến nhóm này báo ở MỌI lượt, không chỉ lượt đầu.
// alertEvaluatorScheduler chạy mỗi 2 phút ⇒ một nhà máy tụt yield cả ngày bắn
// ~30 thông báo/giờ cho mọi quality_inspector.
//
// Test này viết TRƯỚC khi sửa (đỏ trước): nếu KHÔNG có cooldown, lần gọi thứ hai
// (ngay sau lần đầu, cùng cooldown 4h mặc định) vẫn phải báo — assertion
// `expect(notified).toHaveLength(0)` ở dưới SẼ THẤT BẠI trên mã hiện tại.
describe("routeAlert — cooldown cho cảnh báo KHÔNG gắn máy (E2, cấp nhà máy)", () => {
  it("YIELD_DROP chỉ có factoryId: gọi 2 lần liên tiếp trong cooldown ⇒ lần 2 IM LẶNG, nhưng vẫn ghi nhật ký occurrence", async () => {
    seedUserRows = MAINTENANCE; // chỉ cần có người nhận, mock không lọc theo role thật
    const { routeAlert } = await import("./aiSmartAlertRouter");
    const event = { type: "YIELD_DROP", factoryId: 9301, severity: "HIGH", message: "yield drop", data: {} } as any;

    await routeAlert(event);
    expect(notified).toHaveLength(1); // lần đầu: chưa từng báo ⇒ luôn báo (fail-open)

    notified.length = 0; // đo riêng lần 2, không cộng dồn với lần 1
    await routeAlert(event);

    // ⚠ Đây chính là luật #1 của decideNotify (action==="insert" ⇒ báo) không được
    // phép ghi đè cooldown cho nhóm không-máy: nếu code chỉ truyền thêm
    // lastNotifiedAt mà không đổi `action`, luật #1 vẫn thắng và assertion dưới đây
    // sẽ đỏ (notified vẫn có 1 phần tử).
    expect(notified).toHaveLength(0); // lần 2 trong cooldown ⇒ KHÔNG làm phiền quality_inspector
    expect(calls.filter((c) => c.kind === "insert-occurrence")).toHaveLength(2); // NHƯNG cả 2 lần đều được ghi sổ
  });

  it("YIELD_DROP CRITICAL không gắn máy: gọi 2 lần liên tiếp ⇒ báo CẢ HAI lần (CRITICAL xuyên cooldown)", async () => {
    seedUserRows = MAINTENANCE;
    const { routeAlert } = await import("./aiSmartAlertRouter");
    const event = { type: "YIELD_DROP", factoryId: 9302, severity: "CRITICAL", message: "yield drop nặng", data: {} } as any;

    await routeAlert(event);
    expect(notified).toHaveLength(1);

    notified.length = 0;
    await routeAlert(event);

    // Hệ quả tự nhiên của nhóm không-máy: không có "mức trước" để so (existingOpen
    // luôn null), nên luật "mức tăng" (severity-raised) không bao giờ áp dụng được
    // ở đây — CHỈ CRITICAL mới xuyên qua được cooldown cấp nhà máy.
    expect(notified).toHaveLength(1); // CRITICAL (cooldown-critical mặc định=0) ⇒ báo lại ngay
  });

  it("đã hết cooldown 4h (mốc gửi cũ nằm sẵn trong Redis) ⇒ báo lại", async () => {
    // Bạch hộp có chủ ý: brief chốt đúng khoá `smartalert:lastnotify:${consolidationKey}`
    // (redisService THẬT, không mock — fallback bộ nhớ vì test không có REDIS_URL).
    // Seed thẳng một mốc gửi 5h trước (> cooldown 4h mặc định) để không phải chờ
    // thời gian thật trôi qua.
    const { redisService } = await import("./redisService");
    await redisService.set(
      "smartalert:lastnotify:YIELD_DROP:all:9303",
      { timestamp: Date.now() - 5 * 3600_000 },
      8 * 3600,
    );
    seedUserRows = MAINTENANCE;
    const { routeAlert } = await import("./aiSmartAlertRouter");
    await routeAlert({ type: "YIELD_DROP", factoryId: 9303, severity: "HIGH", message: "x", data: {} } as any);

    expect(notified).toHaveLength(1); // đã hết cooldown ⇒ báo lại, không bị kẹt im lặng vĩnh viễn
  });
});
