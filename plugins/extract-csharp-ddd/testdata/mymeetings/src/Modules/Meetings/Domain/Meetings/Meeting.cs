using CompanyName.MyMeetings.BuildingBlocks.Domain;
using CompanyName.MyMeetings.Modules.Meetings.Domain.Meetings.Events;
using CompanyName.MyMeetings.Modules.Meetings.Domain.Members;

namespace CompanyName.MyMeetings.Modules.Meetings.Domain.Meetings
{
    /// <summary>A meeting of a group: who comes, when and where.</summary>
    public class Meeting : Entity, IAggregateRoot
    {
        private readonly List<MeetingAttendee> _attendees;

        public MeetingId Id { get; private set; }

        private string _title;

        private MeetingTerm _term;

        private MeetingStatus _status;

        private MemberId _creatorId;

        private DateTime? _cancelDate;

        private Meeting()
        {
            _attendees = new List<MeetingAttendee>();
        }

        internal static Meeting CreateNew(string title, MeetingTerm term, MemberId creatorId)
        {
            var meeting = new Meeting();
            meeting.Id = new MeetingId(Guid.NewGuid());
            meeting._title = title;
            meeting._term = term;
            meeting._status = MeetingStatus.Planned;
            meeting._creatorId = creatorId;
            meeting.AddDomainEvent(new MeetingCreatedDomainEvent(meeting.Id));
            meeting.AddAttendee(creatorId, 0);
            return meeting;
        }

        public void AddAttendee(MemberId attendeeId, int guestsNumber)
        {
            _attendees.Add(new MeetingAttendee(this.Id, attendeeId, guestsNumber));
            this.AddDomainEvent(new MeetingAttendeeAddedDomainEvent(this.Id, attendeeId));
        }

        public void Cancel(MemberId cancelMemberId)
        {
            _status = MeetingStatus.Canceled;
            _cancelDate = DateTime.UtcNow;
            var canceled = new MeetingCanceledDomainEvent(this.Id, cancelMemberId);
            this.AddDomainEvent(canceled);
        }
    }
}
