import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.Set;

public class HienThiTest {
    public static void main(String[] args) {
        NgayLamViec nlv = new NgayLamViec(Set.of(LocalDate.of(2026, 4, 30)));
        Kt.chay("ngày làm việc cơ bản", () -> {
            Kt.bang(true, nlv.laNgayLamViec(LocalDate.of(2026, 4, 29)));
            Kt.bang(false, nlv.laNgayLamViec(LocalDate.of(2026, 4, 30)));
            Kt.bang(false, nlv.laNgayLamViec(LocalDate.of(2026, 5, 2)));
        });
        Kt.chay("cộng ngày làm việc qua lễ và cuối tuần", () -> {
            Kt.bang(LocalDate.of(2026, 5, 4), nlv.congNgayLamViec(LocalDate.of(2026, 4, 29), 2));
        });
        Kt.chay("họp tiếp theo cùng múi giờ", () -> {
            ZoneId hcm = ZoneId.of("Asia/Ho_Chi_Minh");
            ZonedDateTime luc = ZonedDateTime.of(2026, 3, 2, 10, 0, 0, 0, hcm); // Thứ Hai
            Kt.bang(ZonedDateTime.of(2026, 3, 4, 9, 0, 0, 0, hcm),
                NgayLamViec.hopTiepTheo(luc, DayOfWeek.WEDNESDAY, LocalTime.of(9, 0), hcm));
        });
        Kt.ketThuc();
    }
}
