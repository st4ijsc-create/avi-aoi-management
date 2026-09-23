/**
 * B8 (kế hoạch AI Local 2026-09-22 §2) — CÂU THÔNG BÁO ba ngôn ngữ của nhánh lập trình (từ chối · thoái
 * hoá · lỗi model · khối sửa hỏng · tạo khung · tự trị · lô), tách NGUYÊN VĂN khỏi `aiLocalKnowledgeCoding.ts`.
 * Thuần: chỉ dựng chuỗi, không I/O. Đổi câu chữ ở đây = đổi thứ người dùng đọc ⇒ lưới luồng (stream tests)
 * vẫn là hợp đồng.
 */
import { TRAN_TEP_MOI_LO } from "./aiLocalTools/writeHandlers/applyDiffBatch";
/**
 * ★★★ doc 79 · TRỤC 1 (C) — cửa gọi model của TÁC NHÂN LẬP TRÌNH (persona + bộ cắt + bộ che + canh
 * thoái hoá + bóc khối mã). Xem `aiCodingAgent.ts` để biết vì sao nó KHÔNG nằm trong `services/ai/`.
 */
import { MOC_MO, MOC_TEP_KHUNG, TRAN_KY_TU_TEP_SUA, type MaKhoiHong, type MaManifestKhung } from "./aiCodingAgent";
import type { KbLanguage } from "./aiLocalKnowledgeService";
import type { LyDoKhongSinhMa } from "./aiLocalKnowledgeCoding";
import { TRAN_TEP_MOT_LUOT_SUA } from "./aiLocalKnowledgeCoding";


/**
 * ★ ĐƯỜNG NÓI THẬT KHI KHÔNG CÓ MODEL — cố ý GIỮ LẠI (doc 79 (A)).
 *
 * `lyDo` mở rộng câu chứ không thay nó: *"chưa rõ yêu cầu"* là SAI SỰ THẬT khi nguyên nhân là engine
 * chưa nạp được model. Người dùng cần biết mình phải làm gì khác nhau trong hai ca ấy.
 */
export function codingNoToolMessage(language: KbLanguage, lyDo?: LyDoKhongSinhMa): string {
  const them =
    lyDo === "model_offline"
      ? {
          vi: "\n\n⚠ Ngoài ra: **model sinh mã cục bộ chưa sẵn sàng** (engine GGUF chưa nạp được). Đây là lý do tôi không tự viết mã cho bạn lượt này — không phải vì câu hỏi sai.",
          en: "\n\n⚠ Also: the **local code model is not ready** (GGUF engine unavailable). That is why I did not write code for you this turn — not because your question was wrong.",
          zh: "\n\n⚠ 另外：**本地代码模型尚未就绪**（GGUF 引擎不可用）。这才是本轮我没有为你写代码的原因，而不是你的问题有误。",
        }
      : lyDo === "tat_co"
        ? {
            vi: "\n\n⚠ Ngoài ra: nhánh **sinh mã** đang TẮT bằng cờ `AI_CODING_GEN=0`.",
            en: "\n\n⚠ Also: the **code-generation** branch is disabled via `AI_CODING_GEN=0`.",
            zh: "\n\n⚠ 另外：**代码生成**分支已通过 `AI_CODING_GEN=0` 关闭。",
          }
        : { vi: "", en: "", zh: "" };
  if (language === "zh") {
    return "我不清楚你的编程请求。请指明**具体文件路径**（如 `server/routers.ts`）、**要搜索的符号**，或**要运行的命令**（如 `npm run check`、`dotnet test <路径>`、`node --test <路径>`）。" + them.zh;
  }
  if (language === "en") {
    return "I'm not sure what you want me to do in the repo. Name a **specific file path** (e.g. `server/routers.ts`), a **symbol to search for**, or a **command to run** (e.g. `npm run check`, `dotnet test <path>`, `node --test <path>`)." + them.en;
  }
  return "Chưa rõ yêu cầu lập trình. Hãy nêu một **đường dẫn tệp cụ thể** (vd `server/routers.ts`), một **ký hiệu cần tìm**, hoặc một **lệnh cần chạy** (vd `npm run check`, `dotnet test <đường>`, `node --test <đường>`)." + them.vi;
}

/** Model chạy nhưng đầu ra thoái hoá (vòng lặp) — với MÃ thì không cứu phần đầu, xem `rutChuCoCanh`. */
export function codingThoaiHoaMessage(language: KbLanguage, reason: string): string {
  const r = reason || "empty";
  if (language === "zh") return `本地模型的输出退化（${r}），已丢弃。这是真实故障，不是“没有想法”。请换一种说法或缩小请求范围后重试。`;
  if (language === "en") return `The local model's output degenerated (${r}) and was discarded. This is a real failure, not "no ideas". Rephrase or narrow the request and try again.`;
  return `Đầu ra của model cục bộ bị **thoái hoá** (${r}) nên đã bị BỎ. Đây là hỏng THẬT, không phải "AI không nghĩ ra gì" — với mã nguồn thì một phần đầu cứu được vẫn là mã hỏng, nên tôi không đưa nó cho bạn. Hãy diễn đạt lại hoặc thu hẹp yêu cầu.`;
}

