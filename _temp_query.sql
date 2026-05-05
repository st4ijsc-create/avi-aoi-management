SELECT id, "createdAt", event, message FROM package_activity_logs WHERE "createdAt" >= '2026-04-11 00:00:00' AND "createdAt" <= '2026-04-11 23:59:59' ORDER BY id DESC LIMIT 10;
