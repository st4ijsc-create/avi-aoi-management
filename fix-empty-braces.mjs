import { readFileSync, writeFileSync } from 'fs';

const f = 'client/src/pages/Settings.tsx';
let lines = readFileSync(f, 'utf8').split('\n');

// Map of line numbers (1-based) to correct t() call content
// These were all corrupted from {t("key")} to {} by PowerShell eating $1
const fixes = {
  1053: ['{}', '{t("settings.factoryCode")}'],
  1061: ['{}', '{t("settings.factoryName")}'],
  1069: ['{}', '{t("settings.address")}'],
  1163: ['{}', '{t("dashboard.factory")}'],
  1174: ['{}', '{t("settings.workshopCode")}'],
  1182: ['{}', '{t("settings.workshopName")}'],
  1279: ['{}', '{t("dashboard.workshop")}'],
  1290: ['{}', '{t("settings.lineCode")}'],
  1298: ['{}', '{t("settings.lineName")}'],
  1395: ['{}', '{t("dashboard.line")}'],
  1406: ['{}', '{t("settings.stationCode")}'],
  1414: ['{}', '{t("settings.stationName")}'],
  1422: ['{}', '{t("settings.order")}'],
  1525: ['{}', '{t("settings.sidebar.workstation")}'],
  1536: ['{}', '{t("settings.machineCode")}'],
  1544: ['{}', '{t("settings.machineName")}'],
  1552: ['{}', '{t("settings.machineType")}'],
  1563: ['{}', '{t("settings.model")}'],
  1571: ['{}', '{t("settings.manufacturer")}'],
  1699: ['{}', '{t("settings.factoryOptional")}'],
  1712: ['{}', '{t("settings.startTime")}'],
  1736: ['{}', '{t("settings.endTime")}'],
  1761: ['{}', '{t("settings.orderDisplay")}'],
  1935: ['{}', '{t("settings.order")}'],
  1939: ['{}', '{t("settings.linkedStation")}'],
  2100: ['{}', '{t("settings.metricType")}'],
  2114: ['{}', '{t("settings.condition")}'],
  2152: ['{}', '{t("settings.factoryOptionalAll")}'],
  2167: ['{}', '{t("settings.machineOptionalAll")}'],
  2183: ['{}', '{t("settings.cooldownMinutes")}'],
  2494: ['{}', '{t("settings.alertName")}'],
  2501: ['{}', '{t("settings.alertThresholdLabel")}'],
  2509: ['{}', '{t("settings.cooldownLabel")}'],
  2548: ['{}', '{t("settings.stageCode")}'],
  2552: ['{}', '{t("settings.stageName")}'],
  2586: ['{}', '{t("settings.factoryCode")}'],
  2590: ['{}', '{t("settings.factoryName")}'],
  2597: ['{}', '{t("settings.address")}'],
  2645: ['{}', '{t("settings.workshopCode")}'],
  2649: ['{}', '{t("settings.workshopName")}'],
  2683: ['{}', '{t("dashboard.workshop")}'],
  2697: ['{}', '{t("settings.lineCode")}'],
  2701: ['{}', '{t("settings.lineName")}'],
  2735: ['{}', '{t("dashboard.line")}'],
  2749: ['{}', '{t("settings.stationCode")}'],
  2753: ['{}', '{t("settings.stationName")}'],
  2760: ['{}', '{t("settings.order")}'],
  2797: ['{}', '{t("settings.shiftCode")}'],
  2804: ['{}', '{t("settings.shiftName")}'],
  2813: ['{}', '{t("settings.startTime")}'],
  2835: ['{}', '{t("settings.endTime")}'],
  2900: ['{}', '{t("settings.sidebar.workstation")}'],
  2914: ['{}', '{t("settings.machineCode")}'],
  2918: ['{}', '{t("settings.machineName")}'],
  2925: ['{}', '{t("settings.model")}'],
  2932: ['{}', '{t("settings.manufacturer")}'],
  2939: ['{}', '{t("settings.apiKey")}'],
};

let fixedCount = 0;
for (const [lineNum, [oldStr, newStr]] of Object.entries(fixes)) {
  const idx = parseInt(lineNum) - 1;
  if (idx < lines.length && lines[idx].includes(oldStr)) {
    // Replace only the first {} on this line (in label context)
    lines[idx] = lines[idx].replace(oldStr, newStr);
    fixedCount++;
  } else {
    console.warn(`Line ${lineNum}: could not find "${oldStr}" — current: ${lines[idx]?.trim()}`);
  }
}
console.log(`Fixed ${fixedCount} empty {} labels`);

// Fix broken </SelectItem> closing tags (missing < before /SelectItem>)
// Lines 2121-2125: {t("settings.lessThan")}/SelectItem>  →  {t("settings.lessThan")}</SelectItem>
let content = lines.join('\n');
const brokenClosingTag = /\{t\("settings\.(lessThan|lessOrEqual|greaterThan|greaterOrEqual|equalTo)"\)\}\/SelectItem>/g;
const closingFixCount = (content.match(brokenClosingTag) || []).length;
content = content.replace(brokenClosingTag, '{t("settings.$1")}</SelectItem>');
console.log(`Fixed ${closingFixCount} broken </SelectItem> closing tags`);

writeFileSync(f, content, 'utf8');
console.log('Settings.tsx updated successfully');
