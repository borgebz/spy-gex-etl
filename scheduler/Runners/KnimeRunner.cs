using GexScheduler.Options;
using Microsoft.Extensions.Options;

namespace GexScheduler.Runners;

/// <summary>Runs one KNIME workflow headless with NodePit Batch.</summary>
public sealed class KnimeRunner(ProcessRunner process, IOptions<SchedulerOptions> options)
{
    private readonly SchedulerOptions _opt = options.Value;

    public async Task<RunResult> RunAsync(string workflow, CancellationToken ct)
    {
        // Own workspace per workflow: two KNIME runs on one workspace fail with "workspace in use".
        var dataDir = Path.Combine(_opt.BatchDataDir, workflow);
        string[] args =
        [
            "-nosplash",
            "-consoleLog",
            "-data", dataDir,
            "-application", "com.nodepit.batch.application.NodePitBatchExecutor",
            "--launcher.suppressErrors",
            "-r",
            "--no-save",
            Path.Combine(_opt.RunRoot, workflow)   // the copy, never the folder open in the KNIME GUI
        ];

        if (_opt.DryRun)
            return new RunResult(RunOutcome.DryRun, null, TimeSpan.Zero, $"would run {workflow}", null);

        Directory.CreateDirectory(dataDir);
        var r = await process.RunAsync(workflow, _opt.KnimeExe, args, null, ct);
        return new RunResult(ToOutcome(r.ExitCode), r.ExitCode, r.Took, ErrorSummary(r.Output), r.LogFile);
    }

    private static RunOutcome ToOutcome(int? exitCode) => exitCode switch
    {
        null => RunOutcome.Timeout,
        0 => RunOutcome.Ok,
        10 => RunOutcome.BadInput,
        20 => RunOutcome.Locked,
        30 => RunOutcome.Failed,
        40 => RunOutcome.SaveError,
        50 => RunOutcome.Unknown,
        _ => RunOutcome.Failed
    };

    private static string ErrorSummary(string output) =>
        string.Join(" | ", output.Split('\n')
            .Where(l => l.Contains("ERROR"))
            .Select(l => l.Trim())
            .TakeLast(3));
}
