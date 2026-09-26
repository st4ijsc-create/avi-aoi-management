/**
 * ★★ 2026-08-18 — Nhóm B #5. Lưới CẤU TRÚC cho `commandCenterScope` (không chạm CSDL).
 *
 * Bổ sung cho `routers/commandCenterAlertScope.db.test.ts` (lưới HÀNH VI, chạm CSDL thật).
 * Hai lưới canh hai thứ khác nhau và cố ý KHÔNG thay thế được cho nhau:
 *   • lưới CSDL nói "người A không thấy hàng của B" — nhưng nó chỉ nói được về DỮ LIỆU
 *     có mặt lúc chạy;
 *   • lưới này nói về HÌNH DẠNG vị từ — tập rỗng phải thành `1 = 0` TƯỜNG MINH, và câu
 *     rỗng phải không chứa cụm gây hiểu sai — hai điều đúng cho MỌI dữ liệu, kể cả bảng
 *     rỗng (lúc đó lưới CSDL xanh mà chẳng chứng minh được gì).
 */
import { describe, it, expect } from "vitest";
import {
  andonFactoryGate,
  safetyFactoryGate,
  predictiveAlertFactoryGate,
  wipFactoryGate,
  robotFactoryGate,
  taskFactoryGate,
  machineIdFactoryGate,
  NO_FACTORY_ASSIGNMENT_ALERTS_MESSAGE,
  NO_FACTORY_ASSIGNMENT_KPI_MESSAGE,
} from "./commandCenterScope";
import { oeeMetrics } from "../../../drizzle/schema";

/** Kết xuất vị từ thành SQL text để soi hình dạng (cùng cách drizzle dựng câu thật). */
async function renderSql(node: unknown): Promise<string> {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  return new PgDialect().sqlToQuery(node as never).sql;
}

describe("commandCenterScope — hình dạng vị từ (fail-closed theo cấu tạo)", () => {
  const gates = {
    andon: andonFactoryGate,
    safety: safetyFactoryGate,
    predictive: predictiveAlertFactoryGate,
    // ★ 2026-08-18 — bốn ô CÒN LẠI của dải KPI đi qua ĐÚNG BỘ LUẬT NÀY, không phải một bản
    //   chép. Chúng nằm trong cùng vòng lặp để ba tính chất (tập rỗng ⇒ `1 = 0`; không
    //   `= ANY(mảng)`; không bí danh bảng) được canh cho MỌI cổng — thêm cổng thứ tám mà
    //   quên ba tính chất ấy thì lưới đỏ ngay, không phải nhớ bằng quy ước.
    wip: wipFactoryGate,
    robot: robotFactoryGate,
    task: taskFactoryGate,
    oeeMetricMachine: (ids: number[]) => machineIdFactoryGate(oeeMetrics.machineId, ids),
  };

  for (const [name, gate] of Object.entries(gates)) {
    it(`${name}: TẬP RỖNG ⇒ vị từ chứa \`1 = 0\` TƯỜNG MINH, KHÔNG bao giờ là "không lọc"`, async () => {
      const text = await renderSql(gate([]));
      expect(text).toContain("1 = 0");
      // Không được có tham số nào bị bỏ trống thành NULL/undefined — đó là cách một tập
      // rỗng lặng lẽ biến thành một vị từ luôn ĐÚNG.
      expect(text).not.toMatch(/\bundefined\b/);
    });

    it(`${name}: tập KHÔNG rỗng ⇒ mỗi id thành một tham số ràng buộc riêng (không \`= ANY(mảng)\` — đường đó cho \`42809\`)`, async () => {
      const text = await renderSql(gate([7, 9]));
      expect(text).not.toContain("1 = 0");
      expect(text).not.toMatch(/=\s*ANY/i);
      expect(text).toMatch(/\bIN\s*\(/i);
      // Hai id ⇒ hai chỗ giữ tham số riêng bên trong vị từ `factoryIdGate`.
      expect(text).toMatch(/"factoryId"\s+IN\s*\(\s*\$\d+\s*,\s*\$\d+\s*\)/i);
    });

    it(`${name}: truy vấn phụ KHÔNG đặt bí danh bảng (bí danh ⇒ \`42P01\`, đã cắn tuần này)`, async () => {
      const text = await renderSql(gate([7]));
      // Drizzle kết xuất cột theo TÊN BẢNG; một `from "x" alias` sẽ làm cột không phân giải được.
      expect(text).toMatch(/from\s+"production_lines"\s+inner join/i);
      expect(text).not.toMatch(/"production_lines"\s+(?!inner|where|\)|$)[a-z]/i);
    });
  }

  it("andon: nối bằng CẢ BA cột liên kết (line · station · machine) — thiếu một đường là chặn nhầm hàng hợp lệ", async () => {
    const text = await renderSql(andonFactoryGate([1]));
    expect(text).toContain('"andon_events"."lineId"');
    expect(text).toContain('"andon_events"."stationId"');
    expect(text).toContain('"andon_events"."machineId"');
  });

  it("safety/predictive: cột `factoryId` của HÀNG chỉ được dùng khi KHÔNG còn liên kết nào (một ô ghi rời không được ghi đè liên kết)", async () => {
    const s = await renderSql(safetyFactoryGate([1]));
    expect(s).toMatch(/"safety_events"\."lineId" is null/i);
    expect(s).toMatch(/"safety_events"\."stationId" is null/i);
    const p = await renderSql(predictiveAlertFactoryGate([1]));
    expect(p).toMatch(/"predictive_alerts"\."machineId" is null/i);
  });

  it("wip: nối bằng CẢ BA cột liên kết (line · station · máy hiện tại) và KHÔNG có cột tenant nào để lùi về", async () => {
    const text = await renderSql(wipFactoryGate([1]));
    expect(text).toContain('"wip_tracking"."lineId"');
    expect(text).toContain('"wip_tracking"."currentStationId"');
    expect(text).toContain('"wip_tracking"."currentMachineId"');
    // `wip_tracking` KHÔNG có cột `factoryId`/`corporateCode` — nếu một ngày có ai thêm vào
    // và cổng này lùi về đọc nó, đây là chỗ đỏ trước.
    expect(text).not.toMatch(/"wip_tracking"\."factoryId"/i);
  });

  it("robot: nối bằng line + station; KHÔNG có lối lùi (bảng `robots` không mang cột tenant)", async () => {
    const text = await renderSql(robotFactoryGate([1]));
    expect(text).toContain('"robots"."lineId"');
    expect(text).toContain('"robots"."stationId"');
    expect(text).not.toMatch(/"robots"\."factoryId"/i);
  });

  it("task: ƯU TIÊN liên kết (robot ⇒ lệnh sản xuất) rồi mới tới cột `factoryId` GHI RỜI, và lối lùi ấy chỉ mở khi CẢ HAI liên kết đều NULL", async () => {
    const text = await renderSql(taskFactoryGate([1]));
    expect(text).toContain('"tasks"."assignedDeviceId"');
    expect(text).toContain('"tasks"."sourceWorkOrderId"');
    expect(text).toContain('"robots"."id"');
    expect(text).toContain('"production_orders"."id"');
    // Lối lùi phải bị rào bằng HAI vế IS NULL — nếu không, một hàng có robot của nhà máy B
    // nhưng `factoryId` ghi nhầm thành A sẽ lọt sang A (đúng lớp lỗi `daily_statistics`).
    expect(text).toMatch(/"tasks"\."assignedDeviceId" is null[\s\S]*"tasks"\."sourceWorkOrderId" is null[\s\S]*"tasks"\."factoryId" is not null/i);
    // Lệnh sản xuất được phân giải qua `lineId` (liên kết thật), KHÔNG qua cột `factoryId` rời.
    expect(text).toContain('"production_orders"."lineId"');
    expect(text).not.toMatch(/"production_orders"\."factoryId"/i);
  });

  it("machineIdFactoryGate: chiếu cột `machineId` của một bảng BẤT KỲ (ở đây `oee_metrics`) xuống máy → trạm → tuyến → nhà máy", async () => {
    const text = await renderSql(machineIdFactoryGate(oeeMetrics.machineId, [1]));
    expect(text).toContain('"oee_metrics"."machineId"');
    expect(text).toContain('"machines"."stationId"');
  });
});