/** Lượt gọi model NÉM — nói thẳng, không nuốt (bài học `runCodeModel` của G5-D). */
export function codingModelErrorMessage(language: KbLanguage, e: unknown): string {
  const chiTiet = e instanceof Error ? e.message : String(e);
  if (chiTiet.includes("CODING_PROMPT_REDACTED")) {
    if (language === "zh") return "拒绝提出修改：输入安全过滤器改写了文件内容，若继续，模型会把被遮蔽的字符串写回文件（静默损坏）。请检查 `AI_SAFETY_ENABLED`。";
    if (language === "en") return "Refusing to propose an edit: the input safety filter rewrote the file content. Continuing would write the redacted placeholder back into the file (silent corruption). Check `AI_SAFETY_ENABLED`.";
    return "TỪ CHỐI đề xuất sửa: bộ che an toàn đầu vào đã thay đổi nội dung tệp trước khi model nhìn thấy. Đi tiếp nghĩa là ghi chính chỗ CHE ấy đè lên mã thật — hỏng CÂM. Hãy xem cờ `AI_SAFETY_ENABLED`.";
  }
  if (language === "zh") return `本地模型调用失败：${chiTiet}。这是真实故障，不是“不清楚需求”。请查看服务器日志（以及 llama-server）。`;
  if (language === "en") return `The local model call FAILED: ${chiTiet}. This is a real failure, not "unclear request". Check the server log (and llama-server).`;
  return `Lượt gọi model cục bộ **HỎNG**: ${chiTiet}. Đây là hỏng THẬT, không phải "chưa rõ yêu cầu" — thử lại y nguyên sẽ hỏng y nguyên. Xem nhật ký máy chủ (và llama-server nếu đang bật).`;
}

/** Model trả lời nhưng KHÔNG có khối mã ⇒ không dựng được `modified` ⇒ không đề xuất ghi. */
export function codingKhongCoKhoiMaMessage(language: KbLanguage): string {
  if (language === "zh") return "⚠ 未提出写入：模型的回答中没有代码块，因此无法构造完整的新文件内容。宁可不改，也不猜。";
  if (language === "en") return "⚠ No write proposed: the model's answer contains no code block, so the full new file content could not be built. Refusing to guess.";
  return "⚠ KHÔNG đề xuất ghi: câu trả lời của model không có khối mã nào nên tôi không dựng được nội dung tệp mới đầy đủ. Thà không sửa còn hơn đoán.";
}

/**
 * ★★★ doc 79 (2026-08-21) — **KHỐI SỬA HỎNG.** Hai kết cục, và câu chữ phải phân biệt được chúng:
 * còn ĐƯỜNG LÙI (tệp đủ nhỏ để chép lại cả tệp) hay ĐÃ HẾT ĐƯỜNG.
 *
 * ⚠ Câu này luôn nêu **mã** + **đích danh đoạn neo**. Lỗi mà lượt trước để lại là một lời từ chối
 *   KHÔNG nói được nó từ chối cái gì; người dùng chỉ thấy mình chờ 45 giây rồi không có gì. Ba mã
 *   nhập nhằng (`NEO_KHONG_THAY` · `NEO_NHIEU_CHO` · `NEO_RONG`) dẫn tới **ba việc khác nhau** người
 *   dùng phải làm, nên chúng không được gộp thành một câu chung.
 */
