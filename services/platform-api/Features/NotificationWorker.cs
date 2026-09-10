using Lifewood.PlatformApi.Persistence;
namespace Lifewood.PlatformApi.Features;
internal sealed class NotificationWorker(NotificationRepository repository, OperationsRepository operations, ILogger<NotificationWorker> logger, BackupGate gate) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var lastCleanup=DateTimeOffset.MinValue;
        var lastReminders=DateTimeOffset.MinValue;
        while(!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var lease = gate.TryEnter();
                if (lease is null) { await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken); continue; }
                var now=DateTimeOffset.UtcNow;
                if(now-lastReminders>TimeSpan.FromMinutes(1)){operations.CreateDueReminders(now);lastReminders=now;}
                repository.Dispatch();
                if(now-lastCleanup>TimeSpan.FromHours(24)){repository.Cleanup();lastCleanup=now;}
            }
            catch(Exception e){logger.LogError(e,"Notification delivery will retry");}
            await Task.Delay(TimeSpan.FromSeconds(2),stoppingToken);
        }
    }
}
