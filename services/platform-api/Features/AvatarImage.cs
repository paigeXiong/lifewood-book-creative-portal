using System.Globalization;
using System.Text;

namespace Lifewood.PlatformApi.Features;

internal static class AvatarImage
{
    private static readonly (string Background, string Foreground)[] Palettes =
    [
        ("#DCEFE5", "#075B42"),
        ("#E6EEE9", "#17372C"),
        ("#FFF0C7", "#6B4B00"),
        ("#DDEAF7", "#174E78"),
        ("#E8E1F3", "#563A78"),
        ("#F3E3DD", "#753C2B")
    ];

    public static string Create(string userId, string displayName)
    {
        var initials = Initials(displayName);
        var palette = Palettes[StableIndex(userId, Palettes.Length)];
        var fontSize = initials.EnumerateRunes().Count() > 1 ? 34 : 40;
        return $"""
            <svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
              <rect width="96" height="96" rx="48" fill="{palette.Background}"/>
              <text x="48" y="50" text-anchor="middle" dominant-baseline="middle" fill="{palette.Foreground}" font-family="Segoe UI, Microsoft YaHei, Noto Sans SC, sans-serif" font-size="{fontSize}" font-weight="700">{Escape(initials)}</text>
            </svg>
            """;
    }

    internal static string Initials(string displayName)
    {
        var value = displayName.Trim();
        if (value.Length == 0) return "?";
        var words = value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        if (words.Length > 1) return (FirstElement(words[0]) + FirstElement(words[^1])).ToUpperInvariant();
        var elements = StringInfo.GetTextElementEnumerator(value);
        var result = new StringBuilder();
        while (elements.MoveNext() && result.ToString().EnumerateRunes().Count() < 2) result.Append(elements.GetTextElement());
        return result.ToString().ToUpperInvariant();
    }

    private static string FirstElement(string value) => StringInfo.GetNextTextElement(value);

    private static int StableIndex(string value, int length)
    {
        uint hash = 2166136261;
        foreach (var character in value)
        {
            hash ^= character;
            hash *= 16777619;
        }
        return (int)(hash % (uint)length);
    }

    private static string Escape(string value) => value
        .Replace("&", "&amp;", StringComparison.Ordinal)
        .Replace("<", "&lt;", StringComparison.Ordinal)
        .Replace(">", "&gt;", StringComparison.Ordinal)
        .Replace("\"", "&quot;", StringComparison.Ordinal)
        .Replace("'", "&apos;", StringComparison.Ordinal);
}
