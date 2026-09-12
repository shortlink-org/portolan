using CompanyName.MyMeetings.Modules.Meetings.Application.Configuration.Commands;
using CompanyName.MyMeetings.Modules.Meetings.Domain.Meetings;
using CompanyName.MyMeetings.Modules.Meetings.Domain.Members;

namespace CompanyName.MyMeetings.Modules.Meetings.Application.Meetings.CancelMeeting
{
    internal class CancelMeetingCommandHandler : ICommandHandler<CancelMeetingCommand>
    {
        private readonly IMeetingRepository _meetingRepository;

        internal CancelMeetingCommandHandler(IMeetingRepository meetingRepository)
        {
            _meetingRepository = meetingRepository;
        }

        public async Task Handle(CancelMeetingCommand request, CancellationToken cancellationToken)
        {
            var meeting = await _meetingRepository.GetByIdAsync(new MeetingId(request.MeetingId));

            meeting.Cancel(new MemberId(Guid.NewGuid()));
        }
    }
}
