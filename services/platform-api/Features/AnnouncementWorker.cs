using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Persistence;
namespace Lifewood.PlatformApi.Features;
internal sealed class AnnouncementWorker(AnnouncementRepository notices, BackupGate gate, ILogger<AnnouncementWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while(!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var lease=gate.TryEnter();
                if(lease is not null) foreach(var job in notices.Due(DateTimeOffset.UtcNow))
                {
                    if(stoppingToken.IsCancellationRequested)break;
                    try {
                    var error=notices.Transition(job.Id,job.Version,true,out _,automated:true);
                    if(error is not null && error!="conflict")notices.FailSchedule(job.Id,job.Version);
                    } catch(Exception error) { notices.FailSchedule(job.Id,job.Version); logger.LogError(error,"Scheduled announcement {Id} failed",job.Id); }
                }
            }
            catch(Exception error){logger.LogError(error,"Scheduled announcement processing will retry");}
            try {await Task.Delay(TimeSpan.FromSeconds(5),stoppingToken);} catch(OperationCanceledException) when(stoppingToken.IsCancellationRequested){break;}
        }
    }
}
