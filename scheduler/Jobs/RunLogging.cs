using GexScheduler.Runners;

namespace GexScheduler.Jobs;

internal static class RunLogging
{
    public static void LogRun(this ILogger log, string job, RunResult r)
    {
        var level = r.Outcome switch
        {
            RunOutcome.Ok or RunOutcome.DryRun => LogLevel.Information,
            RunOutcome.Locked => LogLevel.Information,   // expected while the KNIME GUI is open
            _ => LogLevel.Warning
        };
        var note = r.Outcome == RunOutcome.Locked ? "skipped: KNIME GUI has the workflow open" : r.Summary;
        log.Log(level, "{Job} {Outcome} exit={Exit} took={Took:mm\\:ss} {Note} {LogFile}",
            job, r.Outcome, r.ExitCode?.ToString() ?? "-", r.Took, note, r.LogFile ?? "");
    }
}
