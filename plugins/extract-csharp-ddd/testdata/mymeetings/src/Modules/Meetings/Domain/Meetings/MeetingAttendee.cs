using CompanyName.MyMeetings.BuildingBlocks.Domain;
using CompanyName.MyMeetings.Modules.Meetings.Domain.Members;

namespace CompanyName.MyMeetings.Modules.Meetings.Domain.Meetings
{
    public class MeetingAttendee : Entity
    {
        internal MeetingId MeetingId { get; private set; }

        internal MemberId AttendeeId { get; private set; }

        private DateTime _decisionDate;

        private int _guestsNumber;

        internal MeetingAttendee(MeetingId meetingId, MemberId attendeeId, int guestsNumber)
        {
            MeetingId = meetingId;
            AttendeeId = attendeeId;
            _guestsNumber = guestsNumber;
            _decisionDate = DateTime.UtcNow;
        }
    }
}
