using System.Diagnostics;
using GexScheduler.Options;
using Microsoft.Extensions.Options;

namespace GexScheduler.Startup;

/// <summary>
/// Keeps the Mac from sleeping while the scheduler runs (on power only: caffeinate -s).
/// caffeinate -w ends by itself when this process ends, so it can never outlive the scheduler.
/// </summary>
public sealed class KeepAwake(IOptions<SchedulerOptions> options, ILogger<KeepAwake> log) : IHostedService
{
    private Process? _caffeinate;

    public Task StartAsync(CancellationToken ct)
    {
        if (!options.Value.KeepAwake)
            return Task.CompletedTask;

        var psi = new ProcessStartInfo("/usr/bin/caffeinate") { UseShellExecute = false };
        psi.ArgumentList.Add("-s");
        psi.ArgumentList.Add("-w");
        psi.ArgumentList.Add(Environment.ProcessId.ToString());
        _caffeinate = Process.Start(psi);
        log.LogInformation("caffeinate -s started (pid {Pid})", _caffeinate?.Id);
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken ct)
    {
        try
        {
            _caffeinate?.Kill();
        }
        catch (InvalidOperationException)
        {
            // Already ended.
        }
        _caffeinate?.Dispose();
        return Task.CompletedTask;
    }
}
