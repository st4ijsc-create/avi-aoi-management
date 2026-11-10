// Đột biến của thẻ TC-05: KHÔNG đưa vào prompt.md. Xem lib/pilotRepo.mjs.
import { chayCheck } from "../../lib/chay.mjs";

const T = "server/utils/msaReport.ts";
const dotBien = [
  { ma: "M1 bo isNaN", tep: T, tim: "if (Number.isNaN(v)) return \"—\";", thay: "" },
  { ma: "M2 bo chuoi rong", tep: T, tim: "if (n === null || n === undefined || n === \"\") return \"—\";", thay: "if (n === null || n === undefined) return \"—\";" },
  { ma: "M3 bo toUpperCase", tep: T, tim: "${m.verdict.toUpperCase()}", thay: "${m.verdict}" },
  { ma: "M4 gio dia phuong", tep: T, tim: "return new Date(d).toISOString().slice(0, 10);", thay: "const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, \"0\")}-${String(x.getDate()).padStart(2, \"0\")}`;" },
  { ma: "M5 ndc hoac", tep: T, tim: "${m.ndc ?? \"—\"}", thay: "${m.ndc || \"—\"}" },
  { ma: "M6 GRR 4 chu so", tep: T, tim: "fmtNum(m.grrPct, 2)", thay: "fmtNum(m.grrPct, 4)" },
  { ma: "M7 bo mac dinh approvedBy", tep: T, tim: "${m.approvedBy ?? \"—\"}", thay: "${m.approvedBy}" },
  { ma: "M8 luon co Notes", tep: T, tim: "if (m.notes) {", thay: "if (true) {" },
  { ma: "M9 dao approvedAt", tep: T, tim: "if (m.approvedAt) {", thay: "if (!m.approvedAt) {" },
  { ma: "M10 serial rong", tep: T, tim: "${i.serialNumber ?? \"—\"}", thay: "${i.serialNumber ?? \"\"}" },
  { ma: "M11 bo record", tep: T, tim: " — record #${m.id}_", thay: "_" },
];

process.exit(await chayCheck(import.meta.url, { dotBien, nguongDotBien: 10 }));