export function codingKhoiHongMessage(
  language: KbLanguage,
  relPath: string,
  ma: MaKhoiHong,
  chiTiet: string,
  luiDuoc: boolean,
): string {
  const vi: Record<MaKhoiHong, string> = {
    KHONG_CO_KHOI: `model không phát ra khối sửa nào (không có dòng mốc \`${MOC_MO}\`)`,
    KHOI_CUT: `khối sửa bị CẮT giữa chừng — ${chiTiet}. Đây là dấu hiệu đầu ra chạm trần token`,
    KHOI_MO_HO: `khối sửa không rõ ranh giới — ${chiTiet}`,
    NEO_RONG: `đoạn neo RỖNG (${chiTiet}) — một đoạn neo rỗng "khớp" ở mọi vị trí nên không xác định được chỗ nào`,
    NEO_KHONG_THAY: `KHÔNG tìm thấy đoạn neo trong tệp — ${chiTiet}. Model đang chép lại một đoạn không có ở đó`,
    NEO_NHIEU_CHO: `đoạn neo trùng ở NHIỀU CHỖ — ${chiTiet}. Tôi TỪ CHỐI thay vì đoán "chắc là chỗ đầu tiên": đoán ở đây là ghi đè nhầm chỗ trong im lặng`,
    KHOI_KHONG_DOI: `các khối áp xong mà tệp không đổi (${chiTiet})`,
  };
  const en: Record<MaKhoiHong, string> = {
    KHONG_CO_KHOI: `the model produced no edit block (no \`${MOC_MO}\` marker line)`,
    KHOI_CUT: `an edit block was CUT OFF — ${chiTiet}. That is the signature of hitting the output token cap`,
    KHOI_MO_HO: `an edit block has ambiguous boundaries — ${chiTiet}`,
    NEO_RONG: `the anchor is EMPTY (${chiTiet}) — an empty anchor "matches" everywhere, so no position can be determined`,
    NEO_KHONG_THAY: `the anchor was NOT found in the file — ${chiTiet}. The model copied text that is not there`,
    NEO_NHIEU_CHO: `the anchor matches MULTIPLE places — ${chiTiet}. Refusing rather than assuming "probably the first one": guessing here means overwriting the wrong place silently`,
    KHOI_KHONG_DOI: `the blocks applied cleanly but changed nothing (${chiTiet})`,
  };
  const zh: Record<MaKhoiHong, string> = {
    KHONG_CO_KHOI: `模型未产生任何修改块（没有 \`${MOC_MO}\` 标记行）`,
    KHOI_CUT: `修改块被截断——${chiTiet}。这是输出触达 token 上限的特征`,
    KHOI_MO_HO: `修改块边界不明确——${chiTiet}`,
    NEO_RONG: `锚点为空（${chiTiet}）——空锚点在任何位置都“匹配”，无法确定位置`,
    NEO_KHONG_THAY: `文件中找不到锚点——${chiTiet}。模型抄录了并不存在的片段`,
    NEO_NHIEU_CHO: `锚点匹配到多处——${chiTiet}。我拒绝而不是假定“大概是第一处”：在这里猜测等于静默改错地方`,
    KHOI_KHONG_DOI: `所有块都应用了，但文件没有变化（${chiTiet}）`,
  };
  if (language === "zh") {
    return luiDuoc
      ? `⚠ 基于块的修改未成功（"${relPath}"）：${zh[ma]}。该文件足够小，可以整文件重写——正在重试一次（会再花一次模型调用）。`
      : `⛔ 未提出写入（"${relPath}"）：${zh[ma]}。该文件太大，无法退回整文件重写（会超出输出 token 上限），所以这里没有可用的退路。请指明要改的函数或片段，或把文件拆小。`;
  }
  if (language === "en") {
    return luiDuoc
      ? `⚠ The block edit did not succeed on "${relPath}": ${en[ma]}. The file is small enough for a whole-file rewrite — retrying that once (costs one more model call).`
      : `⛔ No write proposed for "${relPath}": ${en[ma]}. The file is too large to fall back to a whole-file rewrite (it would exceed the output token cap), so there is no fallback here. Name the function or snippet to change, or split the file.`;
  }
  return luiDuoc
    ? `⚠ Lượt sửa THEO KHỐI không thành trên "${relPath}": ${vi[ma]}. Tệp này đủ nhỏ để chép lại cả tệp — tôi đang thử lại theo đường đó (tốn thêm một lượt gọi model).`
    : `⛔ KHÔNG đề xuất ghi cho "${relPath}": ${vi[ma]}. Tệp quá lớn để lùi về đường chép-cả-tệp (sẽ vượt trần token ĐẦU RA nên bản chép sẽ bị cắt cụt), nên ở đây KHÔNG có đường lùi nào. Hãy nêu rõ hàm/đoạn cần sửa, hoặc tách nhỏ tệp.`;
}

/** Model trả lại đúng tệp cũ — không phải sự cố, chỉ là không có gì để áp. */
export function codingKhongDoiMessage(language: KbLanguage, relPath: string): string {
  if (language === "zh") return `⚠ 未提出写入：模型返回的内容与 "${relPath}" 当前内容完全一致。`;
  if (language === "en") return `⚠ No write proposed: the model returned content identical to the current "${relPath}".`;
  return `⚠ KHÔNG đề xuất ghi: nội dung model trả về GIỐNG HỆT tệp "${relPath}" hiện tại.`;
}

/**
 * ★ doc 79 (2026-08-20) — tệp KHÔNG tồn tại và người dùng KHÔNG xin tạo. Hành vi cũ (nói NOT_FOUND)
 * giữ nguyên; thêm đúng một câu chỉ ra rằng TẠO là một việc làm được — vì trước lượt này nó KHÔNG
 * làm được, nên người dùng không có lý do gì để đoán rằng nay nó làm được.
 */
export function codingGoiYTaoTepMessage(language: KbLanguage, duong: string): string {
  if (language === "zh") return `如果你本来就想**新建**该文件，请直接说：「创建新文件 ${duong} …（需求）」。我会先确认它确实不存在，再提出一份完整内容供你审批。`;
  if (language === "en") return `If you meant to **create** it, say: "create a new file ${duong} … (what it should do)". I will verify it really does not exist, then propose the full content for your approval.`;
  return `Nếu bạn muốn **TẠO** tệp này, hãy nói thẳng: *"tạo file mới ${duong} … (làm gì)"*. Tôi sẽ kiểm chắc chắn tệp chưa tồn tại rồi đề xuất toàn bộ nội dung để bạn duyệt.`;
}

