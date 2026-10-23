using System.ComponentModel.DataAnnotations;

namespace GexScheduler.Options;

public sealed class SchedulerOptions
{
    public const string Section = "Scheduler";

    [Required] public required string KnimeExe { get; init; }

    [Required] public required string WorkflowRoot { get; init; }

    [Required] public required string RepoRoot { get; init; }

    [Required] public required string BatchDataDir { get; init; }

    [Required] public required string PythonExe { get; init; }

    [Required] public required string RunLogDir { get; init; }

    public int RunLogDays { get; init; } = 7;

    public TimeSpan PipelineEvery { get; init; } = TimeSpan.FromMinutes(5);

    public TimeSpan PriceEvery { get; init; } = TimeSpan.FromMinutes(1);

    public TimeSpan JobTimeout { get; init; } = TimeSpan.FromMinutes(4);

    public TimeOnly MarketOpenEt { get; init; } = new(9, 0);

    public TimeOnly MarketCloseEt { get; init; } = new(16, 30);

    public TimeOnly ArchiveAtEt { get; init; } = new(18, 0);

    /// <summary>NYSE full-day closures (observed dates).</summary>
    public DateOnly[] Holidays { get; init; } = [];

    /// <summary>Log what would run, start no process.</summary>
    public bool DryRun { get; init; }
}
