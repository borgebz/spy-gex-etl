using GexScheduler.Options;
using GexScheduler.Runners;
using GexScheduler.Scheduling;
using Microsoft.Extensions.Options;

namespace GexScheduler.Jobs;

public sealed class PriceJob(
    KnimeRunner knime,
    MarketCalendar clock,
    JobGate gate,
    IOptions<SchedulerOptions> opt,
    ILogger<PriceJob> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(opt.Value.PriceEvery!);

        do
        {
            if (!clock.IsMarketWindow()) continue;

            if (!gate.TryEnterShared())
            {
                log.LogInformation("pipeline skipped: busy or archive running"); continue; 
            }

            try
            {
                var r = await knime.RunAsync("02-extract-spy-price", ct);

                log.Log(r.ExitCode == 0 ? LogLevel.Information : LogLevel.Warning,
                        "pipeline exit={Exit} took={Took:mm\\:ss} {Tail}", r.ExitCode, r.Took, r.LogTail);
            }
            finally
            {
                gate.ExitShared(); 
            }
        } while (await timer.WaitForNextTickAsync(ct));
    }
}