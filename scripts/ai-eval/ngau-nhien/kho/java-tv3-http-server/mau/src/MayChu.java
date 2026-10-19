import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

public final class MayChu {
    private MayChu() {}

    public static HttpServer tao() throws IOException {
        HttpServer s = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        List<String> ghiChu = new ArrayList<>();
        s.createContext("/", ex -> {
            try (ex) {
                xuLy(ex, ghiChu);
            }
        });
        return s;
    }

    private static void xuLy(HttpExchange ex, List<String> ghiChu) throws IOException {
        String duong = ex.getRequestURI().getPath();
        String pt = ex.getRequestMethod();
        switch (duong) {
            case "/suc-khoe" -> {
                if (!pt.equals("GET")) { khongHoTro(ex, "GET"); return; }
                tra(ex, 200, "{\"trangThai\":\"ok\"}");
            }
            case "/chao" -> {
                if (!pt.equals("GET")) { khongHoTro(ex, "GET"); return; }
                String ten = thamSo(ex.getRequestURI().getRawQuery(), "ten");
                if (ten == null || ten.isEmpty()) ten = "bạn";
                tra(ex, 200, "{\"loiChao\":\"" + json("Xin chào, " + ten + "!") + "\"}");
            }
            case "/ghi-chu" -> {
                if (pt.equals("GET")) {
                    StringBuilder sb = new StringBuilder();
                    synchronized (ghiChu) {
                        sb.append("{\"soLuong\":").append(ghiChu.size()).append(",\"ghiChu\":[");
                        for (int i = 0; i < ghiChu.size(); i++) {
                            if (i > 0) sb.append(',');
                            sb.append(motGhiChu(i + 1, ghiChu.get(i)));
                        }
                    }
                    tra(ex, 200, sb.append("]}").toString());
                } else if (pt.equals("POST")) {
                    String noiDung = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                    if (noiDung.isEmpty()) { tra(ex, 400, "{\"loi\":\"noi dung rong\"}"); return; }
                    int id;
                    synchronized (ghiChu) {
                        ghiChu.add(noiDung);
                        id = ghiChu.size();
                    }
                    tra(ex, 201, motGhiChu(id, noiDung));
                } else {
                    khongHoTro(ex, "GET, POST");
                }
            }
            default -> tra(ex, 404, "{\"loi\":\"khong tim thay\"}");
        }
    }

    private static String motGhiChu(int id, String noiDung) {
        return "{\"id\":" + id + ",\"noiDung\":\"" + json(noiDung) + "\"}";
    }

    private static String thamSo(String raw, String khoa) {
        if (raw == null) return null;
        for (String cap : raw.split("&")) {
            int i = cap.indexOf('=');
            String k = URLDecoder.decode(i < 0 ? cap : cap.substring(0, i), StandardCharsets.UTF_8);
            if (k.equals(khoa)) return i < 0 ? "" : URLDecoder.decode(cap.substring(i + 1), StandardCharsets.UTF_8);
        }
        return null;
    }

    private static void khongHoTro(HttpExchange ex, String allow) throws IOException {
        ex.getResponseHeaders().set("Allow", allow);
        tra(ex, 405, "{\"loi\":\"phuong thuc khong ho tro\"}");
    }

    private static void tra(HttpExchange ex, int ma, String than) throws IOException {
        byte[] b = than.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        ex.sendResponseHeaders(ma, b.length);
        try (OutputStream o = ex.getResponseBody()) {
            o.write(b);
        }
    }

    static String json(String s) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
                }
            }
        }
        return sb.toString();
    }
}