/**
 * ★★ doc 79 (2026-08-20) — xin TẠO nhưng tệp **ĐÃ CÓ**. Từ chối TƯỜNG MINH, không âm thầm biến
 * thành ghi đè: một lượt "tạo" trên tệp có sẵn mà cứ thế chạy tiếp nghĩa là gửi `original:""` cho
 * một tệp có nội dung, tức đề xuất **xoá sạch rồi ghi lại**. `apply_diff` sẽ chặn bằng
 * `BASE_MISMATCH`, nhưng đó là một câu đúng mà khó hiểu — người dùng cần biết chuyện gì đã xảy ra.
 */
export function codingTepDaTonTaiMessage(language: KbLanguage, relPath: string): string {
  if (language === "zh") return `⚠ 未提出写入：文件 "${relPath}" **已存在**，因此这不是一次“新建”。我不会把新建悄悄变成覆盖（那等于先清空再重写）。如果你确实要改它，请说「修改 ${relPath} …」；如果要另建一个文件，请换一个路径。`;
  if (language === "en") return `⚠ No write proposed: "${relPath}" **already exists**, so this is not a CREATE. I will not silently turn a create into an overwrite (that would mean wiping the file and rewriting it). To change it, say "edit ${relPath} …"; to create a different file, pick another path.`;
  return `⚠ KHÔNG đề xuất ghi: tệp "${relPath}" **ĐÃ TỒN TẠI**, nên đây không phải một lượt TẠO. Tôi KHÔNG âm thầm biến một lượt tạo thành ghi đè — làm vậy nghĩa là xoá sạch tệp rồi viết lại. Muốn đổi nội dung thì nói *"sửa ${relPath} …"*; muốn tạo tệp khác thì chọn đường dẫn khác.`;
}

/** ★ Lô vượt trần số tệp một lượt — nói THẲNG con số, không âm thầm cắt bớt danh sách người dùng gõ. */
export function codingQuaNhieuTepMessage(language: KbLanguage, soTep: number): string {
  if (language === "zh") return `⚠ 一次最多处理 ${TRAN_TEP_MOT_LUOT_SUA} 个文件，你列出了 ${soTep} 个。每个文件都要单独调用一次本地模型（约 30 秒），因此这是**时间**上限而非 token 上限。请分批提出。我不会悄悄截断你的列表。`;
  if (language === "en") return `⚠ At most ${TRAN_TEP_MOT_LUOT_SUA} files per turn; you listed ${soTep}. Each file costs one local-model call (~30 s), so this is a TIME cap, not a token cap. Split the request. I will not silently truncate your list.`;
  return `⚠ Một lượt chỉ xử lý tối đa **${TRAN_TEP_MOT_LUOT_SUA} tệp**, bạn nêu ${soTep}. Mỗi tệp tốn MỘT lượt gọi model cục bộ (~30 giây) nên đây là trần **THỜI GIAN**, không phải trần token. Hãy chia thành nhiều lượt — tôi KHÔNG âm thầm cắt bớt danh sách bạn đã gõ.`;
}

/** ★ Tiêu đề mỗi tệp trong một lô — đi vào `content` của phiên, nên nó sống sót khi mở lại phiên. */
export function codingTieuDeTepMessage(language: KbLanguage, i: number, n: number, duong: string): string {
  if (language === "zh") return `### 文件 ${i}/${n} — \`${duong}\``;
  if (language === "en") return `### File ${i}/${n} — \`${duong}\``;
  return `### Tệp ${i}/${n} — \`${duong}\``;
}

/** ★ Lô dừng giữa chừng: nói rõ tệp nào chặn và **không có đề xuất nào được đưa ra**. */
export function codingLoDungMessage(language: KbLanguage, relPath: string, daXong: number): string {
  if (language === "zh") return `⛔ 整批已停止在 "${relPath}"，**未提出任何写入**（此前已准备好 ${daXong} 个文件的改动，一并丢弃）。只改一部分会留下无法编译的代码树，所以要么全改，要么不改。`;
  if (language === "en") return `⛔ The whole batch stopped at "${relPath}" and **no write was proposed** (${daXong} already-prepared edits were discarded with it). A partial rename leaves a tree that does not compile — all or nothing.`;
  return `⛔ CẢ LÔ dừng ở "${relPath}" và **KHÔNG có đề xuất ghi nào** (${daXong} bản sửa đã chuẩn bị trước đó cũng bị bỏ theo). Sửa một phần sẽ để lại cây mã không biên dịch được — nên hoặc đổi hết, hoặc không đổi gì.`;
}

/** ★ Lô chạy hết nhưng không tệp nào đổi — không phải sự cố. */
export function codingLoKhongDoiMessage(language: KbLanguage, khongDoi: readonly string[]): string {
  const ds = khongDoi.join(", ");
  if (language === "zh") return `⚠ 未提出写入：模型对所有文件返回的内容都与当前一致（${ds}）。`;
  if (language === "en") return `⚠ No write proposed: the model returned content identical to the current one for every file (${ds}).`;
  return `⚠ KHÔNG đề xuất ghi: model trả về nội dung GIỐNG HỆT bản hiện tại cho mọi tệp (${ds}).`;
}

