using GexScheduler.Options;
using GexScheduler.Runners;
using GexScheduler.Scheduling;
using Microsoft.Extensions.Options;

namespace GexScheduler.Jobs;

/// <summary>02: SPY price from FMP.</summary>
public sealed class PriceJob(
    KnimeRunner knime,
    MarketCalendar calendar,
    JobGate gate,
    TimeProvider time,
    IOptions<SchedulerOptions> options,
    ILogger<PriceJob> log) : KnimeJob(knime, calendar, gate, time, log)
{
    protected override string Workflow => "02-extract-spy-price";

    protected override TimeSpan Period => options.Value.PriceEvery;
}
