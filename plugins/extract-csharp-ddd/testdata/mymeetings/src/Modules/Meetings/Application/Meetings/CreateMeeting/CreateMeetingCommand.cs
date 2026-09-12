using CompanyName.MyMeetings.Modules.Meetings.Application.Configuration.Commands;

namespace CompanyName.MyMeetings.Modules.Meetings.Application.Meetings.CreateMeeting
{
    /// <summary>Announce a meeting.</summary>
    public class CreateMeetingCommand : CommandBase<Guid>
    {
        public CreateMeetingCommand(string title, DateTime termStartDate, DateTime termEndDate)
        {
            Title = title;
            TermStartDate = termStartDate;
            TermEndDate = termEndDate;
        }

        public string Title { get; }

        public DateTime TermStartDate { get; }

        public DateTime TermEndDate { get; }
    }
}