/**
 * ★★★ 2026-08-24 — MANIFEST KHUNG HỎNG ⇒ **FAIL-SAFE VỀ CÂU TRẢ LỜI THƯỜNG**, không đề xuất gì.
 * Chữ model đã stream cho người đọc rồi; câu này chỉ nói thật vì sao không có thẻ duyệt, kèm mã +
 * chi tiết máy-đọc-được để lượt sau (người hoặc lưới) hành động được.
 */
/**
 * ★ Thông báo NGƯỜI DÙNG thấy khi lượt tự-sửa khởi động — nói thật đang làm gì và vì sao, kèm
 * nguyên văn lỗi để người chờ không mù (một lượt 30B ~vài phút).
 */
/**
 * ★ Tệp phạm chính sách nhưng KHÔNG ai tham chiếu ⇒ bị LOẠI khỏi lô, và câu này là lời khai —
 * loại ÂM THẦM là một kiểu cắt bớt nói dối, đúng lớp "không silent-truncation" của repo.
 */
/**
 * ★★★ 2026-08-24 — Câu NOTE khi khung tới từ `dotnet new` (khung CHUẨN Microsoft), KHÔNG từ model.
 * Nói THẬT: dùng template gì, tên dự án gì, đã bỏ sản phẩm dựng (obj/bin) + tài nguyên nhị phân.
 * Khi khung có `<PackageReference>` (đo bằng `coPackageReference`) ⇒ KHAI hai chế độ NuGet: máy
 * OFFLINE tự tải + chép local feed TRƯỚC khi build · máy CÓ INTERNET `dotnet restore` kéo bình thường
 * — khớp công tắc `DOTNET_CHO_PHEP_RESTORE` ở `repoCommandSandbox`, và cùng lời khai persona model.
 */
export function codingKhungDotnetMessage(language: KbLanguage, template: string, slug: string, coNuGet: boolean): string {
  if (language === "zh") {
    const nuGet = coNuGet
      ? `\n\n⚠ 骨架含 \`PackageReference\`（NuGet）。离线机器：构建前自行下载包并复制到本地 NuGet 源；联网机器：\`dotnet restore\` 可正常拉取。`
      : "";
    return `✓ 已用标准模板 \`dotnet new ${template}\`（微软官方骨架）生成项目「${slug}」，并剔除构建产物（obj/ bin/）与白名单之外的文件（二进制/资源）。请逐个文件审批下面的写入。${nuGet}`;
  }
  if (language === "en") {
    const nuGet = coNuGet
      ? `\n\n⚠ The skeleton has \`PackageReference\` (NuGet). OFFLINE machine: download the packages and copy them into a local NuGet feed BEFORE building; machine WITH internet: \`dotnet restore\` fetches them normally.`
      : "";
    return `✓ Used \`dotnet new ${template}\` (Microsoft's standard skeleton) to scaffold project "${slug}", with build artifacts (obj/ bin/) and non-whitelisted files (binary/assets) removed. Review each file write below.${nuGet}`;
  }
  const nuGet = coNuGet
    ? `\n\n⚠ Khung có \`PackageReference\` (NuGet). Máy OFFLINE: tự tải package và chép vào local NuGet feed TRƯỚC khi build; máy CÓ INTERNET: \`dotnet restore\` kéo về bình thường.`
    : "";
  return `✓ Đã dùng khung CHUẨN \`dotnet new ${template}\` (Microsoft) để dựng dự án "${slug}", đã bỏ sản phẩm dựng (obj/ bin/) và tệp ngoài danh sách nguồn (nhị phân/tài nguyên). Duyệt từng tệp bên dưới.${nuGet}`;
}

export function codingKhungLoaiTepMessage(language: KbLanguage, tepLoai: string[], conLai: number): string {
  const ds = tepLoai.join(", ");
  if (language === "zh")
    return `⚠ 已从骨架中剔除 ${tepLoai.length} 个白名单外的文件（清单中无其他文件引用它）：${ds}。其余 ${conLai} 个文件照常提交审批。`;
  if (language === "en")
    return `⚠ Dropped ${tepLoai.length} file(s) outside the whitelist (nothing else in the manifest references them): ${ds}. The remaining ${conLai} file(s) proceed to approval as usual.`;
  return `⚠ Đã LOẠI ${tepLoai.length} tệp ngoài danh sách trắng (không tệp nào khác trong manifest tham chiếu tới): ${ds}. ${conLai} tệp còn lại vẫn được đề xuất duyệt như thường.`;
}

export function codingKhungTuSuaThongBao(language: KbLanguage, cauLoi: string): string {
  if (language === "zh") return `⚠ 首版清单被拒绝：${cauLoi}\n→ 正在自动让模型重出一版干净的骨架（仅重试一次）…`;
  if (language === "en") return `⚠ First manifest refused: ${cauLoi}\n→ Automatically asking the model for a clean skeleton (single retry)…`;
  return `⚠ Manifest lượt đầu bị từ chối: ${cauLoi}\n→ Đang tự yêu cầu model xuất lại khung sạch (đúng MỘT lượt tự sửa)…`;
}

