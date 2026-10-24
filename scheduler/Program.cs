using GexScheduler.Jobs;
using GexScheduler.Options;
using GexScheduler.Runners;
using GexScheduler.Scheduling;
using GexScheduler.Startup;

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddOptions<SchedulerOptions>()
    .Bind(builder.Configuration.GetSection(SchedulerOptions.Section))
    .ValidateDataAnnotations()
    .Validate(o => File.Exists(o.KnimeExe), "KnimeExe not found")
    .Validate(o => File.Exists(o.PythonExe), "PythonExe not found")
    .Validate(o => Directory.Exists(o.WorkflowRoot), "WorkflowRoot not found")
    .Validate(o => o.PipelineEvery > TimeSpan.Zero && o.PriceEvery > TimeSpan.Zero, "intervals must be > 0")
    .Validate(o => o.MarketOpenEt < o.MarketCloseEt, "MarketOpenEt must be before MarketCloseEt")
    .ValidateOnStart();

builder.Logging.AddSimpleConsole(o =>
{
    o.SingleLine = true;
    o.TimestampFormat = "yyyy-MM-dd HH:mm:ss ";
});

// Time to kill a running KNIME process tree when launchd stops the service.
builder.Services.Configure<HostOptions>(o => o.ShutdownTimeout = TimeSpan.FromSeconds(60));

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<MarketCalendar>();
builder.Services.AddSingleton<JobGate>();
builder.Services.AddSingleton<ProcessRunner>();
builder.Services.AddSingleton<KnimeRunner>();
builder.Services.AddSingleton<PythonRunner>();

// Hosted services start in this order: copy the workflows before any job runs.
builder.Services.AddHostedService<WorkflowCopy>();
builder.Services.AddHostedService<KeepAwake>();
builder.Services.AddHostedService<PriceJob>();
builder.Services.AddHostedService<PipelineJob>();
builder.Services.AddHostedService<ArchiveJob>();

builder.Build().Run();
