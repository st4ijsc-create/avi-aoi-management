#!/usr/bin/env node
// ============================================================
// Mẫu đăng ký máy AOI/AVI lên hệ thống AVI-AOI Management
// Chạy: node examples/register-machine-sample.mjs
//
// Dùng REST endpoints (plain JSON) — không cần tRPC client.
// ============================================================

const SERVER_URL = process.env.SERVER_URL || "http://localhost:5000";
const API_BASE = `${SERVER_URL}/api/machine`;

// ─── Thông tin máy cần đăng ký ─────────────────────────────
const MACHINE_INFO = {
  serialNumber: "AOI-SN-2026-0001",       // Bắt buộc - mã serial duy nhất
  name: "AOI Line A - Unit 1",            // Bắt buộc - tên hiển thị
  machineType: "AOI",                      // Bắt buộc - "AOI" | "AVI" | "AUTOMATION"
  model: "SPI-3000",                       // Tuỳ chọn - model máy
  manufacturer: "Koh Young",              // Tuỳ chọn - nhà sản xuất
  firmwareVersion: "3.2.1",               // Tuỳ chọn - phiên bản firmware
  syncMode: "online",                      // Tuỳ chọn - "online" (mặc định) | "offline"
};

// ─── Cấu hình ──────────────────────────────────────────────
const POLL_INTERVAL_MS = 10_000;  // Poll config mỗi 10 giây
const MAX_POLL_ATTEMPTS = 60;     // Tối đa 60 lần (10 phút)

