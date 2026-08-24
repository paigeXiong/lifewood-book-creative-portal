using System.Buffers.Binary;
using System.Text;

namespace Lifewood.PlatformApi.Features;

internal static class IsoBmffVideoProbe
{
    private static readonly IReadOnlySet<string> AllowedBrands = new HashSet<string>(["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "qt  "], StringComparer.Ordinal);
    private static readonly IReadOnlySet<string> AllowedCodecs = new HashSet<string>(["avc1", "avc3", "hvc1", "hev1", "vp09", "av01", "mp4v"], StringComparer.Ordinal);

    public static bool IsSupportedVideo(string path)
    {
        try
        {
            using var stream = File.OpenRead(path);
            var brand = false;
            var mediaData = false;
            var videoTrack = false;
            while (stream.Position < stream.Length)
            {
                if (!TryReadBox(stream, stream.Length, out var box)) return false;
                if (box.Type == "ftyp") brand |= HasAllowedBrand(stream, box);
                else if (box.Type == "mdat") mediaData |= box.End > box.PayloadStart;
                else if (box.Type == "moov")
                {
                    if (!InspectMoov(stream, box, out var validTrack)) return false;
                    videoTrack |= validTrack;
                }
                stream.Position = box.End;
            }
            return brand && mediaData && videoTrack;
        }
        catch (IOException)
        {
            return false;
        }
    }

    private static bool InspectMoov(Stream stream, Box box, out bool validTrack)
    {
        validTrack = false;
        stream.Position = box.PayloadStart;
        while (stream.Position < box.End)
        {
            if (!TryReadBox(stream, box.End, out var child)) return false;
            if (child.Type == "trak")
            {
                if (!InspectTrack(stream, child, out var valid)) return false;
                validTrack |= valid;
            }
            stream.Position = child.End;
        }
        return stream.Position == box.End;
    }

    private static bool InspectTrack(Stream stream, Box box, out bool valid)
    {
        valid = false;
        stream.Position = box.PayloadStart;
        while (stream.Position < box.End)
        {
            if (!TryReadBox(stream, box.End, out var child)) return false;
            if (child.Type == "mdia")
            {
                if (!InspectMedia(stream, child, out var videoHandler, out var samples)) return false;
                valid |= videoHandler && samples;
            }
            stream.Position = child.End;
        }
        return stream.Position == box.End;
    }

    private static bool InspectMedia(Stream stream, Box box, out bool videoHandler, out bool samples)
    {
        videoHandler = false;
        samples = false;
        stream.Position = box.PayloadStart;
        while (stream.Position < box.End)
        {
            if (!TryReadBox(stream, box.End, out var child)) return false;
            if (child.Type == "hdlr") videoHandler |= IsVideoHandler(stream, child);
            else if (child.Type == "minf")
            {
                if (!InspectMediaInfo(stream, child, out var validSamples)) return false;
                samples |= validSamples;
            }
            stream.Position = child.End;
        }
        return stream.Position == box.End;
    }

    private static bool InspectMediaInfo(Stream stream, Box box, out bool validSamples)
    {
        validSamples = false;
        stream.Position = box.PayloadStart;
        while (stream.Position < box.End)
        {
            if (!TryReadBox(stream, box.End, out var child)) return false;
            if (child.Type == "stbl")
            {
                if (!InspectSampleTable(stream, child, out var valid)) return false;
                validSamples |= valid;
            }
            stream.Position = child.End;
        }
        return stream.Position == box.End;
    }

    private static bool InspectSampleTable(Stream stream, Box box, out bool valid)
    {
        var codec = false;
        var nonEmptySamples = false;
        stream.Position = box.PayloadStart;
        while (stream.Position < box.End)
        {
            if (!TryReadBox(stream, box.End, out var child)) { valid = false; return false; }
            if (child.Type == "stsd") codec |= HasAllowedCodec(stream, child);
            else if (child.Type == "stsz") nonEmptySamples |= HasNonEmptySamples(stream, child);
            stream.Position = child.End;
        }
        valid = codec && nonEmptySamples;
        return stream.Position == box.End;
    }

    private static bool HasAllowedBrand(Stream stream, Box box)
    {
        var length = box.End - box.PayloadStart;
        if (length < 8 || length > 4096 || length % 4 != 0) return false;
        stream.Position = box.PayloadStart;
        var buffer = new byte[(int)length];
        if (!ReadExactly(stream, buffer)) return false;
        if (AllowedBrands.Contains(Encoding.ASCII.GetString(buffer, 0, 4))) return true;
        for (var offset = 8; offset < buffer.Length; offset += 4)
            if (AllowedBrands.Contains(Encoding.ASCII.GetString(buffer, offset, 4))) return true;
        return false;
    }

    private static bool IsVideoHandler(Stream stream, Box box)
    {
        if (box.End - box.PayloadStart < 12) return false;
        stream.Position = box.PayloadStart + 8;
        Span<byte> value = stackalloc byte[4];
        return stream.Read(value) == 4 && value.SequenceEqual("vide"u8);
    }

    private static bool HasAllowedCodec(Stream stream, Box box)
    {
        if (box.End - box.PayloadStart < 16) return false;
        stream.Position = box.PayloadStart + 4;
        Span<byte> countBytes = stackalloc byte[4];
        if (stream.Read(countBytes) != 4 || BinaryPrimitives.ReadUInt32BigEndian(countBytes) == 0) return false;
        while (stream.Position < box.End)
        {
            if (!TryReadBox(stream, box.End, out var entry)) return false;
            if (AllowedCodecs.Contains(entry.Type)) return true;
            stream.Position = entry.End;
        }
        return false;
    }

    private static bool HasNonEmptySamples(Stream stream, Box box)
    {
        var length = box.End - box.PayloadStart;
        if (length < 12) return false;
        stream.Position = box.PayloadStart;
        Span<byte> header = stackalloc byte[12];
        if (stream.Read(header) != 12) return false;
        var constantSize = BinaryPrimitives.ReadUInt32BigEndian(header[4..8]);
        var count = BinaryPrimitives.ReadUInt32BigEndian(header[8..12]);
        if (count == 0) return false;
        if (constantSize > 0) return true;
        if ((ulong)(length - 12) < (ulong)count * 4) return false;
        Span<byte> size = stackalloc byte[4];
        for (uint index = 0; index < count; index++)
            if (stream.Read(size) != 4 || BinaryPrimitives.ReadUInt32BigEndian(size) == 0) return false;
        return true;
    }

    private static bool TryReadBox(Stream stream, long parentEnd, out Box box)
    {
        box = default;
        var start = stream.Position;
        if (start < 0 || parentEnd - start < 8) return false;
        Span<byte> header = stackalloc byte[8];
        if (stream.Read(header) != 8) return false;
        var size32 = BinaryPrimitives.ReadUInt32BigEndian(header[..4]);
        var type = Encoding.ASCII.GetString(header[4..8]);
        long headerSize = 8;
        ulong size = size32;
        if (size32 == 1)
        {
            Span<byte> extended = stackalloc byte[8];
            if (stream.Read(extended) != 8) return false;
            size = BinaryPrimitives.ReadUInt64BigEndian(extended);
            headerSize = 16;
        }
        else if (size32 == 0) size = (ulong)(parentEnd - start);
        if (size < (ulong)headerSize || size > long.MaxValue) return false;
        var end = start + (long)size;
        if (end <= start || end > parentEnd) return false;
        box = new(type, start + headerSize, end);
        return true;
    }

    private static bool ReadExactly(Stream stream, byte[] buffer)
    {
        var offset = 0;
        while (offset < buffer.Length)
        {
            var read = stream.Read(buffer, offset, buffer.Length - offset);
            if (read == 0) return false;
            offset += read;
        }
        return true;
    }

    private readonly record struct Box(string Type, long PayloadStart, long End);
}
