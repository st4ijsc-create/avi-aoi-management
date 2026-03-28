import 'dotenv/config';
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, {ssl:'prefer',max:1});
const r = await sql`
  SELECT mpd.id, mpd."positionX", mpd."positionY", mpd.radius,
    pm."imageWidth", pm."imageHeight",
    (mpd."positionX"::numeric / NULLIF(pm."imageWidth"::numeric,0)) as "calcX"
  FROM measurement_point_defs mpd
  JOIN product_models pm ON mpd."productModelId" = pm.id
  WHERE pm."imageWidth" IS NOT NULL AND pm."imageHeight" IS NOT NULL
  LIMIT 5
`;
console.log(JSON.stringify(r,null,2));

// Check for out-of-range values
const bad = await sql`
  SELECT mpd.id, mpd."positionX", pm."imageWidth",
    ROUND(mpd."positionX"::numeric / NULLIF(pm."imageWidth"::numeric,0), 8) as "calcX"
  FROM measurement_point_defs mpd
  JOIN product_models pm ON mpd."productModelId" = pm.id
  WHERE pm."imageWidth" IS NOT NULL AND pm."imageHeight" IS NOT NULL
    AND (mpd."positionX"::numeric / NULLIF(pm."imageWidth"::numeric,0)) > 99
`;
console.log('\nOut of range rows:', bad.length);
if (bad.length > 0) console.log(JSON.stringify(bad.slice(0,3),null,2));

await sql.end();
