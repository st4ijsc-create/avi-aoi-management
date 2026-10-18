/**
 * ★ 2026-10-18 — CHỈ MỤC KÝ HIỆU API CỤC BỘ (khuyến nghị #1, `docs/superpowers/audits/2026-10-18-ai-local-nguon-hoc-code.md`):
 * các bộ PHÂN TÍCH THUẦN (không đọc đĩa, không tiến trình con) + bộ GHI chỉ mục. Bộ điều phối đọc nguồn thật ở
 * `dung-chi-muc-api.mjs`; máy chủ đọc chỉ mục ở `server/services/ai/apiRef/traApi.ts`.
 *
 * MỘT MỤC (`Muc`) — một ký hiệu công khai:
 *   { nn: "csharp"|"typescript"|"java"|"python", loai, ns, ten, cha?, chuKy, tomTat, loiThoi?, tep?, nguon }
 *   · `ns`  = namespace (.NET) · package (Java) · module (Python) · module import được (TS; "" = toàn cục của lib)
 *   · `ten` = tên TRONG ns (vd `SqlBulkCopyOptions.KeepIdentity`, `HttpClient.Builder.version`, `pgTable`)
 *   · `cha` = kiểu chứa (trong ns) với thành viên
 *   · `_nhom` / `_thuoc` (nội bộ, KHÔNG ghi ra) — nối thành viên vào đúng KHAI BÁO kiểu (TS gộp interface nhiều tệp).
 *
 * BỐ CỤC ĐĨA (`vietChiMuc`):
 *   · `muc.jsonl`   — mỗi dòng một mục; khối thành viên của một kiểu ĐỨNG NGAY TRƯỚC dòng kiểu, dòng kiểu mang
 *                     `tv: [offset, byteLen, soThanhVien]` trỏ vào khối ⇒ "SqlBulkCopyOptions ⇒ thành viên" là MỘT lần đọc.
 *   · `chi-muc.tsv` — `khoa \t off36.len36,off36.len36…` sắp xếp THEO BYTE, khoá = tên NGẮN chữ thường, chỉ ASCII
 *                     ⇒ máy chủ tìm nhị phân trên đĩa, không nạp cả tệp vào bộ nhớ.
 *   · `meta.json`   — nguồn (nhãn + phiên bản + đường), số mục theo nguồn, thời điểm dựng.
 */
import fs from "node:fs";
import path from "node:path";

const TRAN_TOM_TAT = 240;
const TRAN_CHU_KY = 300;

// ─── tiện ích chung ─────────────────────────────────────────────────────────────────────────────

const giaiMa = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, "&");

/** Câu/đoạn đầu, gọn khoảng trắng, cắt trần. */
export function catTomTat(s, tran = TRAN_TOM_TAT) {
  let t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const cau = /^(.{20,}?[.!?])(\s|$)/.exec(t);
  if (cau && cau[1].length <= tran) t = cau[1];
  return t.length <= tran ? t : `${t.slice(0, tran - 1).trimEnd()}…`;
}

const gon = (s, tran = TRAN_CHU_KY) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length <= tran ? t : `${t.slice(0, tran - 1)}…`;
};

/** Khoá chỉ mục của một mục: tên NGẮN (đoạn cuối của `ten`) chữ thường; hàm dựng không có khoá riêng; chỉ ASCII. */
export function khoaCua(muc) {
  if (!muc || muc.loai === "ctor") return null;
  const ngan = String(muc.ten ?? "").split(".").pop() ?? "";
  const k = ngan.toLowerCase();
  return /^[a-z0-9_$]{1,120}$/.test(k) ? k : null;
}

// ─── .NET: XML IntelliSense ─────────────────────────────────────────────────────────────────────

const tenNganCref = (cref) => cref.replace(/^[TMPFEN]:/, "").replace(/`+\d+/g, "").split("(")[0];

/** XML doc → văn bản: cref thành `Ten`, bỏ thẻ. (Cùng phép của `tao-tham-chieu-api-dotnet.mjs`.) */
function lamPhangXml(x) {
  return giaiMa(
    String(x)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<see\s+cref="([^"]+)"\s*\/>/g, (_, c) => `\`${tenNganCref(c).split(".").pop()}\``)
      .replace(/<see\s+langword="([^"]+)"\s*\/>/g, "`$1`")
      .replace(/<(?:paramref|typeparamref)\s+name="([^"]+)"\s*\/>/g, "`$1`")
      .replace(/<xref:([^>]+)>/g, (_, c) => `\`${decodeURIComponent(c).replace(/%2A|\*$/g, "").replace(/\?.*$/, "").split(".").pop()}\``)
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

