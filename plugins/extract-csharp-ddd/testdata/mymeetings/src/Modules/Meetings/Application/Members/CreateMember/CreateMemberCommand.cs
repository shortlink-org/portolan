using CompanyName.MyMeetings.Modules.Meetings.Application.Configuration.Commands;

namespace CompanyName.MyMeetings.Modules.Meetings.Application.Members.CreateMember
{
    internal class CreateMemberCommand : InternalCommandBase
    {
        internal CreateMemberCommand(Guid id, Guid memberId, string login, string email)
            : base(id)
        {
            MemberId = memberId;
            Login = login;
            Email = email;
        }

        internal Guid MemberId { get; }

        internal string Login { get; }

        internal string Email { get; }
    }
}