/**
 * ★ Câu hỏi của LƯỢT TỰ SỬA — câu gốc + nguyên văn lỗi + mệnh lệnh sửa. Lỗi là chữ do CHÍNH server
 * sinh (không phải dữ liệu ngoài) nên đứng thẳng trong ô yêu cầu được.
 */
export function codingKhungCauTuSua(language: KbLanguage, question: string, cauLoi: string): string {
  if (language === "zh")
    return `${question}\n\n[上一轮错误 — 必须修复] ${cauLoi}\n重新输出完整骨架（所有文件，同样的 ${MOC_TEP_KHUNG} 格式）；彻底去掉违规文件，并删除其他文件（csproj、XAML…）中对它的一切引用。`;
  if (language === "en")
    return `${question}\n\n[PREVIOUS-TURN ERROR — MUST FIX] ${cauLoi}\nRe-emit the FULL skeleton (every file, same ${MOC_TEP_KHUNG} format); drop the offending file entirely and remove every reference to it in the other files (csproj, XAML…).`;
  return `${question}\n\n[LỖI LƯỢT TRƯỚC — BẮT BUỘC SỬA] ${cauLoi}\nXuất lại TOÀN BỘ khung (mọi tệp, đúng khuôn ${MOC_TEP_KHUNG}); BỎ HẲN tệp phạm quy và xoá MỌI tham chiếu tới nó trong các tệp khác (csproj, XAML…).`;
}

export function codingKhungHongMessage(language: KbLanguage, ma: MaManifestKhung, chiTiet: string): string {
  const viMa: Record<MaManifestKhung, string> = {
    KHONG_CO_TEP: `không có dòng "${MOC_TEP_KHUNG}" nào — model trả lời văn xuôi thay vì manifest`,
    TEP_KHONG_DUONG: `một dòng tiêu đề tệp không có đường dẫn (${chiTiet})`,
    TEP_THIEU_KHOI: `tệp "${chiTiet}" khai tên mà không có khối mã nội dung`,
    TEP_RONG: `tệp "${chiTiet}" có khối mã RỖNG — tạo tệp rỗng là vô nghĩa`,
    TEP_TRUNG: `cùng một đường khai HAI LẦN: ${chiTiet}`,
  };
  const enMa: Record<MaManifestKhung, string> = {
    KHONG_CO_TEP: `no "${MOC_TEP_KHUNG}" line at all — the model answered in prose instead of a manifest`,
    TEP_KHONG_DUONG: `a file header line carries no path (${chiTiet})`,
    TEP_THIEU_KHOI: `file "${chiTiet}" is named but has no content code block`,
    TEP_RONG: `file "${chiTiet}" has an EMPTY code block — creating an empty file is pointless`,
    TEP_TRUNG: `the same path is declared TWICE: ${chiTiet}`,
  };
  const zhMa: Record<MaManifestKhung, string> = {
    KHONG_CO_TEP: `完全没有 "${MOC_TEP_KHUNG}" 行——模型用散文作答而不是清单`,
    TEP_KHONG_DUONG: `某个文件标题行没有路径（${chiTiet}）`,
    TEP_THIEU_KHOI: `文件 "${chiTiet}" 只有名字，没有内容代码块`,
    TEP_RONG: `文件 "${chiTiet}" 的代码块为空——创建空文件没有意义`,
    TEP_TRUNG: `同一路径声明了两次：${chiTiet}`,
  };
  if (language === "zh") return `⚠ 未提出写入 [${ma}]：${zhMa[ma]}。上面的回答保留为普通回答；请再说一次「创建项目 …」重试。`;
  if (language === "en") return `⚠ No write proposed [${ma}]: ${enMa[ma]}. The answer above stands as a plain answer; say "create a project …" again to retry.`;
  return `⚠ KHÔNG đề xuất ghi [${ma}]: ${viMa[ma]}. Câu trả lời phía trên giữ nguyên như một câu trả lời thường; gõ lại *"tạo dự án …"* để thử lượt khác.`;
}

/** ★ Khung vượt trần số tệp của MỘT thẻ duyệt — nói thẳng con số, không âm thầm cắt bớt. */
export function codingKhungQuaTranMessage(language: KbLanguage, soTep: number): string {
  if (language === "zh") return `⚠ 未提出写入：骨架有 ${soTep} 个文件，超过一张审批卡的上限 ${TRAN_TEP_MOI_LO}。请要求“最小骨架”（入口 + 项目文件 + 1–2 个核心文件），其余留到下一轮。我不会悄悄截断清单。`;
  if (language === "en") return `⚠ No write proposed: the skeleton has ${soTep} files, above the ${TRAN_TEP_MOI_LO}-file cap of ONE approval card. Ask for a "minimal skeleton" (entry point + project file + 1–2 core files) and add the rest next turn. I will not silently truncate the list.`;
  return `⚠ KHÔNG đề xuất ghi: khung có ${soTep} tệp, vượt trần **${TRAN_TEP_MOI_LO} tệp** của MỘT thẻ duyệt. Hãy yêu cầu *"khung tối thiểu"* (điểm vào + tệp dự án + 1–2 tệp lõi), phần còn lại để lượt sau — tôi KHÔNG âm thầm cắt bớt danh sách.`;
}

