using System.IO.Compression;
using System.Text;
using System.Xml;
using Lifewood.PlatformApi.Contracts;

namespace Lifewood.PlatformApi.Features;

internal static class BookRecognitionContext
{
    internal static async Task<string> BuildAsync(BookInfoDto book, string folder, CancellationToken token)
    {
        var result = new StringBuilder();
        result.AppendLine($"Title: {book.Title}\nSubtitle: {book.Subtitle}\nSelling point: {book.SellingPoint}\nSynopsis: {book.Synopsis}");
        // Only read this authenticated project's manuscript. Never fetch external URLs.
        foreach (var asset in (book.SourceAssets ?? []).Where(a => a.CategoryId == "manuscript").Take(1))
        {
            if (!Guid.TryParseExact(asset.Id, "N", out _) || !Directory.Exists(folder)) continue;
            var path = Directory.EnumerateFiles(folder, $"{asset.Id}_*").FirstOrDefault();
            if (path is null || (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) continue;
            try
            {
                var text = new StringBuilder();
                if (asset.ContentType == "text/plain")
                {
                    using var reader = new StreamReader(path, Encoding.UTF8, true);
                    var buffer = new char[12000];
                    var count = await reader.ReadBlockAsync(buffer.AsMemory(), token);
                    text.Append(buffer, 0, count);
                }
                else if (asset.ContentType == "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
                {
                    using var zip = ZipFile.OpenRead(path);
                    var entry = zip.GetEntry("word/document.xml");
                    if (entry is null || entry.Length > 4_000_000) continue;
                    using var stream = entry.Open();
                    using var xml = XmlReader.Create(stream, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 4_000_000 });
                    while (text.Length < 12000 && xml.Read())
                    {
                        token.ThrowIfCancellationRequested();
                        if (xml.NodeType == XmlNodeType.Text) text.Append(xml.Value.AsSpan(0, Math.Min(xml.Value.Length, 12000 - text.Length)));
                        else if (xml.NodeType == XmlNodeType.EndElement && xml.LocalName == "p") text.AppendLine();
                    }
                }
                if (text.Length > 0) result.AppendLine("Manuscript excerpt:").Append(text);
            }
            catch (Exception ex) when (ex is IOException or InvalidDataException or XmlException)
            { /* Optional unreadable context must not prevent cover recognition. */ }
        }
        return result.ToString();
    }
}
