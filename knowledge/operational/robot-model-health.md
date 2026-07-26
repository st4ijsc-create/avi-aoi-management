---
route: /robot-model-health
permission: machine_status
role: []
screenVi: Sức khỏe robot & AI
screenEn: Robot & AI Health
inSidebar: true
navGroupVi: AI
navGroupEn: AI
module: MOD_AI
license: OPTIONAL
---

# Sức khỏe robot & AI — Cách vận hành

## Mục đích
I2 (doc 16 §9 Khối 4): advisory robot-behaviour anomaly + AI model rollback audit (read-mostly; mutations gated by AI_ROBOT_ANOMALY_ENABLED / AI_MODEL_AUTOROLLBACK_ENABLED)

## Vị trí truy cập
- Menu: AI › Sức khỏe robot & AI
- URL: `/robot-model-health`
- English: AI › Robot & AI Health

## Quyền yêu cầu
- Permission: `machine_status`
- Module: `MOD_AI` (OPTIONAL — cần license).

