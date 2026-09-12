using CompanyName.MyMeetings.BuildingBlocks.Domain;
using CompanyName.MyMeetings.Modules.Meetings.Domain.Members.Events;

namespace CompanyName.MyMeetings.Modules.Meetings.Domain.Members
{
    public class Member : Entity, IAggregateRoot
    {
        public MemberId Id { get; private set; }

        private string _login;

        private string _email;

        private Member()
        {
        }

        public static Member Create(Guid id, string login, string email)
        {
            var member = new Member { Id = new MemberId(id), _login = login, _email = email };
            member.AddDomainEvent(new MemberCreatedDomainEvent(member.Id));
            return member;
        }
    }
}
