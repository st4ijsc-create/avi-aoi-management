/**
 * TRÍCH TỆP từ câu trả lời MỘT LƯỢT của model: khối mã ⇒ đường tệp ⇒ nội dung.
 *
 * Đường của một khối, theo thứ tự tin cậy:
 *   (1) dòng ĐẦU khối là chú thích đánh dấu: `// tệp: src/a.ts`, `# tệp: sol.py`, `-- tệp: q.sql`, khối chú thích C `file: x`…
 *       (định dạng bộ đo YÊU CẦU — dòng đánh dấu bị bỏ khỏi nội dung);
 *   (2) chuỗi thông tin của rào: ```ts src/a.ts``` · ```python title="sol.py"``` · ```rust:src/lib.rs```;
 *   (3) dòng chữ NGAY TRƯỚC khối có nhắc một tệp cần giải (`**src/a.ts**`, `### sol.py`, "Tệp `x.go`:").
 * Một đường khớp tệp cần giải khi bằng nhau, hoặc một bên là đuôi đường của bên kia (đuôi duy nhất).
 * Nhiều khối cùng một tệp ⇒ lấy khối CUỐI (model hay tự sửa lại).
 * Còn đúng MỘT tệp cần giải chưa có khối và còn khối chưa gán ⇒ chọn khối chưa gán chứa `dinhDanh` (nếu có), dài nhất.
 * Không có rào nào và bài chỉ có MỘT tệp ⇒ cả câu trả lời là tệp ấy (như `codegen-chay-duoc/cham.mjs`).
 * Khối `<think>…</think>` bị bỏ trước khi trích.
 */
const RE_RAO = /```([^\n`]*)\n([\s\S]*?)```/g;
const RE_DANH_DAU = /^\s*(?:\/\/|#|--|\/\*|<!--|;|')\s*(?:tệp|tep|file|tập tin|path)\s*[:：]\s*([^\s*]+?)\s*(?:\*\/|-->)?\s*$/i;

/** Biến thể không có chữ "tệp:" — dòng chú thích CHỈ gồm một đường (vd `// src/a.ts`, `# sol.py`). */
const RE_DANH_DAU_TRAN = /^\s*(?:\/\/|#|--|\/\*|<!--|;)\s*([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+)\s*(?:\*\/|-->)?\s*$/;

const chuanHoa =(p) => String(p).trim().replace(/^["'`*([]+|["'`*)\]:,.]+$/g, "").replace(/\\/g, "/").replace(/^\.\//, "");

function khopTep(ung, tepGiai) {
  const p = chuanHoa(ung);
  if (!p || !/[A-Za-z0-9_]\.[A-Za-z0-9]+$/.test(p)) return null;
  if (tepGiai.includes(p)) return p;
  const duoi = tepGiai.filter((t) => t.endsWith("/" + p) || p.endsWith("/" + t));
  return duoi.length === 1 ? duoi[0] : null;
}

/** Tìm một tệp cần giải được nhắc trong một đoạn chữ ngắn. */
function timTrongChu(chu, tepGiai) {
  const ungs = chu.match(/[A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+/g) ?? [];
  for (const u of ungs.reverse()) {
    const t = khopTep(u, tepGiai);
    if (t) return t;
  }
  return null;
}

export function boSuyNghi(text) {
  return String(text ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^[\s\S]*?<\/think>/, "");
}

/**
 * @param {string} text   câu trả lời của model
 * @param {{tepGiai:string[], dinhDanh?:string}} bai
 * @returns {{tep: Record<string,string>, thieu: string[], soKhoi: number, cach: Record<string,string>}}
 */
export function trichTep(text, bai) {
  const s = boSuyNghi(text);
  const { tepGiai } = bai;
  const khoi = [];
  for (const m of s.matchAll(RE_RAO)) {
    const truoc = s.slice(Math.max(0, m.index - 300), m.index).split(/\r?\n/).filter((l) => l.trim()).pop() ?? "";
    khoi.push({ info: m[1].trim(), than: m[2], truoc });
  }
  const tep = {};
  const cach = {};
  const daGan = new Set();
  khoi.forEach((k, i) => {
    const dong = k.than.split(/\r?\n/);
    const iDau = dong.findIndex((l) => l.trim() !== "");
    const md = iDau >= 0 ? dong[iDau].match(RE_DANH_DAU) ?? dong[iDau].match(RE_DANH_DAU_TRAN) : null;
    let t = md ? khopTep(md[1], tepGiai) : null;
    let than = k.than;
    if (t) { than = dong.slice(iDau + 1).join("\n"); cach[t] = "danh-dau"; }
    if (!t) {
      const tuInfo = k.info.split(/[\s:=]+/).map((x) => x.replace(/^title=/, "")).map((x) => khopTep(x, tepGiai)).find(Boolean);
      if (tuInfo) { t = tuInfo; cach[t] = "rao"; }
    }
    if (!t) {
      const tuTruoc = timTrongChu(k.truoc, tepGiai);
      if (tuTruoc) { t = tuTruoc; cach[t] = "dong-truoc"; }
    }
    if (t) { tep[t] = than; daGan.add(i); }
  });
  let thieu = tepGiai.filter((t) => !(t in tep));
  if (thieu.length === 1) {
    const con = khoi.map((k, i) => ({ ...k, i })).filter((k) => !daGan.has(k.i));
    const coDinhDanh = bai.dinhDanh ? con.filter((k) => k.than.includes(bai.dinhDanh)) : [];
    const ung = (coDinhDanh.length ? coDinhDanh : con).sort((a, b) => b.than.length - a.than.length)[0];
    if (ung) { tep[thieu[0]] = ung.than; cach[thieu[0]] = "khoi-con-lai"; }
    else if (khoi.length === 0 && tepGiai.length === 1 && s.trim()) { tep[thieu[0]] = s.trim(); cach[thieu[0]] = "ca-cau-tra-loi"; }
    thieu = tepGiai.filter((t) => !(t in tep));
  }
  return { tep, thieu, soKhoi: khoi.length, cach };
}

/** Tiền tố chú thích cho dòng đánh dấu theo đuôi tệp (để prompt chỉ đúng cú pháp chú thích). */
export function tienToChuThich(rel) {
  if (/\.(py|toml|ini|cfg|ya?ml|sh)$/.test(rel) || /CMakeLists\.txt$/.test(rel)) return "#";
  if (/\.sql$/.test(rel)) return "--";
  return "//";
}

/** Dựng một câu trả lời "giả" từ các tệp mẫu đúng định dạng yêu cầu — để kiểm thước ĐƯỜNG trích (a). */
export function dungCauTraLoiGia(tep) {
  return Object.entries(tep)
    .map(([rel, nd]) => `Tệp \`${rel}\`:\n\n\`\`\`\n${tienToChuThich(rel)} tệp: ${rel}\n${nd.replace(/\n$/, "")}\n\`\`\``)
    .join("\n\n");
}
