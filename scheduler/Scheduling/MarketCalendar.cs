using GexScheduler.Options;
using Microsoft.Extensions.Options;

namespace GexScheduler.Scheduling;

public sealed class MarketCalendar(IOptions<SchedulerOptions> options)
{
    // IANA name, never a fixed offset: the US and Portugal change clocks on different dates.
    public static readonly TimeZoneInfo Eastern = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");

    private readonly SchedulerOptions _opt = options.Value;

    public static DateTime ToEastern(DateTimeOffset utc) => TimeZoneInfo.ConvertTime(utc, Eastern).DateTime;

    public bool IsTradingDay(DateOnly day) =>
        day.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday)
        && !_opt.Holidays.Contains(day);

    public bool IsInWindow(DateTimeOffset utc)
    {
        var et = ToEastern(utc);
        var time = TimeOnly.FromDateTime(et);
        return IsTradingDay(DateOnly.FromDateTime(et))
               && time >= _opt.MarketOpenEt
               && time < _opt.MarketCloseEt;
    }

    public DateTimeOffset NextArchiveRun(DateTimeOffset utc)
    {
        var day = DateOnly.FromDateTime(ToEastern(utc));
        while (true)
        {
            if (IsTradingDay(day))
            {
                // Build the run time from the ET date + time, so each day gets its own UTC offset.
                var local = day.ToDateTime(_opt.ArchiveAtEt, DateTimeKind.Unspecified);
                var runAt = new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(local, Eastern));
                if (runAt > utc)
                    return runAt;
            }
            day = day.AddDays(1);
        }
    }
}
