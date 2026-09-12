namespace CompanyName.MyMeetings.Modules.Meetings.Domain.Members
{
    public interface IMemberRepository
    {
        Task AddAsync(Member member);
    }
}
