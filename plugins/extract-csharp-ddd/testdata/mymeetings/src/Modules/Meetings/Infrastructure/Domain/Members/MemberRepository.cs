using CompanyName.MyMeetings.Modules.Meetings.Domain.Members;

namespace CompanyName.MyMeetings.Modules.Meetings.Infrastructure.Domain.Members
{
    internal class MemberRepository : IMemberRepository
    {
        public Task AddAsync(Member member) => Task.CompletedTask;
    }
}
