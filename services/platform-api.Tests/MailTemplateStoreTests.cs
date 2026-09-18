using Lifewood.PlatformApi.Features;
using Xunit;
namespace Lifewood.PlatformApi.Tests;
public sealed class MailTemplateStoreTests
{
 [Fact] public void TemplatesPersistValidateProtectLinksAndHandleConflicts() {
  var path=Path.Combine(Path.GetTempPath(),"template-"+Guid.NewGuid()+".db");
  try {
   var store=new MailTemplateStore("Data Source="+path+";Pooling=False");store.Initialize();
   Assert.Null(store.Save("reset","zh-CN",new("default","新标题","<script>hello</script>",true)));
   var rendered=store.Render("reset","zh-CN","https://example.test/action");
   Assert.Contains("https://example.test/action",rendered.Body.Text);Assert.Contains("10",rendered.Body.Text);Assert.Contains("&lt;script&gt;",rendered.Body.Html);Assert.DoesNotContain("<script>",rendered.Body.Html);
   Assert.Equal("conflict",store.Save("reset","zh-CN",new("default","标题","正文",true)));
   Assert.Equal("invalid",store.Save("reset","zh-CN",new(rendered.Revision,"标题","正文",false)));
   Assert.Equal("invalid",store.Save("reset","zh-CN",new(rendered.Revision,"title\nBcc: x","body",true)));
   Assert.Null(store.Save("notice","en-US",new("default","Notice","Body",false)));
   Assert.False(new MailTemplateStore("Data Source="+path+";Pooling=False").Preview("en-US").Single(t=>t.Kind=="notice").Enabled);
   Assert.True(store.Preview("zh-CN").Single(t=>t.Kind=="notice").Enabled);
   Assert.Null(store.Save("reset","zh-CN",new(rendered.Revision,"","",false,true)));
   Assert.Equal(MailTemplates.Preview("zh-CN").Single(t=>t.Kind=="reset").Subject,store.Preview("zh-CN").Single(t=>t.Kind=="reset").Subject);
  } finally {if(File.Exists(path))File.Delete(path);}
 }
}
