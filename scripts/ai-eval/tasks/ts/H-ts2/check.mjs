import { chayCheck } from "../../lib/chay.mjs";

process.exit(await chayCheck(import.meta.url));