/** Tách ID tài liệu XML: `M:NS.Type.Method``1(System.Int32,…)` ⇒ { loai, chua, thanhVien, thamSo[], soThamSoKieu }. */
export function tachIdXml(id) {
  const loai = id[0];
  const than = id.slice(2);
  const i = than.indexOf("(");
  const truoc = i >= 0 ? than.slice(0, i) : than;
  const thamSoTho = i >= 0 ? than.slice(i + 1, than.lastIndexOf(")")) : "";
  const thamSo = [];
  if (thamSoTho) {
    let sau = 0;
    let cur = "";
    for (const c of thamSoTho) {
      if (c === "{" || c === "[") sau++;
      if (c === "}" || c === "]") sau--;
      if (c === "," && sau === 0) {
        thamSo.push(cur);
        cur = "";
      } else cur += c;
    }
    thamSo.push(cur);
  }
  const thamSoGon = thamSo.map((t) => t.replace(/\{/g, "<").replace(/\}/g, ">"));
  if (loai === "T") return { loai, chua: truoc, thanhVien: "", thamSo: [], soThamSoKieu: 0 };
  const cham = truoc.lastIndexOf(".");
  let thanhVien = truoc.slice(cham + 1);
  const mg = /``(\d+)$/.exec(thanhVien);
  const soThamSoKieu = mg ? Number(mg[1]) : 0;
  thanhVien = thanhVien.replace(/``\d+$/, "");
  return { loai, chua: truoc.slice(0, cham), thanhVien, thamSo: thamSoGon, soThamSoKieu };
}

