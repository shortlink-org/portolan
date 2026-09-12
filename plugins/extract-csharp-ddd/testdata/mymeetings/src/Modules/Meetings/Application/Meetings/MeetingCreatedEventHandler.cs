using CompanyName.MyMeetings.Modules.Meetings.Domain.Meetings;
using CompanyName.MyMeetings.Modules.Meetings.Domain.Meetings.Events;
using MediatR;

namespace CompanyName.MyMeetings.Modules.Meetings.Application.Meetings
{
    internal class MeetingCreatedEventHandler : INotificationHandler<MeetingCreatedDomainEvent>
    {
        private readonly IMeetingRepository _meetingRepository;

        public MeetingCreatedEventHandler(IMeetingRepository meetingRepository)
        {
            _meetingRepository = meetingRepository;
        }

        public async Task Handle(MeetingCreatedDomainEvent @event, CancellationToken cancellationToken)
        {
            var meeting = await _meetingRepository.GetByIdAsync(@event.MeetingId);
        }
    }
}
