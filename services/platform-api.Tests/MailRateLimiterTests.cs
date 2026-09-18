using Lifewood.PlatformApi.Features;
using Xunit;
namespace Lifewood.PlatformApi.Tests;
public sealed class MailRateLimiterTests:IDisposable {
 private readonly string root=Path.Combine(Path.GetTempPath(),"mail-quota-"+Guid.NewGuid().ToString("N"));
 private static MailConfiguration Config(int minute=2,int day=3)=>new(true,"smtp.example.test",587,"sender@example.test","","","https://example.test",minute,day);
 [Fact] public void RollingWindowsPersistAndSettingsChangesDoNotResetCounts(){
  var limiter=new MailRateLimiter(root);
  Assert.Null(limiter.Check(Config(),true,100000).ResumeAt);
  Assert.Null(limiter.Check(Config(),true,100001).ResumeAt);
  Assert.Equal(100060L,limiter.Check(Config(),true,100002).ResumeAt);
  var reopened=new MailRateLimiter(root);
  Assert.Equal(2,reopened.Check(Config(),false,100002).DayUsed);
  Assert.Null(reopened.Check(Config(),true,100060).ResumeAt);
  Assert.Equal(186400L,reopened.Check(Config(),true,100061).ResumeAt);
  Assert.Null(reopened.Check(Config(10,4),false,100061).ResumeAt);
  Assert.Equal(3,reopened.Check(Config(10,4),false,100061).DayUsed);
  Assert.Null(reopened.Check(Config(),true,186400).ResumeAt);
 }
 [Fact] public async Task ConcurrentReservationsAcrossInstancesStayWithinQuota(){
  var a=new MailRateLimiter(root);var b=new MailRateLimiter(root);
  var results=await Task.WhenAll(Enumerable.Range(0,20).Select(i=>Task.Run(()=>(i%2==0?a:b).Check(Config(3,3),true,100000))));
  Assert.Equal(3,results.Count(x=>x.ResumeAt is null));
  Assert.Equal(3,a.Check(Config(3,3),false,100000).DayUsed);
 }
 public void Dispose(){if(Directory.Exists(root))Directory.Delete(root,true);}
}
