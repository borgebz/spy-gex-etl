namespace GexScheduler.Scheduling;

public sealed class JobGate
{
    private readonly object _lock = new();
 
    private int _running;
    private bool _exclusive;

    public bool TryEnterShared()
    {
        lock (_lock) { if (_exclusive) return false; _running++; return true; }
    }

    public void ExitShared() { lock (_lock) _running--; }

    public async Task<IDisposable> EnterExclusiveAsync(TimeProvider time, CancellationToken ct)
    {
        lock (_lock) _exclusive = true;

        while (Volatile.Read(ref _running) > 0)
            await Task.Delay(TimeSpan.FromSeconds(2), time, ct);

        return new Release(() => { lock (_lock) _exclusive = false; });
    }
    
    private sealed class Release(Action a) : IDisposable { public void Dispose() => a(); }
}