/**
 * ★★★ Khung bị TỪ CHỐI CẢ LÔ ở tầng hậu kiểm — ba lý do, mỗi lý do một hành động khác của người
 * dùng, và luôn LIỆT KÊ ĐÍCH DANH tệp phạm (một lời từ chối không nêu được nó từ chối cái gì là
 * lớp lỗi đã trả giá ở đường sửa-theo-khối).
 */
export function codingKhungTuChoiMessage(
  language: KbLanguage,
  ma: "TEP_DA_TON_TAI" | "DUONG_KHONG_HOP_LE" | "KHONG_KIEM_DUOC",
  danhSach: readonly string[],
): string {
  const ds = danhSach.join(", ");
  if (ma === "TEP_DA_TON_TAI") {
    if (language === "zh") return `⛔ 整个骨架被拒绝 [TEP_DA_TON_TAI]：以下文件**已存在**：${ds}。半套骨架比没有更糟，所以一个文件已存在就拒绝整批——没有任何字节被写入。要修改现有文件请说「修改 <文件>: …」；要新建骨架请选一个空目录。`;
    if (language === "en") return `⛔ The whole skeleton was refused [TEP_DA_TON_TAI]: these files ALREADY EXIST: ${ds}. A half-scaffold is worse than none, so one existing file refuses the whole batch — nothing was written. To edit an existing file say "edit <file>: …"; to scaffold, pick an empty folder.`;
    return `⛔ TỪ CHỐI CẢ KHUNG [TEP_DA_TON_TAI]: các tệp sau **ĐÃ TỒN TẠI**: ${ds}. Một khung dự án nửa vời tệ hơn không có, nên chỉ cần MỘT tệp đã tồn tại là cả lô bị từ chối — chưa một byte nào được ghi. Muốn sửa tệp đang có, nói *"sửa <tệp>: …"*; muốn dựng khung, chọn một thư mục trống.`;
  }
  if (ma === "DUONG_KHONG_HOP_LE") {
    if (language === "zh") return `⛔ 整个骨架被拒绝 [DUONG_KHONG_HOP_LE]：以下路径未通过沙箱策略（绝对路径 / ".." / 盘符 / 受禁目录 / 扩展名不在白名单）：${ds}。未写入任何字节。`;
    if (language === "en") return `⛔ The whole skeleton was refused [DUONG_KHONG_HOP_LE]: these paths failed the sandbox policy (absolute / ".." / drive letter / denied dir / extension outside the whitelist): ${ds}. Nothing was written.`;
    return `⛔ TỪ CHỐI CẢ KHUNG [DUONG_KHONG_HOP_LE]: các đường sau không qua được chính sách hộp cát (tuyệt đối / \`..\` / ổ đĩa / thư mục cấm / đuôi ngoài danh sách trắng): ${ds}. Chưa một byte nào được ghi.`;
  }
  if (language === "zh") return `⛔ 整个骨架被拒绝 [KHONG_KIEM_DUOC]：无法证明以下文件不存在：${ds}。无法证明就不写（fail-closed）。`;
  if (language === "en") return `⛔ The whole skeleton was refused [KHONG_KIEM_DUOC]: could not prove these files do not exist: ${ds}. Cannot prove ⇒ do not write (fail-closed).`;
  return `⛔ TỪ CHỐI CẢ KHUNG [KHONG_KIEM_DUOC]: không chứng minh được các tệp sau CHƯA tồn tại: ${ds}. Không chứng minh được thì không ghi (fail-closed).`;
}

/** ★ Lượt TẠO mà model không cho ra nội dung nào — khác hẳn "giống hệt tệp cũ" (không có tệp cũ). */
export function codingTaoRongMessage(language: KbLanguage, relPath: string): string {
  if (language === "zh") return `⚠ 未提出写入：模型为新文件 "${relPath}" 返回的内容为空。创建一个空文件没有意义，故拒绝。`;
  if (language === "en") return `⚠ No write proposed: the model returned EMPTY content for the new file "${relPath}". Creating an empty file is not useful — refusing.`;
  return `⚠ KHÔNG đề xuất ghi: model trả về nội dung RỖNG cho tệp mới "${relPath}". Tạo một tệp rỗng thì vô nghĩa nên tôi từ chối.`;
}

