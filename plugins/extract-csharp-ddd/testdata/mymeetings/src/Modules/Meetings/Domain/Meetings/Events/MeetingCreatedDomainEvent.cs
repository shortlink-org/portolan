using CompanyName.MyMeetings.BuildingBlocks.Domain;

namespace CompanyName.MyMeetings.Modules.Meetings.Domain.Meetings.Events
{
    /// <summary>A meeting was announced.</summary>
    public class MeetingCreatedDomainEvent : DomainEventBase
    {
        public MeetingCreatedDomainEvent(MeetingId meetingId)
        {
            MeetingId = meetingId;
        }

        public MeetingId MeetingId { get; }
    }
}
