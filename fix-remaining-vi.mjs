import { readFileSync, writeFileSync } from 'fs';

// ===== Fix Settings.tsx remaining Vietnamese strings =====
const f = 'client/src/pages/Settings.tsx';
let content = readFileSync(f, 'utf8');
let count = 0;

function r(old, newStr, label) {
  if (content.includes(old)) {
    content = content.replace(old, newStr);
    count++;
    console.log(`✅ ${label}`);
  } else {
    console.warn(`⚠️ Not found: ${label}`);
  }
}

function rAll(old, newStr, label) {
  const matches = content.split(old).length - 1;
  if (matches > 0) {
    content = content.replaceAll(old, newStr);
    count += matches;
    console.log(`✅ ${label} (${matches}x)`);
  } else {
    console.warn(`⚠️ Not found: ${label}`);
  }
}

// 1. sản phẩm unit label
r(
  `alertForm.alertType === 'yield_rate' ? '%' : alertForm.alertType === 'ng_count' ? 'sản phẩm' : ''`,
  `alertForm.alertType === 'yield_rate' ? '%' : alertForm.alertType === 'ng_count' ? t("settings.productUnit") : ''`,
  'sản phẩm → t("settings.productUnit")'
);

// 2. Alert example text
r(
  `VD: FPY &lt; 90% sẽ gửi cảnh báo`,
  `{t("settings.alertExample")}`,
  'VD: FPY < 90%... → t("settings.alertExample")'
);

// 3. Tất cả máy placeholder and SelectItem
r(
  `<SelectTrigger><SelectValue placeholder="Tất cả máy" /></SelectTrigger>`,
  `<SelectTrigger><SelectValue placeholder={t("settings.allMachines")} /></SelectTrigger>`,
  'Tất cả máy placeholder'
);
r(
  `<SelectItem value="all">Tất cả máy</SelectItem>`,
  `<SelectItem value="all">{t("settings.allMachines")}</SelectItem>`,
  'Tất cả máy SelectItem'
);

// 4. Tạo cảnh báo button
r(
  `Tạo cảnh báo\n`,
  `{t("settings.createAlertBtn")}\n`,
  'Tạo cảnh báo button'
);

// 5. Alert type labels
r(
  `alert.alertType === 'ng_count' ? 'Số lượng NG' : 'Trạng thái máy'`,
  `alert.alertType === 'ng_count' ? t("settings.ngCount") : t("settings.machineStatus")`,
  'Số lượng NG / Trạng thái máy'
);

// 6. Đang bật / Đã tắt
r(
  `{alert.isActive ? 'Đang bật' : 'Đã tắt'}`,
  `{alert.isActive ? t("settings.alertOn") : t("settings.alertOff")}`,
  'Đang bật / Đã tắt'
);

// 7. MQTT description
r(
  `Phê duyệt, quản lý MQTT clients và kết nối thủ công đã được chuyển sang trang riêng`,
  `{t("settings.mqttDescription")}`,
  'MQTT description'
);

// 8. Auto registration legacy title
r(
  `Đăng ký tự động (WebSocket) - Legacy`,
  `{t("settings.autoRegistrationLegacy")}`,
  'Auto registration legacy title'
);

// 9. WebSocket description
r(
  `Quản lý đăng ký và kết nối máy qua WebSocket - máy tự động gửi yêu cầu đăng ký`,
  `{t("settings.webSocketDescription")}`,
  'WebSocket description'
);

// 10. Lưu buttons (8 instances)
rAll(
  `              Lưu\n`,
  `              {t("common.save")}\n`,
  'Lưu → t("common.save")'
);

// 11. Nhà máy label in edit workshop
r(
  `<label className="text-sm font-medium">Nhà máy</label>`,
  `<label className="text-sm font-medium">{t("dashboard.factory")}</label>`,
  'Nhà máy → t("dashboard.factory")'
);

writeFileSync(f, content, 'utf8');
console.log(`\nTotal: ${count} replacements in Settings.tsx`);

// ===== Update locale files =====
function readJsonFile(path) {
  let raw = readFileSync(path, 'utf8');
  const hasBOM = raw.charCodeAt(0) === 0xFEFF;
  if (hasBOM) raw = raw.slice(1);
  return { data: JSON.parse(raw), hasBOM };
}

function writeJsonFile(path, data, hasBOM) {
  let json = JSON.stringify(data, null, 2) + '\n';
  if (hasBOM) json = '\uFEFF' + json;
  writeFileSync(path, json, 'utf8');
}

const localeDir = 'client/src/i18n/locales';
const newKeys = {
  settings: {
    productUnit: { vi: "sản phẩm", en: "products", zh: "产品" },
    alertExample: { vi: "VD: FPY < 90% sẽ gửi cảnh báo", en: "E.g.: FPY < 90% will trigger an alert", zh: "例如：FPY < 90% 将触发警报" },
    alertOn: { vi: "Đang bật", en: "On", zh: "已开启" },
    alertOff: { vi: "Đã tắt", en: "Off", zh: "已关闭" },
    mqttDescription: { vi: "Phê duyệt, quản lý MQTT clients và kết nối thủ công đã được chuyển sang trang riêng", en: "Approval, MQTT client management and manual connections have been moved to a separate page", zh: "审批、MQTT客户端管理和手动连接已移至单独页面" },
    autoRegistrationLegacy: { vi: "Đăng ký tự động (WebSocket) - Legacy", en: "Auto Registration (WebSocket) - Legacy", zh: "自动注册 (WebSocket) - 旧版" },
    webSocketDescription: { vi: "Quản lý đăng ký và kết nối máy qua WebSocket - máy tự động gửi yêu cầu đăng ký", en: "Manage machine registration and connection via WebSocket - machines automatically send registration requests", zh: "通过WebSocket管理机器注册和连接 - 机器自动发送注册请求" },
  }
};

for (const lang of ['vi', 'en', 'zh']) {
  const path = `${localeDir}/${lang}.json`;
  const { data, hasBOM } = readJsonFile(path);
  
  for (const [section, keys] of Object.entries(newKeys)) {
    if (!data[section]) data[section] = {};
    for (const [key, translations] of Object.entries(keys)) {
      if (!data[section][key]) {
        data[section][key] = translations[lang];
        console.log(`Added ${section}.${key} to ${lang}.json`);
      }
    }
  }
  
  writeJsonFile(path, data, hasBOM);
}

console.log('\nLocale files updated!');
