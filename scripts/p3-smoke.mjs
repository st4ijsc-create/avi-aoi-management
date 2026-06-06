import process from "node:process";

const bases = ["http://localhost:3000", "http://localhost:3002"];

async function pickBase() {
  for (const b of bases) {
    try {
      const r = await fetch(`${b}/api/auth/check-setup-required`);
      if (r.ok) return b;
    } catch {
      // try next
    }
  }
  throw new Error("No running server on 3000/3002");
}

function enc(input) {
  return encodeURIComponent(JSON.stringify({ json: input }));
}

async function main() {
  const BASE = await pickBase();
  console.log("Using base", BASE);

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });

  if (!login.ok) throw new Error(`Login failed ${login.status}`);

  const cookies =
    (typeof login.headers.getSetCookie === "function"
      ? login.headers.getSetCookie()
      : [login.headers.get("set-cookie")].filter(Boolean));
  const cookie = cookies.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
  if (!cookie) throw new Error("No session cookie");

  const q = async (path, input = {}) => {
    const r = await fetch(`${BASE}/api/trpc/${path}?input=${enc(input)}`, {
      headers: { Accept: "application/json", Cookie: cookie },
    });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(`${path} query failed: ${JSON.stringify(j)}`);
    return j.result?.data?.json;
  };

  const m = async (path, input) => {
    const r = await fetch(`${BASE}/api/trpc/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({ json: input }),
    });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(`${path} mutation failed: ${JSON.stringify(j)}`);
    return j.result?.data?.json;
  };

  const products = await q("productModel.list", { limit: 5 });
  if (!products?.length) throw new Error("No product model found");
  const productModelId = products[0].id;

  const ts = Date.now().toString().slice(-6);

  const instrument = await m("measurementInstrument.create", {
    code: `P3INS${ts}`,
    name: "P3 Smoke Instrument",
    instrumentType: "caliper",
    defaultUnit: "mm",
    calibrationPeriodDays: 180,
    isActive: true,
  });

  const instrumentList = await q("measurementInstrument.list", {});
  const instrumentFound = Array.isArray(instrumentList) && instrumentList.some((x) => x.id === instrument.id);

  const samplingPlan = await m("samplingPlan.create", {
    productModelId,
    code: `P3SP${ts}`,
    name: "P3 Smoke Sampling",
    strategy: "fixed_n",
    sampleSize: 10,
    acceptanceQty: 0,
    rejectionQty: 1,
    isActive: true,
  });

  const samplingList = await q("samplingPlan.listByProduct", { productModelId });
  const samplingFound = Array.isArray(samplingList) && samplingList.some((x) => x.id === samplingPlan.id);

  const productView = await m("productView.create", {
    productModelId,
    code: `P3VW${ts}`,
    name: "P3 Smoke View",
    viewType: "top",
    orderIndex: 0,
    isActive: true,
  });

  const viewList = await q("productView.listByProduct", { productModelId });
  const viewFound = Array.isArray(viewList) && viewList.some((x) => x.id === productView.id);

  await m("productView.delete", { id: productView.id });
  await m("samplingPlan.delete", { id: samplingPlan.id });
  await m("measurementInstrument.delete", { id: instrument.id });

  const checks = {
    productModelId,
    instrumentFound,
    samplingFound,
    viewFound,
  };

  console.log("P3 checks", checks);

  if (!instrumentFound || !samplingFound || !viewFound) {
    throw new Error("P3 smoke validation failed");
  }

  console.log("P3 smoke test PASSED");
}

main().catch((e) => {
  console.error("P3 smoke test FAILED:", e.message);
  process.exit(1);
});
