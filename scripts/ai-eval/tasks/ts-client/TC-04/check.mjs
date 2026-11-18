// Đột biến của thẻ TC-04: KHÔNG đưa vào prompt.md. Xem lib/pilotRepo.mjs.
import { chayCheck } from "../../lib/chay.mjs";

const T = "client/src/lib/domains.ts";
const dotBien = [
  { ma: "M1 doi thu tu", tep: T, tim: "export default DOMAINS;", thay: "DOMAINS.reverse();\nexport default DOMAINS;" },
  { ma: "M2 href trung", tep: T, tim: "href: \"/reports\",", thay: "href: \"/ai-home\"," },
  { ma: "M3 labelKey sai", tep: T, tim: "labelKey: \"domains.twin.label\",", thay: "labelKey: \"domains.twin.title\"," },
  { ma: "M6 href khong gach cheo", tep: T, tim: "href: \"/quality-cockpit\",", thay: "href: \"quality-cockpit\"," },
  { ma: "M7 bo mot muc", tep: T, tim: "export default DOMAINS;", thay: "DOMAINS.pop();\nexport default DOMAINS;" },
  { ma: "M8 icon undefined", tep: T, tim: "icon: Network,", thay: "icon: undefined as never," },
  { ma: "M9 export mac dinh khac mang", tep: T, tim: "export default DOMAINS;", thay: "export default [...DOMAINS];" },
  { ma: "M4 thieu khoa zh", tep: "client/src/i18n/locales/zh.json", json: {"duong": "domains.twin.blurb"} },
  { ma: "M5 nhan en rong", tep: "client/src/i18n/locales/en.json", json: {"duong": "domains.ai.label", "dat": ""} },
];

process.exit(await chayCheck(import.meta.url, { dotBien }));
