using GexScheduler.Options;
using Microsoft.Extensions.Options;

namespace GexScheduler.Startup;

/// <summary>
/// Copies the workflows to <see cref="SchedulerOptions.RunRoot"/> at startup. The jobs run the copy,
/// so a KNIME GUI that has the originals open (and locked) cannot block them.
/// Workflow changes reach the scheduler on the next restart.
/// </summary>
public sealed class WorkflowCopy(IOptions<SchedulerOptions> options, ILogger<WorkflowCopy> log) : IHostedService
{
    private static readonly string[] SkipDirs = ["internal", "internalTables", "filestore"];

    private readonly SchedulerOptions _opt = options.Value;

    // Hosted services start in registration order: this runs before any job starts.
    public Task StartAsync(CancellationToken ct)
    {
        var workflows = Directory.EnumerateDirectories(_opt.WorkflowRoot)
            .Where(d => File.Exists(Path.Combine(d, "workflow.knime")))
            .ToList();

        if (Directory.Exists(_opt.RunRoot))
            Directory.Delete(_opt.RunRoot, recursive: true);

        foreach (var source in workflows)
        {
            var name = Path.GetFileName(source);
            CopyDirectory(source, Path.Combine(_opt.RunRoot, name));
            if (SavedExecuted(source))
                log.LogWarning("{Workflow} was saved executed; reset it in KNIME (or knime_reset.py), or calls from the orchestrator can fail", name);
        }

        log.LogInformation("copied {Count} workflows to {RunRoot}", workflows.Count, _opt.RunRoot);
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;

    private static void CopyDirectory(string source, string target)
    {
        Directory.CreateDirectory(target);
        foreach (var file in Directory.EnumerateFiles(source))
        {
            if (Path.GetFileName(file) != ".knimeLock")
                File.Copy(file, Path.Combine(target, Path.GetFileName(file)));
        }
        foreach (var dir in Directory.EnumerateDirectories(source))
        {
            var name = Path.GetFileName(dir);
            if (!name.StartsWith("port_") && !SkipDirs.Contains(name))
                CopyDirectory(dir, Path.Combine(target, name));
        }
    }

    private static bool SavedExecuted(string workflow) =>
        Directory.EnumerateFiles(workflow, "settings.xml", SearchOption.AllDirectories)
            .Any(f => File.ReadAllText(f).Contains("key=\"state\" type=\"xstring\" value=\"EXECUTED\""));
}
