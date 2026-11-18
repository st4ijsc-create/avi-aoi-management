// Đột biến của thẻ TC-02: KHÔNG đưa vào prompt.md. Xem lib/pilotRepo.mjs.
import { chayCheck } from "../../lib/chay.mjs";

const T = "client/src/lib/stateVocabulary.ts";
const dotBien = [
  { ma: "M1 bo trim", tep: T, tim: "(s || \"\").trim().toLowerCase()", thay: "(s || \"\").toLowerCase()" },
  { ma: "M2 bo gach noi", tep: T, tim: ".replace(/[\\s-]+/g, \"_\")", thay: ".replace(/[\\s]+/g, \"_\")" },
  { ma: "M3 bo lower", tep: T, tim: ".trim().toLowerCase()", thay: ".trim()" },
  { ma: "M4 doi token ud", tep: T, tim: "ud: \"--e10-ud\"", thay: "ud: \"--e10-sd\"" },
  { ma: "M5 bo transient holding", tep: T, tim: "holding: { varName: \"--packml-held\", transient: true }", thay: "holding: { varName: \"--packml-held\" }" },
  { ma: "M6 andon call", tep: T, tim: "call: \"--alarm-high\"", thay: "call: \"--alarm-critical\"" },
  { ma: "M7 unitmode maintenance", tep: T, tim: "maintenance: \"--alarm-medium\"", thay: "maintenance: \"--packml-ready\"" },
  { ma: "M8 bo p4", tep: T, tim: "advisory: \"--alarm-low\", p4: \"--alarm-low\",", thay: "advisory: \"--alarm-low\"," },
  { ma: "M9 unitmode null", tep: T, tim: "case \"unitmode\": return UNITMODE[k] ? { varName: UNITMODE[k] } : null;", thay: "case \"unitmode\": return null;" },
];

process.exit(await chayCheck(import.meta.url, { dotBien }));
