using CompanyName.MyMeetings.BuildingBlocks.Domain;

namespace CompanyName.MyMeetings.Modules.Meetings.Domain.Meetings
{
    /// <summary>When a meeting starts and ends.</summary>
    public class MeetingTerm : ValueObject
    {
        public DateTime StartDate { get; }

        public DateTime EndDate { get; }

        private MeetingTerm(DateTime startDate, DateTime endDate)
        {
            StartDate = startDate;
            EndDate = endDate;
        }

        public static MeetingTerm CreateNewBetweenDates(DateTime startDate, DateTime endDate) => new MeetingTerm(startDate, endDate);
    }
}
