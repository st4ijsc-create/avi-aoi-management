const STUB = {
  sharp: "export default function sharp(){ throw new Error('DIAG stub sharp'); }\nexport const format={}; export const cache=()=>{}; export const concurrency=()=>0;",
  "onnxruntime-node": "export const InferenceSession={create:async()=>{throw new Error('DIAG stub ort')}};\nexport class Tensor{}; export const env={};\nexport default {InferenceSession,Tensor,env};",
};
const quan = new Set((process.env.DIAG_STUB ?? "").split(",").map((s) => s.trim()).filter(Boolean));
export async function resolve(specifier, context, next) {
  if (quan.has(specifier) && STUB[specifier]) {
    return { url: "data:text/javascript," + encodeURIComponent(STUB[specifier]), shortCircuit: true };
  }
  return next(specifier, context);
}
