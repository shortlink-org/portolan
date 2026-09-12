using CompanyName.MyMeetings.Modules.Meetings.Application.Configuration.Queries;

namespace CompanyName.MyMeetings.Modules.Meetings.Application.Meetings.GetMeetingDetails
{
    public class GetMeetingDetailsQuery : QueryBase<MeetingDetailsDto>
    {
        public GetMeetingDetailsQuery(Guid meetingId)
        {
            MeetingId = meetingId;
        }

        public Guid MeetingId { get; }
    }

    public class MeetingDetailsDto
    {
        public Guid Id { get; set; }

        public string Title { get; set; }

        public DateTime TermStartDate { get; set; }
    }
}
