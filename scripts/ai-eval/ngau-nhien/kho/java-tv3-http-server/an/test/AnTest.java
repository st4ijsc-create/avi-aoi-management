import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;
import java.util.concurrent.CompletableFuture;

public class AnTest {
    static HttpResponse<String> goi(int cong, String pt, String duong, String than) throws Exception {
        return HienThiTest.goi(cong, pt, duong, than);
    }

    static String loiChao(int cong, String query) throws Exception {
        HttpResponse<String> r = goi(cong, "GET", "/chao" + query, null);
        Kt.bang(200, r.statusCode());
        return r.body();
    }

    public static void main(String[] args) {
        Kt.chay("chào mặc định khi thiếu hoặc rỗng tham số", () -> HienThiTest.voiMayChu(cong -> {
            String macDinh = "{\"loiChao\":\"Xin chào, bạn!\"}";
            Kt.bang(macDinh, loiChao(cong, ""));
            Kt.bang(macDinh, loiChao(cong, "?ten="));
            Kt.bang(macDinh, loiChao(cong, "?ten"));
            Kt.bang(macDinh, loiChao(cong, "?x=1"));
        }));
        Kt.chay("query giải mã UTF-8: dấu cộng là khoảng trắng, %2B và %26 giữ nguyên ký tự", () -> HienThiTest.voiMayChu(cong -> {
            Kt.bang("{\"loiChao\":\"Xin chào, Thu Hà!\"}", loiChao(cong, "?ten=Thu+H%C3%A0"));
            Kt.bang("{\"loiChao\":\"Xin chào, 1+1&2!\"}", loiChao(cong, "?ten=1%2B1%262"));
            Kt.bang("{\"loiChao\":\"Xin chào, a=b!\"}", loiChao(cong, "?ten=a%3Db"));
        }));
        Kt.chay("tham số lặp lấy lần đầu, tham số khác bị bỏ qua", () -> HienThiTest.voiMayChu(cong -> {
            Kt.bang("{\"loiChao\":\"Xin chào, A!\"}", loiChao(cong, "?ten=A&ten=B"));
            Kt.bang("{\"loiChao\":\"Xin chào, C!\"}", loiChao(cong, "?x=1&ten=C&y"));
        }));
        Kt.chay("thoát JSON trong lời chào", () -> HienThiTest.voiMayChu(cong -> {
            Kt.bang("{\"loiChao\":\"Xin chào, a\\\"b\\\\c!\"}", loiChao(cong, "?ten=a%22b%5Cc"));
        }));
        Kt.chay("thoát JSON trong ghi chú (nháy, gạch chéo ngược, điều khiển, Unicode)", () -> HienThiTest.voiMayChu(cong -> {
            String nd = "a\"b\\c\nd\r\te\u0001\u001f/ü✓";
            HttpResponse<String> p = goi(cong, "POST", "/ghi-chu", nd);
            Kt.bang(201, p.statusCode());
            Kt.bang("{\"id\":1,\"noiDung\":\"a\\\"b\\\\c\\nd\\r\\te\\u0001\\u001f/ü✓\"}", p.body());
            Kt.bang("application/json; charset=utf-8", p.headers().firstValue("Content-Type").orElse(""));
        }));
        Kt.chay("404 cho đường không khớp CHÍNH XÁC", () -> HienThiTest.voiMayChu(cong -> {
            for (String d : List.of("/", "/khong-co", "/chao/", "/chaoxyz", "/suc-khoe/x", "/ghi-chu/1", "/GHI-CHU")) {
                HttpResponse<String> r = goi(cong, "GET", d, null);
                Kt.bang(404, r.statusCode());
                Kt.bang("{\"loi\":\"khong tim thay\"}", r.body());
                Kt.bang("application/json; charset=utf-8", r.headers().firstValue("Content-Type").orElse(""));
            }
            Kt.bang(404, goi(cong, "DELETE", "/khong-co", null).statusCode());
            Kt.bang(404, goi(cong, "POST", "/chao/", "x").statusCode());
        }));
        Kt.chay("405 kèm Allow", () -> HienThiTest.voiMayChu(cong -> {
            HttpResponse<String> a = goi(cong, "POST", "/suc-khoe", "x");
            Kt.bang(405, a.statusCode());
            Kt.bang("GET", a.headers().firstValue("Allow").orElse(""));
            Kt.bang("{\"loi\":\"phuong thuc khong ho tro\"}", a.body());
            HttpResponse<String> b = goi(cong, "PUT", "/chao?ten=A", "x");
            Kt.bang(405, b.statusCode());
            Kt.bang("GET", b.headers().firstValue("Allow").orElse(""));
            HttpResponse<String> c = goi(cong, "DELETE", "/ghi-chu", null);
            Kt.bang(405, c.statusCode());
            Kt.bang("GET, POST", c.headers().firstValue("Allow").orElse(""));
            Kt.bang("application/json; charset=utf-8", c.headers().firstValue("Content-Type").orElse(""));
        }));
        Kt.chay("thân rỗng ⇒ 400, không tiêu tốn id; danh sách rỗng", () -> HienThiTest.voiMayChu(cong -> {
            Kt.bang("{\"soLuong\":0,\"ghiChu\":[]}", goi(cong, "GET", "/ghi-chu", null).body());
            HttpResponse<String> r = goi(cong, "POST", "/ghi-chu", "");
            Kt.bang(400, r.statusCode());
            Kt.bang("{\"loi\":\"noi dung rong\"}", r.body());
            Kt.bang("{\"id\":1,\"noiDung\":\" \"}", goi(cong, "POST", "/ghi-chu", " ").body());
            Kt.bang("{\"id\":2,\"noiDung\":\"hai\"}", goi(cong, "POST", "/ghi-chu", "hai").body());
            Kt.bang("{\"soLuong\":2,\"ghiChu\":[{\"id\":1,\"noiDung\":\" \"},{\"id\":2,\"noiDung\":\"hai\"}]}",
                goi(cong, "GET", "/ghi-chu", null).body());
        }));
        Kt.chay("mỗi máy chủ có kho riêng, id bắt đầu lại từ 1; query bị bỏ qua ở /suc-khoe", () -> {
            HienThiTest.voiMayChu(cong -> goi(cong, "POST", "/ghi-chu", "cũ"));
            HienThiTest.voiMayChu(cong -> {
                Kt.bang("{\"id\":1,\"noiDung\":\"mới\"}", goi(cong, "POST", "/ghi-chu", "mới").body());
                Kt.bang("{\"trangThai\":\"ok\"}", goi(cong, "GET", "/suc-khoe?a=1", null).body());
            });
        });
        Kt.chay("20 POST song song ⇒ id 1..20 không trùng", () -> HienThiTest.voiMayChu(cong -> {
            List<CompletableFuture<HttpResponse<String>>> ds = new ArrayList<>();
            for (int i = 0; i < 20; i++) {
                HttpRequest r = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + cong + "/ghi-chu"))
                    .timeout(Duration.ofSeconds(10))
                    .POST(HttpRequest.BodyPublishers.ofString("g" + i, StandardCharsets.UTF_8)).build();
                ds.add(HienThiTest.KHACH.sendAsync(r, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)));
            }
            TreeSet<Integer> ids = new TreeSet<>();
            for (var f : ds) {
                HttpResponse<String> r = f.join();
                Kt.bang(201, r.statusCode());
                String b = r.body();
                ids.add(Integer.parseInt(b.substring(b.indexOf(':') + 1, b.indexOf(','))));
            }
            Kt.bang(20, ids.size());
            Kt.bang(1, ids.first());
            Kt.bang(20, ids.last());
            Kt.dung(goi(cong, "GET", "/ghi-chu", null).body().startsWith("{\"soLuong\":20,"), "soLuong phải là 20");
        }));
        Kt.ketThuc();
    }
}
