// Sprint F5a — Interlock engine entrypoint (ALERT-ONLY; no command path).
export { startInterlock, stopInterlock, isInterlockRunning, runOnce, evaluateRule } from "./interlockEngine";
export * from "./ruleEvaluator";
