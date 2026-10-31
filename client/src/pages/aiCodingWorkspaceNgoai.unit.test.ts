/**
 * Đợt 10.4b (L2) — LƯỚI NGUỒN của màn lập trình với MODEL NGOÀI (cùng kiểu các lưới `aiCodingWorkspace*.unit.test.ts`: trang 3,8 k dòng không dựng DOM được,
 * nên các BẤT BIẾN an toàn được canh bằng văn bản mã đã bỏ chú thích; hành vi thật do e2e `ai-coding-hoi-ngoai-ky-su.spec.ts` canh).
 * Đột biến: bỏ bất kỳ dòng nào dưới đây ⇒ ít nhất một ca đỏ.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = resolve(__dirname, "../../..");
const bo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const ma = bo(readFileSync(join(GOC, "client/src/pages/AICodingWorkspace.tsx"), "utf8"));
const demLanXuatHien = (chuoi: string) => ma.split(chuoi).length - 1;

describe("AICodingWorkspace — model ngoài chỉ ở chế độ HỎI", () => {
  it("laNgoai suy từ mã chọn model; chế độ hiệu lực bị ép về 'hoi' và ô chọn chế độ bị khoá", () => {
    expect(ma).toContain('const laNgoai = chonModel !== "auto" && tachMaNgoai(chonModel) !== null;');
    expect(ma).toContain('const cheDoChatHL: CheDoChat = laNgoai ? "hoi" : cheDoChat;');
    expect(ma).toContain("giaTri={cheDoChatHL}");
    expect(ma).toContain("khoa={agentDangChay || isStreaming || laNgoai}");
    // (11.8) chỉ báo hàng chờ model theo chế độ HIỆU LỰC: model ngoài (chỉ Hỏi) ⇒ tắt; chỉ ở chế độ agent, chưa có lượt chạy, không đang stream
    expect(ma).toContain('<ChiBaoHangCho bat={cheDoChatHL !== "hoi" && !agentDangChay && !isStreaming && !!projectId} />');
  });

  it("đường AGENT không bao giờ chạy khi chọn model ngoài; vòng tự sửa test / ghim tệp sửa bị chặn", () => {
    expect(ma).toContain('if (!laNgoai && cheDoChat !== "hoi" && !tuVong) {');
    expect(ma).toMatch(/if \(laNgoai && tuVong\) \{\s*dungVong\("nguoi_tu_choi"\);\s*return;\s*\}/);
  });

  it("đầu ra lệnh (máy) bị loại khỏi lịch sử gửi ra ngoài", () => {
    expect(ma).toContain('transcript.filter((x) => !(laNgoai && x.nguon === "dau-ra-lenh"))');
  });

  it("phienId / xacNhanVanHanh chỉ đi khi laNgoai; xác nhận vận hành do NGƯỜI (hộp), gửi lại đúng MỘT lần", () => {
    expect(ma).toContain("...(laNgoai ? { ...(sessionIdRef.current ? { phienId: sessionIdRef.current } : {}), ...(xacNhanVH ? { xacNhanVanHanh: true } : {}) } : {})");
    expect(ma).toContain("loiNgoaiRef.current?.canXacNhanVanHanh");
    expect(ma).toContain("await hoiVanHanh(khoaPhien(), chonModel)");
    // đúng hai chỗ gọi goiStream: lần đầu + MỘT lần gửi lại sau xác nhận (không vòng)
    expect(demLanXuatHien("await goiStream(")).toBe(2);
  });

  it("lỗi ngoài: bỏ lượt người dùng vừa thêm, trả câu về ô nhập, nói đúng lý do — không thành lượt 'luồng lỗi' lưu vào phiên", () => {
    expect(ma).toMatch(/else if \(laNgoai && !abortedRef\.current\) \{[\s\S]*?setTranscript\(\(prev\) => prev\.slice\(0, -1\)\);\s*setInput\(text\);[\s\S]*?thongDiepLoiNgoai\(l\.code, l\.tranVuot\)/);
  });

  it("câu trả lời ngoài (đang hiện, đã lưu trong lượt, và phiên có lượt ngoài) đi qua bộ render an toàn", () => {
    expect(ma).toContain('import { NoiDungTraLoiNgoai } from "@/components/ai/NoiDungTraLoiNgoai";');
    expect(ma).toContain('(m.role === "assistant" && (m.ngoai || phienCoNgoai))');
    expect(ma).toContain("<NoiDungTraLoiNgoai noiDung={m.content} />");
    expect(ma).toContain("(luotNgoai ? <NoiDungTraLoiNgoai noiDung={streamingText} /> :");
    expect(ma).toContain("setPhienCoNgoai(r.session.coLuotNgoai === true);");
  });

  it("lưu phiên chuyển callId (máy chủ xác minh); đổi/mở phiên đặt lại dấu và danh sách id", () => {
    expect(ma).toContain("...(ids.length > 0 ? { ngoaiCallIds: ids } : {})");
    expect(demLanXuatHien("setPhienCoNgoai(false);")).toBeGreaterThanOrEqual(2);
    expect(demLanXuatHien("ngoaiCallIdsRef.current = [];")).toBeGreaterThanOrEqual(3);
  });

  it("★ CHỐT 'người dùng đã đồng ý': lần gọi ĐẦU chỉ mang xacNhanVanHanh khi người dùng ĐÃ xác nhận phiên này (không phải luôn true)", () => {
    expect(ma).toContain("let res = await goiStream(laNgoai && daXacNhanVanHanh(khoaPhien(), chonModel));");
    expect(ma).toContain("if (await hoiVanHanh(khoaPhien(), chonModel)) {");
    expect(ma).toContain("res = await goiStream(true);");
  });

  it("★ handleSend phụ thuộc laNgoai / chonModel / hoiVanHanh / loiNgoaiRef (không đóng gói cũ: đổi sang model ngoài mà vẫn chạy đường agent)", () => {
    expect(ma).toContain("projectId, dungVong, cheDoChat, agentDangChay, agentGui, laNgoai, chonModel, hoiVanHanh, loiNgoaiRef]);");
  });

  it("★ đường render KHÔNG an toàn bị đóng: lượt ngoài đặt luotNgoai TRƯỚC khi stream, đặt phienCoNgoai sau lượt ngoài; tiến độ đọc có trần 50", () => {
    expect(ma).toContain("setLuotNgoai(laNgoai);");
    expect(ma).toContain("setPhienCoNgoai(true);");
    expect(ma).toContain("setTienDoDoc((prev) => [...prev, d].slice(-50))");
    expect(ma.indexOf("setLuotNgoai(laNgoai);")).toBeLessThan(ma.indexOf("const goiStream = (xacNhanVH: boolean)"));
  });

  it("★ sổ callId dùng phép thuần (cộng dồn / loại đúng id đã lưu / id của lượt); lưu hỏng khi có id ⇒ bỏ id + báo lỗi", () => {
    expect(ma).toContain("ngoaiCallIdsRef.current = congDonCallId(ngoaiCallIdsRef.current, callIdCuaLuot(res));");
    expect(ma).toContain("const ids = congDonCallId(ngoaiCallIdsRef.current, []);");
    expect(ma).toContain("ngoaiCallIdsRef.current = loaiCallIdDaLuu(ngoaiCallIdsRef.current, ids);");
    expect(ma).toMatch(/if \(ngoaiCallIdsRef\.current\.length > 0\) \{\s*ngoaiCallIdsRef\.current = \[\];\s*toast\.error\(mapTrpcError\(e\)\);/);
    // setPhienCoNgoai(true) đứng TRƯỚC khi thêm lượt assistant vào transcript (hiệu ứng lưu chạy theo transcript)
    expect(ma.indexOf("setPhienCoNgoai(true);")).toBeLessThan(ma.indexOf('{ role: "assistant", content: answer, ...(res.ngoai'));
  });

  it("ô chọn model có hook đồng ý (hộp) và hộp được vẽ", () => {
    expect(ma).toContain("xacNhanNgoai={xacNhanNgoai}");
    expect(ma).toContain("{hopThoai}");
    expect(ma).toContain('beMat: "coding"');
  });
});
