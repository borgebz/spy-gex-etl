namespace GexScheduler.Scheduling;

/// <summary>
/// KNIME jobs share the database; the archive job needs it alone (VACUUM).
/// Shared jobs skip while the archive holds the gate; the archive waits for running jobs.
/// </summary>
public sealed class JobGate(TimeProvider time)
{
    private readonly Lock _lock = new();
    private int _running;
    private bool _exclusive;

    public bool TryEnterShared()
    {
        lock (_lock)
        {
            if (_exclusive)
                return false;
            _running++;
            return true;
        }
    }

    public void ExitShared()
    {
        lock (_lock)
            _running--;
    }

    public async Task<IDisposable> EnterExclusiveAsync(CancellationToken ct)
    {
        lock (_lock)
            _exclusive = true;
        try
        {
            while (RunningCount() > 0)
                await Task.Delay(TimeSpan.FromSeconds(2), time, ct);
        }
        catch
        {
            ReleaseExclusive();   // else every shared job would skip until a restart
            throw;
        }
        return new Release(ReleaseExclusive);
    }

    private int RunningCount()
    {
        lock (_lock)
            return _running;
    }

    private void ReleaseExclusive()
    {
        lock (_lock)
            _exclusive = false;
    }

    private sealed class Release(Action release) : IDisposable
    {
        private int _done;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _done, 1) == 0)
                release();
        }
    }
}
