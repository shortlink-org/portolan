namespace CompanyName.MyMeetings.Modules.Meetings.Domain.Meetings.Rules
{
    public class MeetingMustHaveTitleRule
    {
        public bool IsBroken(string title) => string.IsNullOrWhiteSpace(title);
    }
}
