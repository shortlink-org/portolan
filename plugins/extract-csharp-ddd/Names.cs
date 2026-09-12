// Names: the kebab-case ids and urls use, the words a PascalCase identifier
// is made of, and the suffixes the layout's vocabulary puts on a class.

using System.Text;
using System.Text.RegularExpressions;

namespace Portolan.Extract.CSharp;

public static partial class Names
{
    /// "MeetingGroupProposal" -> "meeting-group-proposal"; "RSVPTerm" -> "rsvp-term".
    public static string Kebab(string name)
    {
        var words = Words(name);
        return string.Join("-", words.Select(w => w.ToLowerInvariant()));
    }

    /// "MeetingGroupProposal" -> ["Meeting", "Group", "Proposal"], an acronym
    /// kept whole: "RSVPTerm" -> ["RSVP", "Term"].
    public static List<string> Words(string name)
    {
        var words = new List<string>();
        var current = new StringBuilder();
        var trimmed = name.TrimStart('_', '@');
        for (var i = 0; i < trimmed.Length; i++)
        {
            var c = trimmed[i];
            if (c == '_' || c == '-' || c == ' ' || c == '.')
            {
                if (current.Length > 0) { words.Add(current.ToString()); current.Clear(); }
                continue;
            }
            var startsWord = current.Length > 0 && (
                (char.IsUpper(c) && (char.IsLower(trimmed[i - 1]) || char.IsDigit(trimmed[i - 1])))
                || (char.IsUpper(c) && i + 1 < trimmed.Length && char.IsLower(trimmed[i + 1]) && char.IsUpper(trimmed[i - 1]))
                || (char.IsDigit(c) && char.IsLetter(trimmed[i - 1])));
            if (startsWord) { words.Add(current.ToString()); current.Clear(); }
            current.Append(c);
        }
        if (current.Length > 0) words.Add(current.ToString());
        return words;
    }

    /// "GetMeetingDetails" -> "Get meeting details".
    public static string Sentence(string name)
    {
        var words = Words(name);
        if (words.Count == 0) return name;
        return string.Join(" ", words.Select((w, i) => i == 0 ? w : (w.All(char.IsUpper) && w.Length > 1 ? w : w.ToLowerInvariant())));
    }

    /// "UserAccess" -> "User Access".
    public static string Title(string name) => string.Join(" ", Words(name));

    /// "_meetingGroupId" -> "meetingGroupId"; "Title" -> "title".
    public static string Camel(string name)
    {
        var trimmed = name.TrimStart('_', '@');
        if (trimmed.Length == 0) return trimmed;
        if (trimmed.Length > 1 && char.IsUpper(trimmed[0]) && char.IsUpper(trimmed[1])) return trimmed;
        return char.ToLowerInvariant(trimmed[0]) + trimmed[1..];
    }

    public static string Strip(string name, params string[] suffixes)
    {
        foreach (var suffix in suffixes)
        {
            if (name.EndsWith(suffix, StringComparison.Ordinal) && name.Length > suffix.Length) return name[..^suffix.Length];
        }
        return name;
    }

    /// One paragraph of an XML doc comment's <summary>, the way a reader would
    /// see it: whitespace collapsed, tags dropped.
    public static string Summary(string? xml)
    {
        if (string.IsNullOrWhiteSpace(xml)) return "";
        var match = SummaryTag().Match(xml);
        var text = match.Success ? match.Groups[1].Value : "";
        text = Tag().Replace(text, "");
        return Whitespace().Replace(text, " ").Trim();
    }

    [GeneratedRegex(@"<summary>(.*?)</summary>", RegexOptions.Singleline)]
    private static partial Regex SummaryTag();

    [GeneratedRegex(@"<[^>]+>")]
    private static partial Regex Tag();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();
}
