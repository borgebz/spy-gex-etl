using System.Diagnostics;
using GexScheduler.Common.Models;
using GexScheduler.Options;
using Microsoft.Extensions.Options;


namespace GexScheduler.Runners;

public class KnimeRunner(IOptions<SchedulerOptions> options)
{
    private readonly IOptions<SchedulerOptions> _opt = options;

    public async Task<RunResult> RunAsync(string workflow, CancellationToken ct)
    {
        var dataDir = Path.Combine(_opt.Value.BatchDataDir!, workflow);
        Directory.CreateDirectory(dataDir);

        var psi = new ProcessStartInfo(_opt.Value.KnimeExe!)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        };

        var args = new[] { 
            "-nosplash",
            "-consoleLog",
            "-data",
            dataDir,
            "-application",
            "com.nodepit.batch.application.NodePitBatchExecutor",
            "--launcher.suppressErrors",
            "-r",
            "--no-save",
            Path.Combine(_opt.Value.WorkflowRoot!, workflow)};

        foreach (var a in args)
            psi.ArgumentList.Add(a);

        var sw = Stopwatch.StartNew();
        using var p = Process.Start(psi)!;
        var output = p.StandardOutput.ReadToEndAsync(ct);
        var errors = p.StandardError.ReadToEndAsync(ct);

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(_opt.Value.JobTimeout!);

        try
        { 
            await p.WaitForExitAsync(timeout.Token); 
        }
        catch (OperationCanceledException)
        {
            p.Kill(entireProcessTree: true);
            
            return new RunResult(
                -1,
                sw.Elapsed,
                "timeout"); 
        }

        var log = await output + await errors;

        return new RunResult(
            p.ExitCode,
            sw.Elapsed,
            string.Join('\n', log.Split('\n').Where(l => l.Contains("ERROR")).TakeLast(5)));
    }
}