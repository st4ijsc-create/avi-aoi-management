// scripts/seed-alert-rules.mjs — Doc 54 §11 P1.3: seed default MQTT/connectivity ALERT RULES.
//
// The alert evaluator (server/services/alertEvaluationService.ts, run by
// alertEvaluatorScheduler) reads mqtt_alert_rules WHERE isEnabled=true and fires
// notifications. Out-of-box the table has 0 rows → the evaluator loops over nothing
// and connectivity/broker problems go silent (only the manual "test" path ever fired).
// This seeds a realistic default rule-set so GĐ1 monitoring actually alerts.
//
// Transports: notifyOwner=true (in-app WS/owner inbox — always available). notifyEmail
// and notifyMqtt default FALSE here because SMTP/external-MQTT are unset out-of-box;
// an operator flips them per-rule once those transports are configured (P1.3 follow-up).
//
// IDEMPOTENCY: existence-checked by rule `name`. Re-runs insert nothing new and DO NOT
// overwrite operator edits (thresholds/enable-state are left as-is once a rule exists).
//
// Run:  node scripts/seed-alert-rules.mjs
import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const log = (...a) => console.log('[seed-alert-rules]', ...a);

// ruleType ∈ LATENCY_THRESHOLD | BROKER_DISCONNECT | MESSAGE_FAILURE_RATE |
//           THROUGHPUT_LOW | THROUGHPUT_HIGH | CLIENT_OFFLINE   (see ruleTypeEnum)
// comparisonOperator ∈ GT | GTE | LT | LTE | EQ
const RULES = [
  {
    name: 'Độ trễ MQTT cao',
    description: 'Độ trễ trung bình phân phối message vượt ngưỡng — nghi nghẽn broker/mạng.',
    ruleType: 'LATENCY_THRESHOLD',
    thresholdValue: '1000.00', thresholdUnit: 'ms', comparisonOperator: 'GT',
    timeWindowMinutes: 5, cooldownMinutes: 15,
  },
  {
    name: 'Tỷ lệ message thất bại cao',
    description: 'Tỷ lệ message FAILED vượt ngưỡng trong cửa sổ đánh giá.',
    ruleType: 'MESSAGE_FAILURE_RATE',
    thresholdValue: '5.00', thresholdUnit: '%', comparisonOperator: 'GT',
    timeWindowMinutes: 10, cooldownMinutes: 15,
  },
  {
    name: 'Throughput thấp bất thường',
    description: 'Lưu lượng message rơi dưới ngưỡng — có thể line dừng hoặc mất kết nối thiết bị.',
    ruleType: 'THROUGHPUT_LOW',
    thresholdValue: '1.00', thresholdUnit: 'msg/min', comparisonOperator: 'LT',
    timeWindowMinutes: 15, cooldownMinutes: 30,
  },
  {
    name: 'Broker ngắt kết nối kéo dài',
    description: 'External MQTT broker mất kết nối quá lâu — telemetry ra ngoài bị gián đoạn.',
    ruleType: 'BROKER_DISCONNECT',
    thresholdValue: '5.00', thresholdUnit: 'minutes', comparisonOperator: 'GT',
    timeWindowMinutes: 5, cooldownMinutes: 15,
  },
  {
    name: 'Thiết bị/Client offline kéo dài',
    description: 'Client (máy/edge) không gửi dữ liệu quá lâu — nghi mất nguồn hoặc rớt mạng.',
    ruleType: 'CLIENT_OFFLINE',
    thresholdValue: '10.00', thresholdUnit: 'minutes', comparisonOperator: 'GT',
    timeWindowMinutes: 10, cooldownMinutes: 30,
  },
];

async function main() {
  let inserted = 0, skipped = 0;
  for (const r of RULES) {
    const exists = await sql`SELECT 1 FROM mqtt_alert_rules WHERE name = ${r.name} LIMIT 1`;
    if (exists.length > 0) { skipped++; continue; }
    await sql`
      INSERT INTO mqtt_alert_rules
        ("name", "description", "ruleType", "thresholdValue", "thresholdUnit",
         "comparisonOperator", "timeWindowMinutes", "notifyOwner", "notifyEmail",
         "notifyMqtt", "cooldownMinutes", "isEnabled")
      VALUES
        (${r.name}, ${r.description}, ${r.ruleType}, ${r.thresholdValue}, ${r.thresholdUnit},
         ${r.comparisonOperator}, ${r.timeWindowMinutes}, true, false, false,
         ${r.cooldownMinutes}, true)
    `;
    inserted++;
    log('inserted:', r.name);
  }
  log(`done — inserted ${inserted}, skipped ${skipped} (already present)`);
}

main()
  .catch((e) => { console.error('[seed-alert-rules] FAILED:', e?.message || e); process.exitCode = 1; })
  .finally(() => sql.end());
