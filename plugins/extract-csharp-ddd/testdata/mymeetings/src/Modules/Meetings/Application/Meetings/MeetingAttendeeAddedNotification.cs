using CompanyName.MyMeetings.BuildingBlocks.Application.Events;
using CompanyName.MyMeetings.Modules.Meetings.Domain.Meetings.Events;

namespace CompanyName.MyMeetings.Modules.Meetings.Application.Meetings
{
    public class MeetingAttendeeAddedNotification : DomainNotificationBase<MeetingAttendeeAddedDomainEvent>
    {
        public MeetingAttendeeAddedNotification(MeetingAttendeeAddedDomainEvent domainEvent, Guid id)
            : base(domainEvent, id)
        {
        }
    }
}
