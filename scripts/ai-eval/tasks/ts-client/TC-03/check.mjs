// Đột biến của thẻ TC-03: KHÔNG đưa vào prompt.md. Xem lib/pilotRepo.mjs.
import { chayCheck } from "../../lib/chay.mjs";

const T = "client/src/lib/engineeringDeepLink.ts";
const dotBien = [
  { ma: "M1 cho 0", tep: T, tim: "Number.isInteger(n) && n > 0 ? n : null", thay: "Number.isInteger(n) && n >= 0 ? n : null" },
  { ma: "M2 bo isInteger", tep: T, tim: "Number.isInteger(n) && n > 0 ? n : null", thay: "n > 0 ? n : null" },
  { ma: "M3 khong bo dau hoi", tep: T, tim: "const raw = search.startsWith(\"?\") ? search.slice(1) : search;", thay: "const raw = search;" },
  { ma: "M4 bo kiem ref rong", tep: T, tim: "ref: ref && ref.trim() !== \"\" ? ref : null,", thay: "ref," },
  { ma: "M5 bo trim withParams", tep: T, tim: "const s = String(v).trim();", thay: "const s = String(v);" },
  { ma: "M6 bo loai rong", tep: T, tim: "if (s === \"\") continue;", thay: "" },
  { ma: "M7 luon them dau hoi", tep: T, tim: "return qs ? `${path}?${qs}` : path;", thay: "return `${path}?${qs}`;" },
  { ma: "M8 doi projectId machineId", tep: T, tim: "projectId: toPosInt(sp.get(\"projectId\")),", thay: "projectId: toPosInt(sp.get(\"machineId\"))," },
];

process.exit(await chayCheck(import.meta.url, { dotBien }));
