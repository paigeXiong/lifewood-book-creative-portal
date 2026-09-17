using Lifewood.PlatformApi.Persistence;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Microsoft.Data.Sqlite;
using Xunit;
namespace Lifewood.PlatformApi.Tests;
public sealed class AuditEnhancementTests : IDisposable
{
 private readonly string root = Path.Combine(Path.GetTempPath(), "lifewood-audit-tools-"+Guid.NewGuid().ToString("N"));
 private string Connection => "Data Source="+Path.Combine(root,"platform.db")+";Pooling=False";
 private static readonly CurrentUserDto Actor = new("owner",null,"Owner",null,"owner@example.test",null,["owner"],["admin.audit.read"],"en-US",null);
 public AuditEnhancementTests(){Directory.CreateDirectory(root);}
 private void Sql(string sql){using var c=new SqliteConnection(Connection);c.Open();using var q=c.CreateCommand();q.CommandText=sql;q.ExecuteNonQuery();}
 [Fact] public void ConfigurationSnapshotsStayHistoricalAndLegacyRowsAreNotBackfilled()
 {
  var options=new FormOptionRepository(Connection);options.Initialize();var audit=new AuditRepository(Connection,root);audit.Initialize();
  var action=new AuditActionMatch("form_option.upsert","form_option","audiences/general");
  Sql("INSERT OR REPLACE INTO form_options(group_id,id,label_zh_cn,label_en_us,enabled,sort_order,updated_at) VALUES('audiences','general','原名称','Original',1,1,'2026-01-01');");
  var before=audit.Capture(action);Sql("UPDATE form_options SET label_zh_cn='新名称',label_en_us='Updated',enabled=0 WHERE id='general' AND group_id='audiences';");
  audit.Record(Actor,action,"change-1",before);
  var item=Assert.Single(audit.List("新名称",null,null,null,1,30).Items);
  Assert.Equal("Original",Assert.Single(item.Context!.Changes!,x=>x.Field=="labelEn").Before);
  Assert.Equal("0",Assert.Single(item.Context.Changes!,x=>x.Field=="enabled").After);
  Sql("UPDATE form_options SET label_en_us='Third name' WHERE id='general' AND group_id='audiences';");
  Assert.Equal("Updated",audit.Present(item).Context!.LabelEn);Assert.Equal("recorded",audit.Present(item).Context!.Source);
  var legacy=item with{Context=null};Assert.Equal("Third name",audit.Present(legacy).Context!.LabelEn);Assert.Equal("current",audit.Present(legacy).Context!.Source);
  Assert.DoesNotContain(item.Context.Changes!,x=>x.Field.Contains("password")||x.Field.Contains("secret"));
 }
 [Fact] public void DeletedProjectRetainsRecordedNameWithoutDeadLink()
 {
  Sql("CREATE TABLE projects(id TEXT,book_json TEXT,project_json TEXT,task_number TEXT,first_submitted_at TEXT); INSERT INTO projects VALUES('p','{\"title\":\"Readable book\"}','{}','LW-001','2026-01-01');");
  var audit=new AuditRepository(Connection,root);audit.Initialize();var action=new AuditActionMatch("project.workflow_update","project","p");var before=audit.Capture(action);
  Sql("DELETE FROM projects;");audit.Record(Actor,action,"deleted",before);
  var item=audit.Present(Assert.Single(audit.List(null,null,null,null,1,30).Items));Assert.Equal("Readable book",item.Context!.LabelEn);Assert.Null(item.Context.Path);
 }
 [Theory][InlineData("=HYPERLINK(\"x\")")][InlineData(" +1")][InlineData("@SUM(A1)")][InlineData("\tformula")]
 public void CsvNeutralizesSpreadsheetFormulas(string value){Assert.StartsWith("\"'",AuditEndpoints.CsvCell(value));}
 [Fact] public void RuntimeSamplesRealFilesAndReportsUnknownOnIncompleteScan()
 {
  Sql("CREATE TABLE notification_events(status TEXT); INSERT INTO notification_events VALUES('failed');");
  Directory.CreateDirectory(Path.Combine(root,"uploads"));Directory.CreateDirectory(Path.Combine(root,"deliveries"));
  File.WriteAllBytes(Path.Combine(root,"uploads","file"),new byte[17]);File.WriteAllBytes(Path.Combine(root,"deliveries","file"),new byte[23]);
  var monitor=new RuntimeMonitor(Connection,root,10000);var sample=monitor.Measure(CancellationToken.None);
  Assert.True(sample.DatabaseAvailable);Assert.True(sample.StorageComplete);Assert.Equal(17,sample.UploadBytes);Assert.Equal(23,sample.DeliveryBytes);Assert.Equal(1,sample.FailedNotifications);Assert.True(sample.UsedBytes>=40);
  Assert.Equal(sample.UsedBytes,sample.UploadBytes+sample.DeliveryBytes+sample.DatabaseBytes+sample.AvatarBytes+sample.OtherBytes);
  var absent=new RuntimeMonitor(Connection,Path.Combine(root,"missing"),10000).Measure(CancellationToken.None);Assert.False(absent.StorageComplete);Assert.Null(absent.UsedBytes);
 }
 [Fact] public void StorageBreakdownKeepsBackupsSeparateAndMissingBackupScanUnknown(){
  Sql("CREATE TABLE notification_events(status TEXT);");
  var data=Path.Combine(root,"data");var backup=Path.Combine(root,"backups");Directory.CreateDirectory(data);Directory.CreateDirectory(backup);Directory.CreateDirectory(Path.Combine(data,"avatars"));
  File.WriteAllBytes(Path.Combine(data,"platform.db"),new byte[11]);File.WriteAllBytes(Path.Combine(data,"platform.db-wal"),new byte[7]);
  File.WriteAllBytes(Path.Combine(data,"avatars","one.png"),new byte[13]);File.WriteAllBytes(Path.Combine(data,"settings.json"),new byte[5]);File.WriteAllBytes(Path.Combine(backup,"backup.zip"),new byte[101]);
  var sample=new RuntimeMonitor(Connection,data,1000,backup).Measure(CancellationToken.None);
  Assert.Equal(36,sample.UsedBytes);Assert.Equal(18,sample.DatabaseBytes);Assert.Equal(13,sample.AvatarBytes);Assert.Equal(5,sample.OtherBytes);Assert.Equal(101,sample.BackupBytes);
  var missing=new RuntimeMonitor(Connection,data,1000,Path.Combine(root,"absent")).Measure(CancellationToken.None);Assert.True(missing.StorageComplete);Assert.Null(missing.BackupBytes);
 }
 public void Dispose(){SqliteConnection.ClearAllPools();Directory.Delete(root,true);}
}
