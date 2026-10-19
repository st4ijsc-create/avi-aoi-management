import com.sun.net.httpserver.HttpServer;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

public class HienThiTest {
    interface ThanMayChu {
        void chay(int cong) throws Exception;
    }

    static final HttpClient KHACH = HttpClient.newBuilder()
        .version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(5)).build();

    /** Dựng máy chủ mới, start, chạy thân test, LUÔN stop(0). */
    static void voiMayChu(ThanMayChu than) throws Exception {
        HttpServer s = MayChu.tao();
        s.start();
        try {
            than.chay(s.getAddress().getPort());
        } finally {
            s.stop(0);
        }
    }

    static HttpResponse<String> goi(int cong, String phuongThuc, String duong, String than) throws Exception {
        HttpRequest.BodyPublisher bp = than == null
            ? HttpRequest.BodyPublishers.noBody()
            : HttpRequest.BodyPublishers.ofString(than, StandardCharsets.UTF_8);
        HttpRequest r = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + cong + duong))
            .timeout(Duration.ofSeconds(10)).method(phuongThuc, bp).build();
        return KHACH.send(r, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }

    public static void main(String[] args) {
        Kt.chay("GET /suc-khoe", () -> voiMayChu(cong -> {
            HttpResponse<String> r = goi(cong, "GET", "/suc-khoe", null);
            Kt.bang(200, r.statusCode());
            Kt.bang("{\"trangThai\":\"ok\"}", r.body());
            Kt.bang("application/json; charset=utf-8", r.headers().firstValue("Content-Type").orElse(""));
        }));
        Kt.chay("GET /chao với tên có khoảng trắng mã hoá", () -> voiMayChu(cong -> {
            HttpResponse<String> r = goi(cong, "GET", "/chao?ten=Minh%20Anh", null);
            Kt.bang(200, r.statusCode());
            Kt.bang("{\"loiChao\":\"Xin chào, Minh Anh!\"}", r.body());
        }));
        Kt.chay("POST rồi GET /ghi-chu", () -> voiMayChu(cong -> {
            HttpResponse<String> p = goi(cong, "POST", "/ghi-chu", "mua sữa");
            Kt.bang(201, p.statusCode());
            Kt.bang("{\"id\":1,\"noiDung\":\"mua sữa\"}", p.body());
            HttpResponse<String> g = goi(cong, "GET", "/ghi-chu", null);
            Kt.bang(200, g.statusCode());
            Kt.bang("{\"soLuong\":1,\"ghiChu\":[{\"id\":1,\"noiDung\":\"mua sữa\"}]}", g.body());
        }));
        Kt.ketThuc();
    }
}
