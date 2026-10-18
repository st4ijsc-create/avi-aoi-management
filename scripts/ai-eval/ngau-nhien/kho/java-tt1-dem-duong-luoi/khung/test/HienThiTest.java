public class HienThiTest {
    public static void main(String[] args) {
        Kt.chay("đếm đường lưới trống và có chướng ngại", () -> {
            Kt.bang(6L, DuongLuoi.demDuong(new String[] {"...", "...", "..."}));
            Kt.bang(2L, DuongLuoi.demDuong(new String[] {"...", ".#.", "..."}));
        });
        Kt.chay("đường nhỏ nhất theo từ điển", () -> {
            Kt.bang("DDRR", DuongLuoi.duongNhoNhat(new String[] {"...", "...", "..."}));
            Kt.bang("RDDR", DuongLuoi.duongNhoNhat(new String[] {"...", "#..", "#.."}));
        });
        Kt.chay("một ô bắt buộc ở góc trên phải", () -> {
            String[] luoi = {"..*", "...", "..."};
            Kt.bang(1L, DuongLuoi.demDuong(luoi));
            Kt.bang("RRDD", DuongLuoi.duongNhoNhat(luoi));
        });
        Kt.ketThuc();
    }
}
