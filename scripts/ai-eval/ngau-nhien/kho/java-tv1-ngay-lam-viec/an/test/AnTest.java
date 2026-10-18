import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.HashSet;
import java.util.Set;

public class AnTest {
    public static void main(String[] args) {
        LocalDate le1 = LocalDate.of(2026, 4, 30), le2 = LocalDate.of(2026, 5, 1);
        NgayLamViec nlv = new NgayLamViec(Set.of(le1, le2));
        ZoneId berlin = ZoneId.of("Europe/Berlin");

        Kt.chay("tập ngày lễ được chép", () -> {
            Set<LocalDate> le = new HashSet<>();
            le.add(LocalDate.of(2026, 6, 1));
            NgayLamViec x = new NgayLamViec(le);
            le.add(LocalDate.of(2026, 6, 2));
            Kt.bang(true, x.laNgayLamViec(LocalDate.of(2026, 6, 2)));
            Kt.bang(false, x.laNgayLamViec(LocalDate.of(2026, 6, 1)));
        });
        Kt.chay("cộng n = 0 trên ngày nghỉ và ngày làm", () -> {
            Kt.bang(LocalDate.of(2026, 5, 4), nlv.congNgayLamViec(LocalDate.of(2026, 5, 1), 0));
            Kt.bang(LocalDate.of(2026, 5, 4), nlv.congNgayLamViec(LocalDate.of(2026, 5, 4), 0));
        });
        Kt.chay("lùi ngày làm việc qua lễ", () -> {
            Kt.bang(LocalDate.of(2026, 4, 29), nlv.congNgayLamViec(LocalDate.of(2026, 5, 4), -1));
            Kt.bang(LocalDate.of(2026, 4, 27), nlv.congNgayLamViec(LocalDate.of(2026, 5, 4), -3));
        });
        Kt.chay("cộng từ một ngày nghỉ", () -> {
            Kt.bang(LocalDate.of(2026, 5, 5), nlv.congNgayLamViec(LocalDate.of(2026, 5, 2), 2));
        });
        Kt.chay("đếm nửa mở và đổi chiều", () -> {
            Kt.bang(3L, nlv.demNgayLamViec(LocalDate.of(2026, 4, 27), LocalDate.of(2026, 5, 4)));
            Kt.bang(-3L, nlv.demNgayLamViec(LocalDate.of(2026, 5, 4), LocalDate.of(2026, 4, 27)));
            Kt.bang(0L, nlv.demNgayLamViec(LocalDate.of(2026, 5, 4), LocalDate.of(2026, 5, 4)));
            Kt.bang(1L, nlv.demNgayLamViec(LocalDate.of(2026, 5, 4), LocalDate.of(2026, 5, 5)));
        });
        Kt.chay("đếm khoảng dài một năm", () -> {
            NgayLamViec khongLe = new NgayLamViec(Set.of());
            Kt.bang(261L, khongLe.demNgayLamViec(LocalDate.of(2026, 1, 1), LocalDate.of(2027, 1, 1)));
        });
        Kt.chay("họp đúng lúc hiện tại thì lấy tuần sau", () -> {
            ZonedDateTime luc = ZonedDateTime.of(2026, 3, 4, 9, 0, 0, 0, berlin);
            Kt.bang(ZonedDateTime.of(2026, 3, 11, 9, 0, 0, 0, berlin),
                NgayLamViec.hopTiepTheo(luc, DayOfWeek.WEDNESDAY, LocalTime.of(9, 0), berlin));
        });
        Kt.chay("họp qua ngày chuyển giờ mùa hè (giữ giờ địa phương)", () -> {
            ZonedDateTime luc = ZonedDateTime.of(2026, 3, 25, 12, 0, 0, 0, berlin);
            ZonedDateTime kq = NgayLamViec.hopTiepTheo(luc, DayOfWeek.MONDAY, LocalTime.of(9, 0), berlin);
            Kt.bang(LocalDate.of(2026, 3, 30), kq.toLocalDate());
            Kt.bang(LocalTime.of(9, 0), kq.toLocalTime());
            Kt.bang(ZoneOffset.ofHours(2), kq.getOffset());
            // giờ rơi vào khoảng trống 02:00–03:00 ngày 29/3 ⇒ dời thành 03:30 (+02:00)
            ZonedDateTime trong = NgayLamViec.hopTiepTheo(luc, DayOfWeek.SUNDAY, LocalTime.of(2, 30), berlin);
            Kt.bang(ZonedDateTime.of(2026, 3, 29, 3, 30, 0, 0, berlin), trong);
        });
        Kt.chay("thời điểm vào ở múi giờ khác (so theo instant)", () -> {
            // 2026-03-04 07:30 UTC = 08:30 Berlin (+01:00), trước 09:00 ⇒ họp chính ngày đó
            ZonedDateTime lucUtc = ZonedDateTime.of(2026, 3, 4, 7, 30, 0, 0, ZoneOffset.UTC);
            ZonedDateTime kq = NgayLamViec.hopTiepTheo(lucUtc, DayOfWeek.WEDNESDAY, LocalTime.of(9, 0), berlin);
            Kt.bang(ZonedDateTime.of(2026, 3, 4, 9, 0, 0, 0, berlin), kq);
            Kt.bang(berlin, kq.getZone());
            // 2026-03-04 08:30 UTC = 09:30 Berlin ⇒ tuần sau
            ZonedDateTime kq2 = NgayLamViec.hopTiepTheo(lucUtc.plusHours(1), DayOfWeek.WEDNESDAY, LocalTime.of(9, 0), berlin);
            Kt.bang(LocalDate.of(2026, 3, 11), kq2.toLocalDate());
        });
        Kt.ketThuc();
    }
}
