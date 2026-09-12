using CompanyName.MyMeetings.Modules.Meetings.Application.Configuration.Commands;
using CompanyName.MyMeetings.Modules.Meetings.Domain.Meetings;
using CompanyName.MyMeetings.Modules.Meetings.Domain.Members;

namespace CompanyName.MyMeetings.Modules.Meetings.Application.Meetings.CreateMeeting
{
    internal class CreateMeetingCommandHandler : ICommandHandler<CreateMeetingCommand, Guid>
    {
        private readonly IMeetingRepository _meetingRepository;

        internal CreateMeetingCommandHandler(IMeetingRepository meetingRepository)
        {
            _meetingRepository = meetingRepository;
        }

        public async Task<Guid> Handle(CreateMeetingCommand request, CancellationToken cancellationToken)
        {
            var meeting = Meeting.CreateNew(
                request.Title,
                MeetingTerm.CreateNewBetweenDates(request.TermStartDate, request.TermEndDate),
                new MemberId(Guid.NewGuid()));

            await _meetingRepository.AddAsync(meeting);

            return meeting.Id.Value;
        }
    }
}
