using CompanyName.MyMeetings.BuildingBlocks.Infrastructure.EventBus;

namespace CompanyName.MyMeetings.Modules.Registrations.IntegrationEvents
{
    /// <summary>Somebody registered; the other modules make their own records of them.</summary>
    public class NewUserRegisteredIntegrationEvent : IntegrationEvent
    {
        public Guid UserId { get; }

        public string Login { get; }

        public string Email { get; }

        public NewUserRegisteredIntegrationEvent(Guid id, DateTime occurredOn, Guid userId, string login, string email)
            : base(id, occurredOn)
        {
            UserId = userId;
            Login = login;
            Email = email;
        }
    }
}
