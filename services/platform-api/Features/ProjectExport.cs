using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.Json;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Serialization;

namespace Lifewood.PlatformApi.Features;

internal static class ProjectExport
{
    internal sealed record Attachment(string Entry, string Path, long Size);
    internal const long MaximumBytes = 1_000_000_000;
    internal static void Cleanup(string root)
    {
        var folder=Path.Combine(root,"exports");
        if(!Directory.Exists(folder))return;
        foreach(var file in Directory.EnumerateFiles(folder,"*.zip"))
            if(Guid.TryParseExact(Path.GetFileNameWithoutExtension(file),"N",out _))File.Delete(file);
    }
    internal static string SafeName(string value)
    {
        var safe = new string(value.Select(c => char.IsControl(c) || "<>:\"/\\|?*".Contains(c) ? '_' : c).ToArray()).Trim().Trim('.');
        if(string.IsNullOrEmpty(safe))return "attachment";
        if(safe.Length<=100)return safe;
        var extension=Path.GetExtension(safe);
        if(extension.Length>20)extension="";
        return safe[..(100-extension.Length)]+extension;
    }
    internal static List<Attachment> Attachments(string root, AdminProjectDetailDto detail)
    {
        if (!Guid.TryParseExact(detail.OwnerId, "N", out _) || !Guid.TryParseExact(detail.Project.Id, "N", out _)) throw new InvalidDataException();
        var folder = Path.Combine(root, "uploads", detail.OwnerId, detail.Project.Id);
        var result = new List<Attachment>();
        void Add(string group, IEnumerable<ReferenceAssetDto> assets)
        {
            foreach (var asset in assets)
            {
                if (!Guid.TryParseExact(asset.Id, "N", out _)) throw new InvalidDataException();
                var paths = Directory.Exists(folder) ? Directory.GetFiles(folder, asset.Id + "_*")
                    .Where(p => !p.EndsWith(".pending", StringComparison.OrdinalIgnoreCase) && !p.EndsWith(".upload", StringComparison.OrdinalIgnoreCase)).ToArray() : [];
                if (paths.Length != 1 || File.Exists(paths[0] + ".pending")) throw new InvalidDataException();
                var info = new FileInfo(paths[0]);
                if (info.Length != asset.SizeBytes || (info.Attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException();
                result.Add(new(group + "/" + asset.Id + "_" + SafeName(asset.FileName), paths[0], info.Length));
            }
        }
        Add("book", detail.Project.Book.SourceAssets ?? []);
        for (var i=0;i<detail.Project.Creative.Characters.Length;i++) Add("characters/" + (i+1), detail.Project.Creative.Characters[i].ReferenceImages ?? []);
        Add("style", detail.Project.Creative.StyleReferenceImages ?? []);
        Add("references", detail.Project.VoiceAndReferences.Assets);
        result = result.DistinctBy(x => x.Entry).ToList();
        if (result.Sum(x => x.Size) > MaximumBytes) throw new ExportTooLargeException();
        return result;
    }
    internal sealed class ExportTooLargeException : Exception;

    internal static async Task<FileStream> Build(string root, TaskDraftDto project, SubmissionConfigurationSnapshotDto? snapshot, List<Attachment> attachments, string locale, CancellationToken cancellation)
    {
        var folder = Path.Combine(root, "exports"); Directory.CreateDirectory(folder);
        var stream = new FileStream(Path.Combine(folder, Guid.NewGuid().ToString("N") + ".zip"), FileMode.CreateNew, FileAccess.ReadWrite, FileShare.Read,
            65536, FileOptions.Asynchronous | FileOptions.DeleteOnClose);
        try
        {
            using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
            {
                async Task Text(string name, string text)
                {
                    await using var entry = zip.CreateEntry(name).Open();
                    await entry.WriteAsync(Encoding.UTF8.GetBytes(text), cancellation);
                }
                var json = JsonSerializer.Serialize(project, AppJsonContext.Default.TaskDraftDto);
                await Text("project.json", json);
                await Text("brief.html", Brief(json, snapshot, attachments, locale));
                foreach (var item in attachments)
                {
                    cancellation.ThrowIfCancellationRequested();
                    await using var input = new FileStream(item.Path, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, FileOptions.Asynchronous);
                    if(input.Length != item.Size) throw new InvalidDataException();
                    await using var output = zip.CreateEntry(item.Entry, CompressionLevel.Fastest).Open();
                    await input.CopyToAsync(output, cancellation);
                }
            }
            stream.Position = 0; return stream;
        }
        catch { await stream.DisposeAsync(); throw; }
    }

    private static string Brief(string json, SubmissionConfigurationSnapshotDto? snapshot, List<Attachment> files, string locale)
    {
        var en = locale == "en-US";
        string E(string value) => WebUtility.HtmlEncode(value);
        var text = new StringBuilder("<!doctype html><html lang=\"" + (en?"en":"zh-CN") + "\"><meta charset=\"utf-8\"><title>" + (en?"Project brief":"项目需求说明") + "</title><style>body{font:15px/1.6 system-ui;max-width:960px;margin:24px auto;padding:16px;color:#173e30}dl{margin:8px 0 16px 16px}dt{font-weight:650}dd{margin:0 0 8px;white-space:pre-wrap;overflow-wrap:anywhere}h1{font-size:24px}h2{font-size:18px}li{overflow-wrap:anywhere}</style><h1>" + (en?"Project brief":"项目需求说明") + "</h1><p>" + (en?"Current project data. Uploaded attachments are included below. External links, preset images and voice previews remain references and are not downloaded.":"当前项目资料；已上传附件见下方目录。外部链接、预设图片及配音试听保留引用，不抓取下载。") + "</p><p>" + (snapshot is null ? (en?"No submission configuration snapshot is available; option IDs are retained.":"暂无提交配置快照，配置选项保留原始编号。") : (en?"Option names use the submission snapshot captured at ":"配置名称采用提交时快照：") + E(snapshot.CapturedAt.ToString("O"))) + "</p>");
        var groups = new Dictionary<string,string> { ["brandId"]="brands",["videoGoalId"]="video-goals",["audienceIds"]="audiences",["genreId"]="genres",["contentLanguageId"]="content-languages",["videoDurationId"]="video-durations",["publishingPlatformIds"]="publishing-platforms",["roleTypeId"]="role-types",["ageRangeId"]="age-ranges",["genderId"]="genders",["visualStyleId"]="visual-styles",["moodTagIds"]="mood-tags",["imageStyleTagIds"]="image-style-tags",["paceTagIds"]="pace-tags",["narrationToneId"]="narration-tones",["speechRateId"]="speech-rates",["voiceGenderId"]="voice-genders",["voiceAgeId"]="voice-ages",["accentId"]="accents",["emotionStyleId"]="voice-emotions" };
        string Value(string key,string value)
        {
            if(snapshot is not null && groups.TryGetValue(key,out var group))
            {
                var option=snapshot.FormOptions.FirstOrDefault(o=>o.GroupId==group && o.Id==value);
                if(option is not null)return en?option.LabelEnUs:option.LabelZhCn;
            }
            if(snapshot is not null && key is "selectedVoiceIds" or "preferredVoiceId")
            { var voice=snapshot.Voices.FirstOrDefault(v=>v.Id==value); if(voice is not null)return en?voice.NameEnUs:voice.NameZhCn; }
            return value;
        }
        void Render(JsonElement element, string key)
        {
            if(element.ValueKind==JsonValueKind.Object){text.Append("<dl>");foreach(var p in element.EnumerateObject()){text.Append("<dt>").Append(E(Labels.GetValueOrDefault(p.Name,p.Name))).Append("</dt><dd>");Render(p.Value,p.Name);text.Append("</dd>");}text.Append("</dl>");}
            else if(element.ValueKind==JsonValueKind.Array){text.Append("<ol>");foreach(var child in element.EnumerateArray()){text.Append("<li>");Render(child,key);text.Append("</li>");}text.Append("</ol>");}
            else text.Append(E(element.ValueKind==JsonValueKind.Null?"—":Value(key,element.ToString())));
        }
        using var document=JsonDocument.Parse(json); Render(document.RootElement, "");
        text.Append("<h2>").Append(en?"Included files":"已打包附件").Append("</h2><ul>");
        foreach(var file in files)text.Append("<li><a href=\"").Append(E(string.Join("/",file.Entry.Split('/').Select(Uri.EscapeDataString)))).Append("\">").Append(E(file.Entry)).Append("</a> · ").Append(file.Size).Append(" bytes</li>");
        return text.Append("</ul></html>").ToString();
    }
    // Bilingual field labels keep exported briefs readable independently of the application.
    private static readonly Dictionary<string,string> Labels = new()
    {
        ["id"]="编号 / ID",
        ["taskNumber"]="项目编号 / Project number",
        ["status"]="提交状态 / Submission status",
        ["version"]="版本 / Version",
        ["project"]="项目 / Project",
        ["book"]="书籍 / Book",
        ["creative"]="创意 / Creative",
        ["voiceAndReferences"]="配音与参考 / Voice and references",
        ["createdAt"]="创建时间 / Created",
        ["updatedAt"]="更新时间 / Updated",
        ["workflowStatus"]="工作流 / Workflow",
        ["clientName"]="客户 / Client",
        ["contactName"]="联系人 / Contact",
        ["email"]="邮箱 / Email",
        ["phone"]="电话 / Phone",
        ["brandId"]="品牌 / Brand",
        ["projectName"]="项目名称 / Project name",
        ["videoGoalId"]="视频目标 / Video goal",
        ["deadline"]="客户截止日期 / Customer deadline",
        ["audienceIds"]="受众 / Audience",
        ["title"]="书名 / Book title",
        ["subtitle"]="副标题 / Subtitle",
        ["authorName"]="作者 / Author",
        ["genreId"]="类型 / Genre",
        ["sellingPoint"]="卖点 / Selling point",
        ["synopsis"]="简介 / Synopsis",
        ["contentLanguageId"]="语言 / Language",
        ["videoDurationId"]="时长 / Duration",
        ["customVideoDuration"]="自定义时长 / Custom duration",
        ["publishingPlatformIds"]="发布平台 / Platforms",
        ["sourceAssets"]="书籍资料 / Book files",
        ["characters"]="角色 / Characters",
        ["roleTypeId"]="角色类型 / Role type",
        ["name"]="名称 / Name",
        ["storyRole"]="故事作用 / Story role",
        ["personality"]="性格 / Personality",
        ["appearance"]="外观 / Appearance",
        ["ageRangeId"]="年龄段 / Age range",
        ["genderId"]="性别 / Gender",
        ["clothing"]="服装 / Clothing",
        ["emotion"]="情绪 / Emotion",
        ["voiceHint"]="声音要求 / Voice direction",
        ["referenceImageUrls"]="参考图链接 / Image URLs",
        ["referenceImages"]="参考图 / Reference images",
        ["presetId"]="预设编号 / Preset ID",
        ["presetImageUrl"]="预设图片链接 / Preset image URL",
        ["visualStyleId"]="视觉风格 / Visual style",
        ["moodTagIds"]="氛围 / Mood",
        ["imageStyleTagIds"]="影像风格 / Image style",
        ["paceTagIds"]="节奏 / Pace",
        ["styleReferenceImageUrls"]="风格链接 / Style URLs",
        ["styleReferenceImages"]="风格参考 / Style references",
        ["categoryId"]="类别编号 / Category ID",
        ["fileName"]="文件名 / File name",
        ["contentType"]="文件类型 / Content type",
        ["sizeBytes"]="字节 / Bytes",
        ["url"]="链接 / URL",
        ["voiceover"]="配音 / Voiceover",
        ["narrationToneId"]="语气 / Tone",
        ["speechRateId"]="语速 / Speech rate",
        ["pronunciationNotes"]="发音说明 / Pronunciation notes",
        ["voiceGenderId"]="声音性别 / Voice gender",
        ["voiceAgeId"]="声音年龄 / Voice age",
        ["accentId"]="口音 / Accent",
        ["emotionStyleId"]="情感 / Voice emotion",
        ["selectedVoiceIds"]="候选配音 / Selected voices",
        ["preferredVoiceId"]="首选配音 / Preferred voice",
        ["customVoiceDescription"]="配音要求 / Voice description",
        ["narrationEnabled"]="启用旁白 / Narration enabled",
        ["assets"]="参考资料 / References",
        ["competitorUrls"]="竞品链接 / Competitor URLs",
        ["creativeDirection"]="创作方向 / Creative direction",
        ["coreMessage"]="核心信息 / Core message",
        ["requiredScenes"]="必需场景 / Required scenes",
        ["authorPreferences"]="作者偏好 / Author preferences",
        ["closingMessage"]="结尾信息 / Closing message",
        ["musicMood"]="音乐氛围 / Music mood",
        ["avoidContent"]="避免内容 / Content to avoid",
    };
}
