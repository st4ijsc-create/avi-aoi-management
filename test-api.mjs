import { drizzle } from "drizzle-orm/mysql2";
import { machines, measurementPointDefs } from "./drizzle/schema.ts";
import { eq } from "drizzle-orm";

const db = drizzle(process.env.DATABASE_URL);

// Get first machine with API key
const machineList = await db.select().from(machines).limit(1);
const machine = machineList[0];

if (machine) {
  console.log("Machine found:");
  console.log("  ID:", machine.id);
  console.log("  Code:", machine.code);
  console.log("  Name:", machine.name);
  console.log("  API Key:", machine.apiKey);
  
  // Get measurement points for this machine's product model
  const points = await db.select().from(measurementPointDefs).limit(5);
  console.log("\nSample measurement point codes:");
  points.forEach(p => console.log("  -", p.code));
}

process.exit(0);
