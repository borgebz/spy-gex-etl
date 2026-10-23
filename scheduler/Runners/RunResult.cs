namespace GexScheduler.Runners;

public sealed record RunResult(RunOutcome Outcome, int? ExitCode, TimeSpan Took, string Summary, string? LogFile);
