using Lifewood.PlatformApi.Persistence;
namespace Lifewood.PlatformApi.Features;
internal sealed class NotificationWorker(NotificationRepository repository,ILogger<NotificationWorker> logger):BackgroundService {
 protected override async Task ExecuteAsync(CancellationToken stoppingToken){var lastCleanup=DateTimeOffset.MinValue;while(!stoppingToken.IsCancellationRequested){try{repository.Dispatch();if(DateTimeOffset.UtcNow-lastCleanup>TimeSpan.FromHours(24)){repository.Cleanup();lastCleanup=DateTimeOffset.UtcNow;}}catch(Exception e){logger.LogError(e,"Notification delivery will retry");}await Task.Delay(TimeSpan.FromSeconds(2),stoppingToken);}}
}
