/* shell.js — điều khiển trạng thái mockup (KHÔNG thuộc app). ?state=&role=&density=&scope=&rail=&shot=1 ; nút: <button data-set="state:binh-thuong"> */
(function () {
  var app = document.querySelector(".app");
  var q = new URLSearchParams(location.search);
  var KEYS = { state: "data-state", role: "data-role", density: "data-density", scope: "data-scope", rail: "data-rail" };
  function apply() {
    var els = document.querySelectorAll("[data-st],[data-rl],[data-sc]");
    for (var i = 0; i < els.length; i++) {
      var e = els[i], ok = true;
      [["data-st", "data-state"], ["data-rl", "data-role"], ["data-sc", "data-scope"]].forEach(function (p) {
        if (e.hasAttribute(p[0]) && (" " + e.getAttribute(p[0]) + " ").indexOf(" " + app.getAttribute(p[1]) + " ") < 0) ok = false;
      });
      if (ok) e.setAttribute("data-vis", ""); else e.removeAttribute("data-vis");
    }
    document.querySelectorAll("[data-set]").forEach(function (b) {
      var kv = b.getAttribute("data-set").split(":");
      b.setAttribute("aria-pressed", String(app.getAttribute(KEYS[kv[0]]) === kv[1]));
    });
  }
  Object.keys(KEYS).forEach(function (k) { if (q.has(k)) app.setAttribute(KEYS[k], q.get(k)); });
  if (q.get("shot")) document.body.classList.add("shot");
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-set]");
    if (!b) return;
    var kv = b.getAttribute("data-set").split(":");
    app.setAttribute(KEYS[kv[0]], kv[1]);
    var u = new URL(location.href); u.searchParams.set(kv[0], kv[1]); history.replaceState(null, "", u);
    apply();
  });
  apply();
})();
