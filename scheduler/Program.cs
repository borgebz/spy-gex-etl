using GexScheduler.Jobs;
using GexScheduler.Options;
using GexScheduler.Runners;
using GexScheduler.Scheduling;

var builder = Host.CreateApplicationBuilder(args);

builder.Services.Configure<SchedulerOptions>(builder.Configuration.GetSection("Scheduler"));

builder.Services.AddSingleton<KnimeRunner>();
builder.Services.AddSingleton<MarketCalendar>();
builder.Services.AddSingleton<JobGate>();
builder.Services.AddHostedService<PriceJob>();
builder.Services.AddHostedService<PipelineJob>();
builder.Services.AddHostedService<ArchiveJob>();

builder.Build().Run();
