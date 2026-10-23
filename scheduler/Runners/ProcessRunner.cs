using System.Diagnostics;
using GexScheduler.Options;
using Microsoft.Extensions.Options;

namespace GexScheduler.Runners;

public sealed record ProcessResult(int? ExitCode, TimeSpan Took, string Output, string LogFile);

/// <summary>Starts a process, enforces the job timeout and writes its full output to a run log.</summary>
public sealed class ProcessRunner(IOptions<SchedulerOptions> options, TimeProvider time, ILogger<ProcessRunner> log)
{
    private readonly SchedulerOptions _opt = options.Value;

    /// <returns>ExitCode is null when the job timeout killed the process.</returns>
    /// <exception cref="OperationCanceledException">The host is stopping; the process was killed.</exception>
    public async Task<ProcessResult> RunAsync(
        string name, string exe, IEnumerable<string> args, string? workingDirectory, CancellationToken ct)
    {
        var psi = new ProcessStartInfo(exe)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            WorkingDirectory = workingDirectory ?? string.Empty
        };
        foreach (var a in args)
            psi.ArgumentList.Add(a);

        var startedAt = time.GetUtcNow();
        var start = time.GetTimestamp();
        using var p = Process.Start(psi) ?? throw new InvalidOperationException($"Could not start {exe}");

        // Read both streams from the start, so a full pipe buffer cannot block the process.
        var stdout = p.StandardOutput.ReadToEndAsync(CancellationToken.None);
        var stderr = p.StandardError.ReadToEndAsync(CancellationToken.None);

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(_opt.JobTimeout);
        var timedOut = false;
        try
        {
            await p.WaitForExitAsync(timeout.Token);
        }
        catch (OperationCanceledException)
        {
            Kill(p);
            if (ct.IsCancellationRequested)
                throw;
            timedOut = true;
        }

        var output = await stdout + await stderr;
        var took = time.GetElapsedTime(start);
        var logFile = await WriteRunLogAsync(name, startedAt, output);
        return new ProcessResult(timedOut ? null : p.ExitCode, took, output, logFile);
    }

    private void Kill(Process p)
    {
        try
        {
            p.Kill(entireProcessTree: true);
        }
        catch (InvalidOperationException)
        {
            // The process exited between the timeout and the kill.
        }
    }

    private async Task<string> WriteRunLogAsync(string name, DateTimeOffset startedAt, string output)
    {
        Directory.CreateDirectory(_opt.RunLogDir);
        var file = Path.Combine(_opt.RunLogDir, $"{startedAt:yyyy-MM-dd'T'HH-mm-ss'Z'}_{name}.log");
        await File.WriteAllTextAsync(file, output);
        DeleteOldRunLogs(startedAt);
        return file;
    }

    private void DeleteOldRunLogs(DateTimeOffset now)
    {
        var cutoff = now.UtcDateTime.AddDays(-_opt.RunLogDays);
        foreach (var f in Directory.EnumerateFiles(_opt.RunLogDir, "*.log"))
        {
            try
            {
                if (File.GetLastWriteTimeUtc(f) < cutoff)
                    File.Delete(f);
            }
            catch (IOException ex)
            {
                log.LogDebug(ex, "Could not delete old run log {File}", f);
            }
        }
    }
}