// ============================================================
// Step 1: Đăng ký máy (public endpoint, không cần API Key)
// POST /api/machine/register
// ============================================================
async function registerMachine() {
  console.log("🔌 Đăng ký máy...");
  console.log(`   Serial: ${MACHINE_INFO.serialNumber}`);
  console.log(`   Server: ${API_BASE}`);

  const res = await fetch(`${API_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(MACHINE_INFO),
  });

  const data = await res.json();

  if (!res.ok || !data.success) {
    throw new Error(`Đăng ký thất bại (${res.status}): ${data.message || JSON.stringify(data)}`);
  }

  console.log(`✅ Đăng ký thành công!`);
  console.log(`   ID: ${data.id}`);
  console.log(`   Trạng thái: ${data.registrationStatus}`);
  console.log(`   ${data.message}`);

  return data;
}

// ============================================================
// Step 2: Poll config cho đến khi admin duyệt
// GET /api/machine/config?serialNumber=...
// ============================================================
async function waitForApproval(serialNumber) {
  console.log("\n⏳ Đang chờ admin duyệt máy...");
  console.log(`   (Poll mỗi ${POLL_INTERVAL_MS / 1000}s, tối đa ${MAX_POLL_ATTEMPTS} lần)\n`);

  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    const res = await fetch(
      `${API_BASE}/config?serialNumber=${encodeURIComponent(serialNumber)}`
    );

    if (!res.ok) {
      console.log(`   [${attempt}] ❌ Lỗi truy vấn config (${res.status})`);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const config = await res.json();

    if (config.isApproved && config.apiKey) {
      console.log(`   [${attempt}] ✅ Máy đã được duyệt!`);
      console.log(`\n${"─".repeat(50)}`);
      console.log(`   Machine ID  : ${config.machineId}`);
      console.log(`   Code        : ${config.code}`);
      console.log(`   API Key     : ${config.apiKey}`);
      console.log(`   Station     : ${config.mapping?.station?.name || "N/A"}`);
      console.log(`   Line        : ${config.mapping?.line?.name || "N/A"}`);
      console.log(`${"─".repeat(50)}\n`);
      return config;
    }           

    console.log(`   [${attempt}/${MAX_POLL_ATTEMPTS}] Trạng thái: ${config.registrationStatus} — chờ admin duyệt...`);
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error("⏰ Hết thời gian chờ duyệt. Vui lòng liên hệ admin.");
}

// ============================================================
// Step 3: Gửi heartbeat đầu tiên (xác nhận kết nối)
// POST /api/machine/heartbeat
// ============================================================
async function sendHeartbeat(apiKey) {
  console.log("💓 Gửi heartbeat...");

  const res = await fetch(`${API_BASE}/heartbeat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({ apiKey }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Heartbeat thất bại (${res.status}): ${err.message || ""}`);
  }

  console.log("   ✅ Heartbeat OK — máy đang online\n");
}

// ============================================================
// Step 4 (tuỳ chọn): Đồng bộ measurement points (Push)
// POST /api/machine/sync-points
// ============================================================
async function syncMeasurementPoints(apiKey) {
  console.log("📐 Đồng bộ measurement points (push)...\n");

  const payload = {
    apiKey,
    productModelCode: "PCBA-REV3",
    points: [
      {
        code: "P01",
        name: "Connector A",
        measurementType: "VISUAL",
        unit: "px",
        lowerLimit: 0.1,
        upperLimit: 0.3,
        positionX: 540,
        positionY: 410,
        radius: 25,
        cropWidth: 120,
        cropHeight: 120,
        workstationCode: "WS-AOI",
      },
      {
        code: "P02",
        name: "IC U1 - Solder Joint",
        measurementType: "VISUAL",
        unit: "px",
        lowerLimit: 0.05,
        upperLimit: 0.2,
        positionX: 300,
        positionY: 220,
        radius: 30,
        cropWidth: 150,
        cropHeight: 150,
        workstationCode: "WS-AOI",
      },
    ],
  };

  const res = await fetch(`${API_BASE}/sync-points`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  if (!res.ok || !data.success) {
    console.log(`   ❌ Sync thất bại: ${data.message || JSON.stringify(data)}`);
    return;
  }

  console.log(`   ✅ Sync hoàn tất!`);
  console.log(`   Tạo mới: ${data.created} | Cập nhật: ${data.updated} | Lỗi: ${data.failed}`);
}

// ============================================================
// Step 5 (tuỳ chọn): Tải measurement points từ server (Pull)
// GET /api/machine/get-points?apiKey=...
// ============================================================
async function getPointsFromServer(apiKey) {
  console.log("\n📥 Tải measurement points từ server (pull)...");

  const params = new URLSearchParams({ apiKey });
  const res = await fetch(`${API_BASE}/get-points?${params}`, {
    headers: { "X-API-Key": apiKey },
  });

  if (!res.ok) {
    console.log(`   ❌ Lỗi tải points (${res.status})`);
    return;
  }

  const data = await res.json();

  console.log(`   ✅ Nhận ${data.productModels.length} product model(s):`);
  for (const pm of data.productModels) {
    console.log(`      📦 ${pm.productModelCode} (${pm.productModelName}) — ${pm.totalPoints} points`);
    for (const pt of pm.points) {
      console.log(`         • ${pt.code}: ${pt.name} [${pt.measurementType}] (${pt.positionX}, ${pt.positionY})`);
    }
  }
}

// ============================================================
// Helper
// ============================================================
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// Main — Luồng hoàn chỉnh
// ============================================================
async function main() {
  console.log("═".repeat(55));
  console.log(" 🏭 AVI-AOI Machine Registration Sample");
  console.log("═".repeat(55));
  console.log();

  try {
    // 1. Đăng ký
    await registerMachine();

    // 2. Chờ admin duyệt
    const config = await waitForApproval(MACHINE_INFO.serialNumber);

    // 3. Heartbeat
    await sendHeartbeat(config.apiKey);

    // 4. Sync points lên server (push)
    await syncMeasurementPoints(config.apiKey);

    // 5. Tải points từ server (pull)
    await getPointsFromServer(config.apiKey);

    console.log("\n🎉 Hoàn tất! Máy đã sẵn sàng sử dụng.");
    console.log("   Tiếp theo: gọi machineApi.submitInspection để gửi kết quả kiểm tra.\n");
  } catch (err) {
    console.error("\n❌ Lỗi:", err.message);
    process.exit(1);
  }
}

main();
