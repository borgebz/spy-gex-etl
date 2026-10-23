using GexScheduler.Options;
using GexScheduler.Runners;
using GexScheduler.Scheduling;
using Microsoft.Extensions.Options;

namespace GexScheduler.Jobs;

/// <summary>01 → 03 → 04 → 05: CBOE chain, parse, GEX, web export.</summary>
public sealed class PipelineJob(
    KnimeRunner knime,
    MarketCalendar calendar,
    JobGate gate,
    TimeProvider time,
    IOptions<SchedulerOptions> options,
    ILogger<PipelineJob> log) : KnimeJob(knime, calendar, gate, time, log)
{
    protected override string Workflow => "00-orchestrator";

    protected override TimeSpan Period => options.Value.PipelineEvery;
}