/** Kiểu tham số: `System.X` (một đoạn) rút gọn thành `X`; `` ``n ``/`` `n `` ⇒ tên typeparam; `@` (ref) ⇒ `ref `. */
function veKieuThamSo(t, tenTpPt, tenTpKieu) {
  let s = t.replace(/``(\d+)/g, (_, n) => tenTpPt[Number(n)] ?? `TM${n}`).replace(/`(\d+)/g, (_, n) => tenTpKieu[Number(n)] ?? `T${n}`);
  s = s.replace(/\bSystem\.([A-Za-z0-9_]+)(?![\w.])/g, "$1");
  if (s.endsWith("@")) s = `ref ${s.slice(0, -1)}`;
  return s;
}

/**
 * Một tệp XML IntelliSense ⇒ mục. `opts.kieuBiet` (Set tên đầy đủ của MỌI kiểu trong cùng gói) giúp nhận kiểu LỒNG khi kiểu
 * ngoài nằm ở tệp khác; mặc định chỉ dùng kiểu trong tệp này.
 */
export function mucTuXmlDotnet(xml, opts = {}) {
  const tho = [];
  for (const m of String(xml).matchAll(/<member name="([^"]+)">([\s\S]*?)<\/member>/g)) tho.push({ id: giaiMa(m[1]), noi: m[2] });
  const kieuTrongTep = new Set(tho.filter((x) => x.id.startsWith("T:")).map((x) => x.id.slice(2)));
  const kieuBiet = opts.kieuBiet ?? kieuTrongTep;
  const laKieu = (t) => kieuBiet.has(t) || kieuTrongTep.has(t);
  /** "A.B.C" (đầy đủ, có `n) ⇒ { ns, ten } — đi ngược khi tiền tố cũng là kiểu (lồng). */
  const nsCua = new Map();
  const tachNs = (day) => {
    if (nsCua.has(day)) return nsCua.get(day);
    const doan = day.split(".");
    let k = doan.length - 1;
    while (k > 1 && laKieu(doan.slice(0, k).join("."))) k--;
    const r = { ns: doan.slice(0, k).join("."), ten: doan.slice(k).join(".").replace(/`\d+/g, "") };
    nsCua.set(day, r);
    return r;
  };
  const tp = (noi) => [...String(noi).matchAll(/<typeparam name="([^"]+)"/g)].map((x) => x[1]);
  const tom = (noi) => {
    const s = /<summary>([\s\S]*?)<\/summary>/.exec(noi);
    return s ? catTomTat(lamPhangXml(s[1])) : "";
  };
  const tpKieu = new Map();
  const nhom = new Map();
  const ra = [];
  for (const x of tho) {
    if (!x.id.startsWith("T:")) continue;
    const { ns, ten } = tachNs(x.id.slice(2));
    const tps = tp(x.noi);
    tpKieu.set(x.id.slice(2), tps);
    const id = `${ns}|${ten}`;
    nhom.set(x.id.slice(2), id);
    ra.push({ nn: "csharp", loai: "type", ns, ten, chuKy: tps.length ? `${ten}<${tps.join(", ")}>` : ten, tomTat: tom(x.noi), tep: opts.tep, _nhom: id });
  }
  for (const x of tho) {
    if (x.id.startsWith("T:") || x.id.startsWith("N:")) continue;
    const t = tachIdXml(x.id);
    if (!/^[MPFE]$/.test(t.loai)) continue;
    // cài đặt giao diện tường minh (`System#IDisposable#Dispose`) + hàm dựng tĩnh: không phải bề mặt gọi được
    if (t.thanhVien === "#cctor" || (t.thanhVien.includes("#") && t.thanhVien !== "#ctor")) continue;
    const { ns, ten: cha } = tachNs(t.chua);
    const tenKieuNgan = cha.split(".").pop();
    const tpPt = tp(x.noi);
    const thamSo = t.thamSo.map((s) => veKieuThamSo(s, tpPt, tpKieu.get(t.chua) ?? []));
    let loai;
    let chuKy;
    if (t.loai === "M" && t.thanhVien === "#ctor") {
      loai = "ctor";
      chuKy = `${tenKieuNgan}(${thamSo.join(", ")})`;
    } else if (t.loai === "M") {
      loai = "method";
      const gen = t.soThamSoKieu ? `<${(tpPt.length ? tpPt : Array.from({ length: t.soThamSoKieu }, (_, i) => `TM${i}`)).join(", ")}>` : "";
      chuKy = `${t.thanhVien}${gen}(${thamSo.join(", ")})`;
    } else if (t.loai === "P") {
      loai = "property";
      chuKy = thamSo.length ? `this[${thamSo.join(", ")}]` : t.thanhVien;
    } else {
      loai = t.loai === "F" ? "field" : "event";
      chuKy = t.thanhVien;
    }
    const tenTv = loai === "ctor" ? cha : `${cha}.${t.thanhVien}`;
    ra.push({ nn: "csharp", loai, ns, ten: tenTv, cha, chuKy: gon(chuKy), tomTat: tom(x.noi), tep: opts.tep, _thuoc: nhom.get(t.chua) ?? `${ns}|${cha}` });
  }
  return ra;
}

// ─── Java: mã nguồn JDK (src.zip) ──────────────────────────────────────────────────────────────

/** `module-info.java` ⇒ các package exports KHÔNG giới hạn (`exports a.b;`, không `to …`). */
export function goiXuatJava(moduleInfo) {
  const sach = String(moduleInfo).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  return new Set([...sach.matchAll(/\bexports\s+([\w.]+)\s*;/g)].map((m) => m[1]));
}

/** Javadoc ⇒ câu đầu: bỏ `*` đầu dòng, `{@code x}`/`{@link A#b}` ⇒ chữ, bỏ HTML, dừng ở thẻ khối `@`. */
function tomTatJavadoc(doc) {
  const than = String(doc)
    .replace(/^\/\*\*|\*\/$/g, "")
    .split(/\r?\n/)
    .map((d) => d.replace(/^\s*\*\s?/, ""))
    .join("\n");
  const truocThe = than.split(/\n\s*@[a-zA-Z]/)[0];
  const phang = giaiMa(
    truocThe
      .replace(/\{@(?:code|literal)\s+([^}]*)\}/g, "$1")
      .replace(/\{@(?:link|linkplain)\s+([^}\s]+)(?:\s+([^}]*))?\}/g, (_, a, b) => b || a.replace(/^#/, "").replace("#", "."))
      .replace(/\{@[a-zA-Z]+\s*([^}]*)\}/g, "$1")
      .replace(/<[^>]+>/g, " "),
  );
  const doanDau = phang.split(/\n\s*\n/)[0];
  return catTomTat(doanDau);
}

const RE_KIEU_JAVA = /\b(class|interface|enum|record|@interface)\s+([A-Za-z_$][\w$]*)/;
const RE_BO_TU_JAVA = /\b(public|protected|private|static|final|abstract|synchronized|native|default|strictfp|transient|volatile|sealed|non-sealed)\b/g;

/** Bỏ phần khởi tạo `= …` của từng biến trong khai báo trường (tôn trọng ngoặc: `= f(1, 2), b = 3`). */
function boGanJava(s) {
  let ra = "";
  let sau = 0;
  let boQua = false;
  for (const c of s) {
    if (c === "(" || c === "[" || c === "{" || c === "<") sau++;
    else if (c === ")" || c === "]" || c === "}" || c === ">") sau = Math.max(0, sau - 1);
    if (!boQua && c === "=" && sau === 0) {
      boQua = true;
      continue;
    }
    if (boQua && c === "," && sau === 0) boQua = false;
    if (!boQua) ra += c;
  }
  return ra;
}

