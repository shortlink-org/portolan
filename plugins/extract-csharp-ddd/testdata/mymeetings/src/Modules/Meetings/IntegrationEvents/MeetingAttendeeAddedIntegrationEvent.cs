using CompanyName.MyMeetings.BuildingBlocks.Infrastructure.EventBus;

namespace CompanyName.MyMeetings.Modules.Meetings.IntegrationEvents
{
    public class MeetingAttendeeAddedIntegrationEvent : IntegrationEvent
    {
        public MeetingAttendeeAddedIntegrationEvent(Guid id, DateTime occurredOn, Guid meetingId, Guid attendeeId)
            : base(id, occurredOn)
        {
            MeetingId = meetingId;
            AttendeeId = attendeeId;
        }

        public Guid MeetingId { get; }

        public Guid AttendeeId { get; }
    }
}
