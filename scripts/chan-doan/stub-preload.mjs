// --import scripts/chan-doan/stub-preload.mjs  (+ DIAG_STUB=sharp,onnxruntime-node): thay module ESM bằng stub để bisect addon native.
import { register } from "node:module";
register(new URL("./stub-hook.mjs", import.meta.url));
