/**
 * doc 81 Đợt 10 task E (design §2.15) — imported FIRST by edgeGatewayMain.ts (ES imports evaluate in order, so this runs
 * before dotenv, the logger or any module that could reach server/db/connection): the process role is EDGE. From here on
 * getDb / getJobsDb / getReadDb refuse (null, counted — or throw under EDGE_DB_TRAP=throw). Set unconditionally: an
 * AVI_PROCESS_ROLE from the environment / .env can never turn the edge back into a DB client.
 */
process.env.AVI_PROCESS_ROLE = "edge";

export const EDGE_PROCESS_ROLE = "edge" as const;
