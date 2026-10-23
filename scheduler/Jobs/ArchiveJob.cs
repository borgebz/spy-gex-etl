using GexScheduler.Runners;
using GexScheduler.Scheduling;

namespace GexScheduler.Jobs;

/// <summary>Once per trading day after the close: archive_db.py --vacuum, with the database to itself.</summary>
public sealed class ArchiveJob(
    PythonRunner python,
    MarketCalendar calendar,
    JobGate gate,
    TimeProvider time,
    ILogger<ArchiveJob> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            var next = calendar.NextArchiveRun(time.GetUtcNow());
            log.LogInformation("archive next run {NextUtc:yyyy-MM-dd HH:mm}Z ({NextEt:ddd HH:mm} ET)",
                next, MarketCalendar.ToEastern(next));
            try
            {
                await Task.Delay(next - time.GetUtcNow(), time, ct);
                using (await gate.EnterExclusiveAsync(ct))
                {
                    var r = await python.RunArchiveAsync(ct);
                    log.LogRun("archive", r);
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                log.LogError(ex, "archive failed");
            }
        }
    }
}
