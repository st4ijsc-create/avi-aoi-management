// Dựng DOM (jsdom của repo) TRƯỚC khi nạp react-dom / @testing-library/react. Bài kiểm nhập tệp này ĐẦU TIÊN.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
const w = dom.window;
const dat = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "HTMLButtonElement", "Node", "Element", "Event", "MouseEvent", "KeyboardEvent", "InputEvent", "SubmitEvent", "FormData", "getComputedStyle", "MutationObserver", "requestAnimationFrame", "cancelAnimationFrame", "DocumentFragment", "Text"]) {
  if (w[k] !== undefined) dat(k, k === "window" ? w : typeof w[k] === "function" && !/^[A-Z]/.test(k) ? w[k].bind(w) : w[k]);
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
