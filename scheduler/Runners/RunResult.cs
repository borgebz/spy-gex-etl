namespace GexScheduler.Common.Models;

public sealed record RunResult(int ExitCode, TimeSpan Took, string LogTail);
