using CompanyName.MyMeetings.BuildingBlocks.Domain;

namespace CompanyName.MyMeetings.Modules.Registrations.Domain.UserRegistrations.Events
{
    public class NewUserRegisteredDomainEvent : DomainEventBase
    {
        public NewUserRegisteredDomainEvent(UserRegistrationId userRegistrationId, string login, string email)
        {
            UserRegistrationId = userRegistrationId;
            Login = login;
            Email = email;
        }

        public UserRegistrationId UserRegistrationId { get; }

        public string Login { get; }

        public string Email { get; }
    }
}
