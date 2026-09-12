// A YAML writer for one shape: the OpenAPI document. Maps keep insertion
// order, scalars are quoted when YAML would read them as something else, and
// nothing here reads YAML.

using System.Globalization;
using System.Text;

namespace Portolan.Extract.CSharp;

public sealed class YamlMap
{
    public List<(string Key, object? Value)> Entries { get; } = new();

    public YamlMap Set(string key, object? value)
    {
        Entries.Add((key, value));
        return this;
    }
}

public static class Yaml
{
    public static string Write(YamlMap document)
    {
        var sb = new StringBuilder();
        WriteMap(sb, document, 0);
        return sb.ToString();
    }

    private static void WriteMap(StringBuilder sb, YamlMap map, int indent)
    {
        foreach (var (key, value) in map.Entries)
        {
            sb.Append(' ', indent).Append(Scalar(key)).Append(':');
            WriteValue(sb, value, indent, inList: false);
        }
    }

    private static void WriteValue(StringBuilder sb, object? value, int indent, bool inList)
    {
        switch (value)
        {
            case YamlMap m when m.Entries.Count == 0:
                sb.Append(" {}\n");
                break;
            case YamlMap m:
                if (inList)
                {
                    // The first entry sits on the dash's line.
                    var first = true;
                    foreach (var (key, v) in m.Entries)
                    {
                        if (first) { sb.Append(' ').Append(Scalar(key)).Append(':'); first = false; }
                        else sb.Append(' ', indent + 2).Append(Scalar(key)).Append(':');
                        WriteValue(sb, v, indent + 2, inList: false);
                    }
                }
                else
                {
                    sb.Append('\n');
                    WriteMap(sb, m, indent + 2);
                }
                break;
            case List<object?> list when list.Count == 0:
                sb.Append(" []\n");
                break;
            case List<object?> list:
                sb.Append('\n');
                foreach (var item in list)
                {
                    sb.Append(' ', indent + (inList ? 2 : 2)).Append('-');
                    if (item is YamlMap || item is List<object?>) WriteValue(sb, item, indent + 2, inList: true);
                    else { sb.Append(' ').Append(Scalar(item)).Append('\n'); }
                }
                break;
            default:
                sb.Append(' ').Append(Scalar(value)).Append('\n');
                break;
        }
    }

    private static string Scalar(object? value) => value switch
    {
        null => "null",
        bool b => b ? "true" : "false",
        int i => i.ToString(CultureInfo.InvariantCulture),
        long l => l.ToString(CultureInfo.InvariantCulture),
        string s => Quote(s),
        _ => Quote(value.ToString() ?? ""),
    };

    private static string Quote(string s)
    {
        if (s.Length == 0) return "\"\"";
        var plain = !NeedsQuotes(s);
        if (plain) return s;
        var sb = new StringBuilder("\"");
        foreach (var c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\t': sb.Append("\\t"); break;
                default: sb.Append(c); break;
            }
        }
        return sb.Append('"').ToString();
    }

    private static bool NeedsQuotes(string s)
    {
        if (s != s.Trim()) return true;
        var lower = s.ToLowerInvariant();
        if (lower is "true" or "false" or "null" or "yes" or "no" or "on" or "off" or "~") return true;
        if (double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out _)) return true;
        if (s.StartsWith('{') || s.StartsWith('[') || s.StartsWith('&') || s.StartsWith('*') || s.StartsWith('!') || s.StartsWith('|') || s.StartsWith('>') || s.StartsWith('%') || s.StartsWith('@') || s.StartsWith('`') || s.StartsWith('"') || s.StartsWith('\'') || s.StartsWith('-') || s.StartsWith('?') || s.StartsWith('#')) return true;
        if (s.Contains(": ") || s.EndsWith(':') || s.Contains(" #") || s.Contains('\n') || s.Contains('\t')) return true;
        return false;
    }
}
