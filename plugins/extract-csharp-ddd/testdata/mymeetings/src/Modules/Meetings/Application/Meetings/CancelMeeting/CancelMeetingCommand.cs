using CompanyName.MyMeetings.Modules.Meetings.Application.Configuration.Commands;

namespace CompanyName.MyMeetings.Modules.Meetings.Application.Meetings.CancelMeeting
{
    public class CancelMeetingCommand : CommandBase
    {
        public CancelMeetingCommand(Guid meetingId)
        {
            MeetingId = meetingId;
        }

        public Guid MeetingId { get; }
    }
}
