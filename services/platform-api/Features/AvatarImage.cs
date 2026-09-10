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

    public static string CreateOrganization(string name)
    {
        var clean = string.Concat(name.EnumerateRunes().Where(r => !Rune.IsControl(r) && r.Value is not (0xfffe or 0xffff)).Select(r => r.ToString()));
        var value = string.Join(" ", clean.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)).ToUpperInvariant();
        if (value.Length == 0) value = "?";
        var palette = Palettes[StableIndex(value, Palettes.Length)];
        var elements = StringInfo.GetTextElementEnumerator(value);
        var text = new StringBuilder(); double units = 0;
        while (elements.MoveNext())
        {
            var element = elements.GetTextElement();
            var width = element.EnumerateRunes().First().Value < 128 ? .65 : 1;
            if (units + width > 19) { text.Append('…'); units += 1; break; }
            text.Append(element); units += width;
        }
        var fontSize = Math.Clamp(530 / Math.Max(1, units), 26, 48);
        var length = Math.Min(530, units * fontSize);
        return $"""
            <svg xmlns="http://www.w3.org/2000/svg" width="600" height="100" viewBox="0 0 600 100">
              <rect width="600" height="100" rx="14" fill="{palette.Background}"/>
              <text x="300" y="52" text-anchor="middle" dominant-baseline="middle" fill="{palette.Foreground}" font-family="Segoe UI, Microsoft YaHei, Noto Sans SC, sans-serif" font-size="{fontSize.ToString("0.##", CultureInfo.InvariantCulture)}" font-weight="750" textLength="{length.ToString("0.##", CultureInfo.InvariantCulture)}" lengthAdjust="spacingAndGlyphs">{Escape(text.ToString())}</text>
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
