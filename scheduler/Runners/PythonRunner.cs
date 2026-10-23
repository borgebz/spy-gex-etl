using GexScheduler.Options;
using Microsoft.Extensions.Options;

namespace GexScheduler.Runners;

/// <summary>Runs scripts/archive_db.py (retention + VACUUM).</summary>
public sealed class PythonRunner(ProcessRunner process, IOptions<SchedulerOptions> options)
{
    private readonly SchedulerOptions _opt = options.Value;

    public async Task<RunResult> RunArchiveAsync(CancellationToken ct)
    {
        string[] args = [Path.Combine(_opt.RepoRoot, "scripts", "archive_db.py"), "--vacuum"];

        if (_opt.DryRun)
            return new RunResult(RunOutcome.DryRun, null, TimeSpan.Zero, "would run archive_db.py --vacuum", null);

        var r = await process.RunAsync("archive", _opt.PythonExe, args, _opt.RepoRoot, ct);
        var outcome = r.ExitCode switch { null => RunOutcome.Timeout, 0 => RunOutcome.Ok, _ => RunOutcome.Failed };
        var summary = string.Join(" | ", r.Output.Split('\n', StringSplitOptions.RemoveEmptyEntries).TakeLast(3));
        return new RunResult(outcome, r.ExitCode, r.Took, summary, r.LogFile);
    }
}