describe("commandCenterScope — câu rỗng TRUNG THỰC", () => {
  it("nói ĐÚNG lý do (chưa được gán nhà máy)", () => {
    expect(NO_FACTORY_ASSIGNMENT_ALERTS_MESSAGE).toContain("chưa được gán nhà máy");
    expect(NO_FACTORY_ASSIGNMENT_ALERTS_MESSAGE).toContain("quản trị viên");
  });

  it("KHÔNG chứa cụm gây hiểu sai — kể cả trong vế PHỦ ĐỊNH", () => {
    // Người vận hành đọc lướt chỉ bắt được CỤM TỪ, không bắt được vế phủ định. Trên màn
    // hình báo động, "không có cảnh báo nào" đọng lại thành "đang yên ổn" — một lời khai
    // sai về thế giới ở đúng chỗ nguy hiểm nhất.
    expect(NO_FACTORY_ASSIGNMENT_ALERTS_MESSAGE).not.toMatch(/không có cảnh báo/i);
    expect(NO_FACTORY_ASSIGNMENT_ALERTS_MESSAGE).not.toMatch(/không có báo động/i);
    expect(NO_FACTORY_ASSIGNMENT_ALERTS_MESSAGE).not.toMatch(/không có dữ liệu/i);
  });

  it("★ câu của DẢI KPI nói về CẢ DẢI, không chỉ về danh sách báo động", () => {
    // Câu của họ báo động ("danh sách báo động trống") giờ đã HẸP hơn sự thật: dải KPI có
    // năm ô bị thu hẹp (oee · wip · alarms · fleet · sites). Dùng lại câu ấy trên dải KPI
    // là khai thiếu — người đọc sẽ hiểu OEE 0% và WIP 0 là số ĐO ĐƯỢC.
    expect(NO_FACTORY_ASSIGNMENT_KPI_MESSAGE).toContain("chưa được gán nhà máy");
    expect(NO_FACTORY_ASSIGNMENT_KPI_MESSAGE).toContain("quản trị viên");
    expect(NO_FACTORY_ASSIGNMENT_KPI_MESSAGE).toMatch(/toàn số 0|đều bằng 0|toàn 0/i);
    expect(NO_FACTORY_ASSIGNMENT_KPI_MESSAGE).not.toBe(NO_FACTORY_ASSIGNMENT_ALERTS_MESSAGE);
  });

  it("★ câu DẢI KPI cũng KHÔNG được chứa cụm gây hiểu sai — một dải toàn 0 đọc thành 'xưởng đang yên ổn'", () => {
    expect(NO_FACTORY_ASSIGNMENT_KPI_MESSAGE).not.toMatch(/không có dữ liệu/i);
    expect(NO_FACTORY_ASSIGNMENT_KPI_MESSAGE).not.toMatch(/không có cảnh báo/i);
    expect(NO_FACTORY_ASSIGNMENT_KPI_MESSAGE).not.toMatch(/không có báo động/i);
    expect(NO_FACTORY_ASSIGNMENT_KPI_MESSAGE).not.toMatch(/yên ổn|bình thường/i);
  });
});