/** Ba lý do fail-closed của nhánh sửa — mỗi lý do một việc khác nhau người dùng phải làm. */
export function codingKhongTuSuaMessage(
  language: KbLanguage,
  relPath: string,
  ly: "NO_CONTENT" | "TRUNCATED" | "REDACTED" | "TOO_LARGE" | "NGAN_SACH",
): string {
  const vi: Record<typeof ly, string> = {
    NO_CONTENT: `Đọc được "${relPath}" nhưng không có nội dung để sửa.`,
    TRUNCATED: `Tôi chỉ đọc được MỘT PHẦN "${relPath}" (chạm trần byte). Sửa một tệp mà chỉ nhìn nửa đầu là đoán mò, và diff dựng từ đó chắc chắn bị từ chối vì lệch băm. Hãy thu hẹp phạm vi hoặc tăng trần byte.`,
    REDACTED: `Nội dung "${relPath}" có chuỗi trông như BÍ MẬT nên đã bị che khi đọc. Nếu tôi sửa từ bản đã che thì chỗ che sẽ được ghi ĐÈ lên mã thật — hỏng CÂM. TỪ CHỐI sửa tệp này; hãy sửa tay.`,
    TOO_LARGE: `Tệp "${relPath}" quá lớn (> ${TRAN_KY_TU_TEP_SUA} ký tự) để đưa trọn vào một lượt sửa. Hãy tách tệp hoặc nêu rõ hàm cần sửa để tôi đọc/giải thích thay vì ghi đè cả tệp.`,
    NGAN_SACH: `Tệp "${relPath}" lọt trần ký tự nhưng KHÔNG lọt **ngân sách ngữ cảnh** của model: nội dung tệp cộng phần dành cho câu trả lời đã vượt trần token mỗi slot. Đây KHÔNG phải do lịch sử hội thoại — lịch sử đã bị bỏ hết mà vẫn không đủ chỗ. Hãy tách tệp, hoặc nêu rõ hàm cần sửa để tôi đọc/giải thích thay vì ghi đè cả tệp.`,
  };
  const en: Record<typeof ly, string> = {
    NO_CONTENT: `Read "${relPath}" but there is no content to edit.`,
    TRUNCATED: `I could only read PART of "${relPath}" (byte cap). Editing from a partial view is guessing, and the resulting diff would be rejected on a hash mismatch.`,
    REDACTED: `"${relPath}" contains a secret-looking string that was redacted on read. Editing from the redacted copy would write the placeholder over real code (silent corruption). Refusing.`,
    TOO_LARGE: `"${relPath}" is too large (> ${TRAN_KY_TU_TEP_SUA} chars) for a whole-file edit. Split it, or name the function so I can read/explain instead of overwriting.`,
    NGAN_SACH: `"${relPath}" is under the character cap but does NOT fit the model's CONTEXT BUDGET: the file plus the reserved answer tokens exceed the per-slot limit. This is not caused by conversation history — history was dropped entirely and it still does not fit. Split the file, or name the function so I can read/explain instead of overwriting.`,
  };
  const zh: Record<typeof ly, string> = {
    NO_CONTENT: `已读取 "${relPath}"，但没有可编辑的内容。`,
    TRUNCATED: `只读到 "${relPath}" 的一部分（字节上限）。基于片段修改等于猜测，生成的 diff 也会因哈希不匹配被拒绝。`,
    REDACTED: `"${relPath}" 含有疑似密钥的字符串，读取时已被遮蔽。基于遮蔽副本修改会把占位符写回真实代码（静默损坏），故拒绝。`,
    TOO_LARGE: `"${relPath}" 太大（> ${TRAN_KY_TU_TEP_SUA} 字符），无法整文件修改。请拆分文件，或指明要改的函数。`,
    NGAN_SACH: `"${relPath}" 未超字符上限，但超出模型的**上下文预算**：文件内容加上预留的回答 token 已超过每个 slot 的上限。这与对话历史无关——历史已被全部丢弃仍不够。请拆分文件，或指明要改的函数。`,
  };
  return language === "en" ? en[ly] : language === "zh" ? zh[ly] : vi[ly];
}

/** ★ doc 79 TRỤC 2 — id dự án không nằm trong danh sách trắng (id lạ / client gửi đường dẫn). */
export function codingProjectDeniedMessage(language: KbLanguage, projectId: unknown): string {
  const id = typeof projectId === "string" ? projectId : String(projectId ?? "");
  if (language === "zh") {
    return `所选项目（\`${id}\`）不在允许列表中。请从项目选择器中选择一个有效项目——客户端只发送项目 **ID**，服务器在 \`AI_REPO_SANDBOX_ROOTS\` 白名单中解析路径；不接受任意路径。`;
  }
  if (language === "en") {
    return `The selected project (\`${id}\`) is not in the allowlist. Pick a valid project from the selector — the client sends only a project **ID**, and the server resolves the path from the \`AI_REPO_SANDBOX_ROOTS\` whitelist; arbitrary paths are never accepted.`;
  }
  return `Dự án đang chọn (\`${id}\`) KHÔNG nằm trong danh sách cho phép. Hãy chọn một dự án hợp lệ ở bộ chọn — client chỉ gửi **id** dự án, server tra đường dẫn trong danh sách TRẮNG \`AI_REPO_SANDBOX_ROOTS\`; đường dẫn tự do KHÔNG bao giờ được chấp nhận.`;
}

export function codingErrorMessage(language: KbLanguage, toolName: string | null, error: string): string {
  const t = toolName ?? "?";
  if (language === "zh") return `工具 \`${t}\` 执行出错：${error}。这是真实的执行错误，不是政策拒绝。`;
  if (language === "en") return `Tool \`${t}\` failed: ${error}. This is a real execution error, not a policy refusal.`;
  return `Tool \`${t}\` gặp lỗi khi chạy: ${error}. Đây là lỗi thực thi THẬT, không phải một lượt từ chối vì chính sách.`;
}