/** Bỏ chú thích annotation (`@X`, `@X(...)`) khỏi đầu khai báo; giữ `@interface`. */
function boAnnotation(s) {
  let ra = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "@" && !s.startsWith("@interface", i)) {
      let j = i + 1;
      while (j < s.length && /[\w$.]/.test(s[j])) j++;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] === "(") {
        let sau = 0;
        for (; j < s.length; j++) {
          if (s[j] === "(") sau++;
          else if (s[j] === ")" && --sau === 0) {
            j++;
            break;
          }
        }
      }
      ra += " ";
      i = j - 1;
    } else ra += s[i];
  }
  return ra;
}

/**
 * Một tệp `.java` ⇒ mục API công khai. Bộ quét ký tự (chú thích, chuỗi, ký tự, text block) giữ độ sâu ngoặc; thân phương
 * thức/khởi tạo bị nhảy qua cả khối. Hiển thị: kiểu top-level `public`; kiểu lồng `public`/`protected` (hoặc trong
 * interface); thành viên `public`/`protected` (trong interface/annotation: mọi thứ không `private`).
 */
export function mucTuJava(src, opts = {}) {
  const s = String(src);
  const goi = /^\s*package\s+([\w.]+)\s*;/m.exec(s.replace(/\/\*[\s\S]*?\*\//g, ""))?.[1] ?? "";
  const ra = [];
  const ngan = []; // { ten, loai, sauThan, hien, laGiaoDien, laEnum, hangXong }
  let sau = 0;
  let dau = "";
  let doc = null;
  let i = 0;
  const n = s.length;

  /** Từ vị trí `{` (đã ở i), nhảy tới SAU `}` khớp. */
  const nhayKhoi = (k) => {
    let d = 0;
    for (; k < n; k++) {
      const c = s[k];
      if (c === "/" && s[k + 1] === "/") {
        k = s.indexOf("\n", k);
        if (k < 0) return n;
      } else if (c === "/" && s[k + 1] === "*") {
        k = s.indexOf("*/", k + 2) + 1;
        if (k <= 0) return n;
      } else if (c === '"' || c === "'") k = nhayChuoi(k);
      else if (c === "{") d++;
      else if (c === "}" && --d === 0) return k + 1;
    }
    return n;
  };
  /** Ở dấu nháy tại k ⇒ trả chỉ số ký tự ĐÓNG. */
  const nhayChuoi = (k) => {
    if (s.startsWith('"""', k)) {
      const e = s.indexOf('"""', k + 3);
      return e < 0 ? n : e + 2;
    }
    const q = s[k];
    for (k++; k < n; k++) {
      if (s[k] === "\\") k++;
      else if (s[k] === q || s[k] === "\n") return k;
    }
    return n;
  };

  const tenDayDu = () => ngan.map((x) => x.ten).join(".");
  const hienTrongKieu = (dauKhai) => {
    const top = ngan.at(-1);
    if (!top || !top.hien) return false;
    if (/\bprivate\b/.test(dauKhai)) return false;
    if (top.laGiaoDien) return true;
    return /\b(public|protected)\b/.test(dauKhai);
  };
  const loiThoiCua = (dauGoc, d) => /@Deprecated\b/.test(dauGoc) || /@deprecated\b/.test(d ?? "");

  const ghiThanhVien = (dauGoc, coThan) => {
    const top = ngan.at(-1);
    const dk = gon(boAnnotation(dauGoc));
    if (!dk || !hienTrongKieu(dk)) return;
    const cha = tenDayDu();
    const p = dk.indexOf("(");
    if (p >= 0 && !/=/.test(dk.slice(0, p))) {
      const truoc = dk.slice(0, p).trim();
      const ten = /([A-Za-z_$][\w$]*)$/.exec(truoc)?.[1];
      if (!ten) return;
      // hàm dựng: bỏ bổ từ + mệnh đề `<T>` đầu ⇒ chỉ còn đúng tên kiểu (không có kiểu trả về)
      const conLai = truoc.replace(RE_BO_TU_JAVA, " ").replace(/^\s*<[^()]*>\s*/, "").trim();
      const laCtor = ten === top.ten && conLai === ten;
      const chuKy = gon(dk.replace(/\s*\{.*$/, "").replace(/;\s*$/, "").replace(/\)\s+default\s+[\s\S]*$/, ")"));
      ra.push({ nn: "java", loai: laCtor ? "ctor" : "method", ns: goi, ten: laCtor ? cha : `${cha}.${ten}`, cha, chuKy, tomTat: doc ? tomTatJavadoc(doc) : "", ...(loiThoiCua(dauGoc, doc) ? { loiThoi: true } : {}), tep: opts.tep, _thuoc: top.id });
      return;
    }
    if (coThan) return;
    // trường: `kiểu a = …, b = …;` ⇒ mỗi biến một mục (javadoc chung)
    const khongGan = boGanJava(dk).replace(/;\s*$/, "");
    const m = /^(.*?)([A-Za-z_$][\w$]*)\s*((?:,\s*[A-Za-z_$][\w$]*\s*)*)$/.exec(khongGan.trim());
    if (!m) return;
    const kieuTien = m[1].trim();
    const ds = [m[2], ...m[3].split(",").map((x) => x.trim()).filter(Boolean)];
    for (const ten of ds) {
      ra.push({ nn: "java", loai: "field", ns: goi, ten: `${cha}.${ten}`, cha, chuKy: gon(`${kieuTien} ${ten}`), tomTat: doc ? tomTatJavadoc(doc) : "", ...(loiThoiCua(dauGoc, doc) ? { loiThoi: true } : {}), tep: opts.tep, _thuoc: top.id });
    }
  };

  const ghiHangEnum = (dauGoc) => {
    const top = ngan.at(-1);
    const dk = boAnnotation(dauGoc).replace(/\(.*$/s, "").trim();
    if (!top.hien || !/^[A-Za-z_$][\w$]*$/.test(dk)) return;
    const cha = tenDayDu();
    ra.push({ nn: "java", loai: "enum-constant", ns: goi, ten: `${cha}.${dk}`, cha, chuKy: dk, tomTat: doc ? tomTatJavadoc(doc) : "", ...(loiThoiCua(dauGoc, doc) ? { loiThoi: true } : {}), tep: opts.tep, _thuoc: top.id });
  };

  const xongCau = () => {
    dau = "";
    doc = null;
  };

  while (i < n) {
    const c = s[i];
    if (c === "/" && s[i + 1] === "/") {
      const e = s.indexOf("\n", i);
      i = e < 0 ? n : e + 1;
      continue;
    }
    if (c === "/" && s[i + 1] === "*") {
      const e = s.indexOf("*/", i + 2);
      const cmt = s.slice(i, e < 0 ? n : e + 2);
      if (cmt.startsWith("/**") && cmt !== "/**/" && dau.trim() === "") doc = cmt;
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const e = nhayChuoi(i);
      dau += s.slice(i, e + 1);
      i = e + 1;
      continue;
    }
    const top = ngan.at(-1);
    const oThanKieu = top && sau === top.sauThan;
    // phần hằng của enum: `A, B(1), C { … };`
    if (oThanKieu && top.laEnum && !top.hangXong) {
      if (c === "(") {
        let d = 0;
        let k = i;
        for (; k < n; k++) {
          if (s[k] === '"' || s[k] === "'") k = nhayChuoi(k);
          else if (s[k] === "(") d++;
          else if (s[k] === ")" && --d === 0) break;
        }
        dau += s.slice(i, k + 1);
        i = k + 1;
        continue;
      }
      if (c === "{") {
        i = nhayKhoi(i);
        continue;
      }
      if (c === "," || c === ";" || c === "}") {
        if (dau.trim()) ghiHangEnum(dau);
        xongCau();
        if (c === ";") top.hangXong = true;
        if (c === "}") {
          ngan.pop();
          sau--;
        }
        i++;
        continue;
      }
      dau += c;
      i++;
      continue;
    }
    if (c === "{") {
      const dauGoc = dau;
      const dk = boAnnotation(dauGoc);
      const mk = RE_KIEU_JAVA.exec(dk);
      if (mk && !/=/.test(dk.slice(0, mk.index)) && !/\bnew\s/.test(dk)) {
        const loaiK = { class: "class", interface: "interface", enum: "enum", record: "record", "@interface": "annotation" }[mk[1]];
        const ten = mk[2];
        let hien;
        if (!top) hien = /\bpublic\b/.test(dk);
        else hien = top.hien && !/\bprivate\b/.test(dk) && (top.laGiaoDien || /\b(public|protected)\b/.test(dk));
        const chaTen = tenDayDu();
        const tenDay = chaTen ? `${chaTen}.${ten}` : ten;
        const id = `${goi}|${tenDay}`;
        if (hien) {
          ra.push({
            nn: "java",
            loai: loaiK,
            ns: goi,
            ten: tenDay,
            ...(chaTen ? { cha: chaTen } : {}),
            chuKy: gon(dk),
            tomTat: doc ? tomTatJavadoc(doc) : "",
            ...(loiThoiCua(dauGoc, doc) ? { loiThoi: true } : {}),
            tep: opts.tep,
            _nhom: id,
            ...(top ? { _thuoc: top.id } : {}),
          });
        }
        sau++;
        ngan.push({ ten, id, sauThan: sau, hien, laGiaoDien: loaiK === "interface" || loaiK === "annotation", laEnum: loaiK === "enum", hangXong: false });
        xongCau();
        i++;
        continue;
      }
      if (oThanKieu && /=/.test(dk)) {
        // khởi tạo mảng / lambda trong biểu thức gán của trường ⇒ một phần của câu
        const e = nhayKhoi(i);
        dau += "{…}";
        i = e;
        continue;
      }
      if (oThanKieu && dk.trim() && dk.includes("(")) ghiThanhVien(dauGoc, true);
      i = nhayKhoi(i);
      xongCau();
      continue;
    }
    if (c === ";") {
      if (oThanKieu && dau.trim()) ghiThanhVien(dau, false);
      xongCau();
      i++;
      continue;
    }
    if (c === "}") {
      if (top && sau === top.sauThan) ngan.pop();
      sau = Math.max(0, sau - 1);
      xongCau();
      i++;
      continue;
    }
    dau += c;
    i++;
  }
  return ra;
}

// ─── TypeScript: tệp .d.ts (API trình biên dịch TypeScript, tiêm `ts`) ──────────────────────────

/**
 * Một tệp `.d.ts` ⇒ mục. `opts.module` = tên module import được ("" ⇒ toàn cục, cho lib.*.d.ts / script). Module (có
 * import/export) chỉ lấy khai báo `export` (kể cả qua `export { a as b }`) và đích của `export =`; `declare module "x"`
 * ⇒ ns "x"; `declare global` ⇒ ns "".
 */
export function mucTuTs(ts, text, opts = {}) {
  const sf = ts.createSourceFile(opts.tep ?? "x.d.ts", String(text), ts.ScriptTarget.Latest, true);
  const ra = [];
  const K = ts.SyntaxKind;
  const coMod = (node, k) => !!node.modifiers?.some((m) => m.kind === k);
  const docCua = (node) => {
    const ds = node.jsDoc;
    if (!ds || ds.length === 0) return { tom: "", loiThoi: false };
    const d = ds[ds.length - 1];
    const tom = catTomTat(ts.getTextOfJSDocComment(d.comment) ?? "");
    const loiThoi = ds.some((x) => (x.tags ?? []).some((t) => t.tagName?.escapedText === "deprecated"));
    return { tom, loiThoi };
  };
  const tenCua = (node) => {
    const nm = node.name;
    if (!nm) return null;
    if (ts.isIdentifier(nm) || ts.isStringLiteral(nm) || ts.isNumericLiteral(nm)) return nm.text;
    if (ts.isPrivateIdentifier?.(nm)) return null;
    return null;
  };
  const vanBan = (node) => node.getText(sf);
  const dauKhaiBao = (node) => {
    const t = vanBan(node);
    let d = 0;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (c === "<" || c === "(") d++;
      else if (c === ">" || c === ")") d--;
      else if (c === "{" && d <= 0) return t.slice(0, i);
    }
    return t;
  };
  const day = (muc, node) => {
    const { tom, loiThoi } = docCua(node);
    ra.push({ nn: "typescript", ...muc, chuKy: gon(muc.chuKy), tomTat: tom, ...(loiThoi ? { loiThoi: true } : {}), tep: opts.tep });
  };

  let soNhom = 0;
  const thanhVienCua = (node, ns, tenKieu, idNhom) => {
    for (const mb of node.members ?? []) {
      if (coMod(mb, K.PrivateKeyword) || coMod(mb, K.ProtectedKeyword)) continue;
      let loai = null;
      if (ts.isMethodSignature(mb) || ts.isMethodDeclaration(mb)) loai = "method";
      else if (ts.isPropertySignature(mb) || ts.isPropertyDeclaration(mb) || ts.isGetAccessor(mb) || ts.isSetAccessor(mb)) loai = "property";
      else if (ts.isEnumMember(mb)) loai = "enum-member";
      else if (ts.isConstructorDeclaration(mb) || ts.isConstructSignatureDeclaration(mb)) {
        day({ loai: "ctor", ns, ten: tenKieu, cha: tenKieu, chuKy: vanBan(mb), _thuoc: idNhom }, mb);
        continue;
      }
      if (!loai) continue;
      const ten = tenCua(mb);
      if (!ten || ten.startsWith("#")) continue;
      day({ loai, ns, ten: `${tenKieu}.${ten}`, cha: tenKieu, chuKy: vanBan(mb), _thuoc: idNhom }, mb);
    }
  };

  /** duyệt một danh sách câu lệnh; `tienTo` = namespace TS lồng ("" ở gốc); `loc(node,ten)` ⇒ tên xuất hoặc null. */
  const duyet = (stmts, ns, tienTo, loc) => {
    for (const st of stmts) {
      if (ts.isModuleDeclaration(st)) {
        if (ts.isStringLiteral(st.name)) {
          if (st.body && ts.isModuleBlock(st.body)) duyet(st.body.statements, st.name.text, "", () => true);
          continue;
        }
        if (st.flags & ts.NodeFlags.GlobalAugmentation || st.name.text === "global") {
          if (st.body && ts.isModuleBlock(st.body)) duyet(st.body.statements, "", "", () => true);
          continue;
        }
        const xuat = loc(st, st.name.text);
        if (!xuat) continue;
        const tenNs = xuat === true ? st.name.text : xuat;
        // `export =` đích là namespace ⇒ thành viên là bề mặt GỐC của module
        const laDichXuat = xuat === "__dich_xuat__";
        let body = st.body;
        let ten = laDichXuat ? "" : `${tienTo}${tenNs}`;
        while (body && ts.isModuleDeclaration(body)) {
          ten = ten ? `${ten}.${body.name.text}` : body.name.text;
          body = body.body;
        }
        if (!laDichXuat) day({ loai: "namespace", ns, ten, chuKy: `namespace ${ten}` }, st);
        if (body && ts.isModuleBlock(body)) duyet(body.statements, ns, ten ? `${ten}.` : "", () => true);
        continue;
      }
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (!ts.isIdentifier(d.name)) continue;
          const xuat = loc(st, d.name.text, d);
          if (!xuat) continue;
          const ten = `${tienTo}${xuat === true || xuat === "__dich_xuat__" ? d.name.text : xuat}`;
          const tu = st.declarationList.flags & ts.NodeFlags.Const ? "const" : st.declarationList.flags & ts.NodeFlags.Let ? "let" : "var";
          day({ loai: "variable", ns, ten, chuKy: `${tu} ${d.getText(sf)}` }, st);
        }
        continue;
      }
      const ten0 = tenCua(st);
      if (!ten0) continue;
      let loai = null;
      if (ts.isInterfaceDeclaration(st)) loai = "interface";
      else if (ts.isClassDeclaration(st)) loai = "class";
      else if (ts.isTypeAliasDeclaration(st)) loai = "type";
      else if (ts.isEnumDeclaration(st)) loai = "enum";
      else if (ts.isFunctionDeclaration(st)) loai = "function";
      if (!loai) continue;
      const xuat = loc(st, ten0);
      if (!xuat) continue;
      const ten = `${tienTo}${xuat === true || xuat === "__dich_xuat__" ? ten0 : xuat}`;
      if (loai === "function" || loai === "type") {
        day({ loai, ns, ten, chuKy: vanBan(st) }, st);
        continue;
      }
      const id = `ts${++soNhom}|${opts.tep}|${ns}|${ten}`;
      day({ loai, ns, ten, chuKy: dauKhaiBao(st), _nhom: id }, st);
      thanhVienCua(st, ns, ten, id);
    }
  };

  const laModule = ts.isExternalModule(sf);
  if (!laModule) {
    duyet(sf.statements, opts.module ?? "", "", () => true);
    return ra;
  }
  // module: tên xuất cục bộ (`export { a as b }`) + đích `export =`
  const xuatCucBo = new Map();
  let dichXuat = null;
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const e of st.exportClause.elements) {
        const goc = (e.propertyName ?? e.name).text;
        if (!xuatCucBo.has(goc)) xuatCucBo.set(goc, []);
        xuatCucBo.get(goc).push(e.name.text);
      }
    }
    if (ts.isExportAssignment(st) && st.isExportEquals && ts.isIdentifier(st.expression)) dichXuat = st.expression.text;
  }
  const loc = (node, ten) => {
    if (coMod(node, K.ExportKeyword)) return true;
    if (dichXuat && ten === dichXuat) return "__dich_xuat__";
    const ds = xuatCucBo.get(ten);
    return ds ? ds[0] : null;
  };
  duyet(sf.statements, opts.module ?? "", "", loc);
  return ra;
}

