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
  const productId = products[0].id;

  const measurementTypes = await q("measurementTypeCatalog.list", {});
  const defectCatalog = await q("defectCatalog.list", {});
  console.log("Catalog counts", {
    measurementTypeCatalog: measurementTypes?.length || 0,
    defectCatalog: defectCatalog?.length || 0,
  });

  if (!measurementTypes?.length) throw new Error("measurementTypeCatalog empty");

  const mtCode = measurementTypes[0].code;
  const code = `P2SMOKE${Date.now().toString().slice(-6)}`;

  const created = await m("measurementPoint.create", {
    productModelId: productId,
    code,
    name: "P2 smoke point",
    measurementType: "DIMENSION",
    measurementTypeCode: mtCode,
    positionX: 100,
    positionY: 120,
    radius: 12,
    unit: "mm",
    toleranceMode: "bilateral",
    tolPlus: "0.10",
    tolMinus: "0.10",
    nominalValue: "10.00",
    positionZ: "1.23",
    heightMin: "0.8",
    heightMax: "1.8",
    heightNominal: "1.2",
    heightUnit: "mm",
    volumeMin: "2.1",
    volumeMax: "3.9",
    volumeNominal: "3.0",
    volumeUnit: "mm3",
    areaMin: "4.0",
    areaMax: "6.0",
    areaNominal: "5.0",
    areaUnit: "mm2",
    coplanarityMax: "0.15",
    warpageMax: "0.20",
    voidPctMax: "8.0",
    offsetXMax: "0.30",
    offsetYMax: "0.30",
    tiltMax: "1.50",
    thicknessMin: "0.20",
    thicknessMax: "0.80",
    datumRefs: ["A", "B"],
    materialCondition: "RFS",
    fitClass: "H7",
  });

  console.log("Created point id", created?.id);

  const got = await q("measurementPoint.getById", { id: created.id });
  const positionZRaw = got?.positionZ;
  const positionZNum = Number(positionZRaw);

  const checks = {
    measurementTypeCode: got?.measurementTypeCode === mtCode,
    positionZ: Number.isFinite(positionZNum) && Math.abs(positionZNum - 1.23) < 1e-6,
    toleranceMode: got?.toleranceMode === "bilateral",
    datumRefs: Array.isArray(got?.datumRefs) && got.datumRefs.length === 2,
  };

  console.log("Raw positionZ from API", positionZRaw);
  console.log("Validation checks", checks);

  await m("measurementPoint.delete", { id: created.id });
  console.log("Cleanup delete done for id", created.id);

  const ok = Object.values(checks).every(Boolean);
  if (!ok) throw new Error("Validation checks failed");

  console.log("P2 smoke test PASSED");
}

main().catch((e) => {
  console.error("P2 smoke test FAILED:", e.message);
  process.exit(1);
});
