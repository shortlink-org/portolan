using CompanyName.MyMeetings.BuildingBlocks.Infrastructure.EventBus;
using CompanyName.MyMeetings.Modules.Meetings.IntegrationEvents;
using MediatR;

namespace CompanyName.MyMeetings.Modules.Meetings.Application.Meetings
{
    public class MeetingAttendeeAddedPublishEventHandler : INotificationHandler<MeetingAttendeeAddedNotification>
    {
        private readonly IEventsBus _eventsBus;

        public MeetingAttendeeAddedPublishEventHandler(IEventsBus eventsBus)
        {
            _eventsBus = eventsBus;
        }

        public async Task Handle(MeetingAttendeeAddedNotification notification, CancellationToken cancellationToken)
        {
            await _eventsBus.Publish(new MeetingAttendeeAddedIntegrationEvent(
                notification.Id,
                notification.DomainEvent.OccurredOn,
                notification.DomainEvent.MeetingId.Value,
                notification.DomainEvent.AttendeeId.Value));
        }
    }
}
