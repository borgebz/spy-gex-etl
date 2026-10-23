namespace GexScheduler.Runners;

public enum RunOutcome
{
    Ok,
    DryRun,
    BadInput,   // NodePit exit 10
    Locked,     // NodePit exit 20: the KNIME GUI has the workflow open
    Failed,     // NodePit exit 30, or any other non-zero exit
    SaveError,  // NodePit exit 40
    Unknown,    // NodePit exit 50
    Timeout
}
