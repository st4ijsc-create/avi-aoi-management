import fs from "node:fs";
const t = setInterval(() => {
  try {
    const r = process.report.getReport();
    const so = (r.sharedObjects ?? []).filter((x) => !/[\\/]windows[\\/]/i.test(x));
    fs.writeFileSync(process.env.DIAG_REPORT_OUT ?? ".diag-modules.txt", so.join("\n"));
  } catch {}
}, 4000);
t.unref();
