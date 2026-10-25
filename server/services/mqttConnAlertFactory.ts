import { sql } from "drizzle-orm";
import { mqttConnectionAlerts } from "../../drizzle/schema";

/**
 * Nhà máy của một cảnh báo kết nối MQTT: suy từ mục tiêu của nó (factory → chính id; station / machine → qua chuỗi trạm → chuyền → xưởng → nhà máy); không rõ ⇒ NULL.
 * (W16, mig 0425) Dùng để áp quy tắc leo thang THEO NHÀ MÁY: cảnh báo lịch sử `mqtt_alert_history` không mang mục tiêu nào ⇒ chỉ quy tắc NULL (mặc định toàn tập đoàn) áp cho nó.
 */
export const NHA_MAY_CUA_CANH_BAO_KET_NOI = sql<number | null>`(CASE ${mqttConnectionAlerts.targetType}::text
  WHEN 'factory' THEN ${mqttConnectionAlerts.targetId}
  WHEN 'station' THEN (SELECT w."factoryId" FROM stations s JOIN production_lines l ON l.id = s."lineId" JOIN workshops w ON w.id = l."workshopId" WHERE s.id = ${mqttConnectionAlerts.targetId})
  WHEN 'machine' THEN (SELECT w."factoryId" FROM machines m JOIN stations s ON s.id = m."stationId" JOIN production_lines l ON l.id = s."lineId" JOIN workshops w ON w.id = l."workshopId" WHERE m.id = ${mqttConnectionAlerts.targetId})
  ELSE NULL END)`;

