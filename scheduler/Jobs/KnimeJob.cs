using GexScheduler.Runners;
using GexScheduler.Scheduling;

namespace GexScheduler.Jobs;

/// <summary>Runs one KNIME workflow every <see cref="Period"/> while the market window is open.</summary>
public abstract class KnimeJob(
    KnimeRunner knime,
    MarketCalendar calendar,
    JobGate gate,
    TimeProvider time,
    ILogger log) : BackgroundService
{
    protected abstract string Workflow { get; }

    protected abstract TimeSpan Period { get; }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        log.LogInformation("{Workflow} every {Period}", Workflow, Period);
        using var timer = new PeriodicTimer(Period, time);
        do
        {
            // A sequential loop never overlaps itself: a slow run only delays the next tick.
            try
            {
                await RunOnceAsync(ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                // Since .NET 8 an unhandled exception stops the host; one bad tick must not stop collection.
                log.LogError(ex, "{Workflow} tick failed", Workflow);
            }
        } while (await timer.WaitForNextTickAsync(ct));
    }

    private async Task RunOnceAsync(CancellationToken ct)
    {
        if (!calendar.IsInWindow(time.GetUtcNow()))
        {
            log.LogDebug("{Workflow} skipped: outside the market window", Workflow);
            return;
        }

        if (!gate.TryEnterShared())
        {
            log.LogInformation("{Workflow} skipped: archive is running", Workflow);
            return;
        }

        try
        {
            var r = await knime.RunAsync(Workflow, ct);
            log.LogRun(Workflow, r);
        }
        finally
        {
            gate.ExitShared();
        }
    }
}
