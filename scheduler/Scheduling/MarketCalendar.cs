using GexScheduler.Options;
using Microsoft.Extensions.Options;

namespace GexScheduler.Scheduling;

public sealed class MarketCalendar(IOptions<SchedulerOptions> options)
{
    private readonly IOptions<SchedulerOptions> _options = options;

    private static readonly TimeZoneInfo EasternTimeZone = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");

    public bool IsInWindow(DateTimeOffset utc)
    {
        DateTimeOffset etTime = TimeZoneInfo.ConvertTime(utc, EasternTimeZone);

        if (etTime.DayOfWeek == DayOfWeek.Saturday || etTime.DayOfWeek == DayOfWeek.Sunday)
        {
            return false;
        }

        if (IsHoliday(etTime.Date))
        {
            return false;
        }

        TimeOnly timeOfDay = etTime.TimeOfDay;
        return timeOfDay >= _options.Value.MarketOpenEt && timeOfDay < _options.Value.MarketCloseEt!;
    }

    public DateTimeOffset NextArchiveRun(DateTimeOffset utc)
    {
        DateTimeOffset etNow = TimeZoneInfo.ConvertTime(utc, EasternTimeZone);

        DateTimeOffset etCandidate = new DateTimeOffset(etNow.Date, EasternTimeZone.GetUtcOffset(etNow.Date))
            .Add(_options.Value.ArchiveAtEt);

        etCandidate = TimeZoneInfo.ConvertTime(etCandidate.UtcDateTime, EasternTimeZone);

        if (etNow >= etCandidate)
        {
            etCandidate = etCandidate.AddDays(1);
        }

        while (etCandidate.DayOfWeek == DayOfWeek.Saturday || 
               etCandidate.DayOfWeek == DayOfWeek.Sunday || 
               IsHoliday(etCandidate.Date))
        {
            etCandidate = etCandidate.AddDays(1);
        }

        return etCandidate.ToUniversalTime();
    }

    private bool IsHoliday(DateTime date)
    {
        if (date.Month == 1 && date.Day == 1) return true;
        if (date.Month == 12 && date.Day == 25) return true;

        return false;
    }
}