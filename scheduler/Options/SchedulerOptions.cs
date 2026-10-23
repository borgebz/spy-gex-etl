using System.ComponentModel.DataAnnotations;

namespace GexScheduler.Options;

public class SchedulerOptions
{
    [Required] public required string KnimeExe { get; init; }
 
    [Required] public required string WorkflowRoot { get; init; }

    [Required] public required string RepoRoot { get; init; }

    [Required] public required string BatchDataDir { get; init; }

    [Required] public required string PythonExe { get; init; } 

    public TimeSpan PipelineEvery { get; init; }

    public TimeSpan PriceEvery { get; init; }

    public TimeSpan JobTimeout { get; init; }

    public TimeOnly MarketOpenEt { get; init; }

    public TimeOnly MarketCloseEt { get; init; }

    public TimeOnly ArchiveAtEt { get; init; }

    public DateOnly[] Holidays { get; init; } = []; 
}