// ─── bộ ghi ────────────────────────────────────────────────────────────────────────────────────

const LOAI_KIEU = new Set(["type", "class", "interface", "enum", "record", "annotation", "namespace", "module"]);

/** Dòng JSON của một mục (bỏ khoá nội bộ). */
function dongJson(m, nguon, tv) {
  const o = { nn: m.nn, loai: m.loai, ns: m.ns ?? "", ten: m.ten };
  if (m.cha) o.cha = m.cha;
  o.chuKy = m.chuKy ?? "";
  o.tomTat = m.tomTat ?? "";
  if (m.loiThoi) o.loiThoi = true;
  if (m.tep) o.tep = m.tep;
  o.nguon = nguon;
  if (tv) o.tv = tv;
  return `${JSON.stringify(o)}\n`;
}

/**
 * Ghi chỉ mục. `nguonDs`: [{ id, nn, nhan, phienBan?, duong?, muc: Muc[] }]. Trả thống kê. Thành viên của kiểu được ghi
 * THÀNH KHỐI ngay trước dòng kiểu (dòng kiểu trỏ `tv`); thành viên mồ côi (kiểu không có trong nguồn) ghi rời.
 */
export function vietChiMuc(thuMuc, nguonDs, metaThem = {}) {
  fs.mkdirSync(thuMuc, { recursive: true });
  const tepMuc = path.join(thuMuc, "muc.jsonl.tmp");
  const fd = fs.openSync(tepMuc, "w");
  let viTri = 0;
  const khoa = new Map();
  const them = (k, off, len) => {
    if (!k) return;
    let ds = khoa.get(k);
    if (!ds) khoa.set(k, (ds = []));
    ds.push(`${off.toString(36)}.${len.toString(36)}`);
  };
  const ghi = (s) => {
    const b = Buffer.from(s, "utf8");
    fs.writeSync(fd, b);
    const off = viTri;
    viTri += b.length;
    return { off, len: b.length };
  };
  const metaNguon = [];
  try {
    nguonDs.forEach((ng, idx) => {
      const tv = new Map();
      for (const m of ng.muc) {
        if (m._thuoc && !LOAI_KIEU.has(m.loai) && !m._nhom) {
          if (!tv.has(m._thuoc)) tv.set(m._thuoc, []);
          tv.get(m._thuoc).push(m);
        }
      }
      const daGhi = new Set();
      let so = 0;
      const ghiMot = (m, tvRef) => {
        const { off, len } = ghi(dongJson(m, idx, tvRef));
        them(khoaCua(m), off, len);
        so++;
      };
      for (const m of ng.muc) {
        if (m._nhom && tv.has(m._nhom) && !daGhi.has(m._nhom)) {
          daGhi.add(m._nhom);
          const ds = tv.get(m._nhom);
          const dauKhoi = viTri;
          for (const x of ds) ghiMot(x);
          ghiMot(m, [dauKhoi, viTri - dauKhoi, ds.length]);
        } else if (m._thuoc && !LOAI_KIEU.has(m.loai) && !m._nhom) {
          continue; // ghi theo khối (hoặc mồ côi ở dưới)
        } else ghiMot(m);
      }
      for (const [id, ds] of tv) if (!daGhi.has(id)) for (const x of ds) ghiMot(x);
      metaNguon.push({ id: ng.id, nn: ng.nn, nhan: ng.nhan, ...(ng.phienBan ? { phienBan: ng.phienBan } : {}), ...(ng.duong ? { duong: ng.duong } : {}), soMuc: so });
    });
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tepMuc, path.join(thuMuc, "muc.jsonl"));
  const dsKhoa = [...khoa.keys()].sort();
  const dong = dsKhoa.map((k) => `${k}\t${khoa.get(k).join(",")}\n`);
  fs.writeFileSync(path.join(thuMuc, "chi-muc.tsv"), dong.join(""));
  const soMuc = metaNguon.reduce((a, b) => a + b.soMuc, 0);
  const meta = { phienBanDinhDang: 1, ...metaThem, soMuc, soKhoa: dsKhoa.length, kichThuocByte: viTri, nguon: metaNguon };
  fs.writeFileSync(path.join(thuMuc, "meta.json"), JSON.stringify(meta, null, 1) + "\n");
  return meta;
}
