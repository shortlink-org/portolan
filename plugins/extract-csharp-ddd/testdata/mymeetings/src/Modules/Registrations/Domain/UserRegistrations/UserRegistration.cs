using CompanyName.MyMeetings.BuildingBlocks.Domain;
using CompanyName.MyMeetings.Modules.Registrations.Domain.UserRegistrations.Events;

namespace CompanyName.MyMeetings.Modules.Registrations.Domain.UserRegistrations
{
    public class UserRegistration : Entity, IAggregateRoot
    {
        public UserRegistrationId Id { get; private set; }

        private string _login;

        private string _email;

        private UserRegistrationStatus _status;

        private UserRegistration()
        {
        }

        public static UserRegistration RegisterNewUser(string login, string email)
        {
            var registration = new UserRegistration
            {
                Id = new UserRegistrationId(Guid.NewGuid()),
                _login = login,
                _email = email,
                _status = UserRegistrationStatus.WaitingForConfirmation,
            };
            registration.AddDomainEvent(new NewUserRegisteredDomainEvent(registration.Id, login, email));
            return registration;
        }

        public void Confirm()
        {
            _status = UserRegistrationStatus.Confirmed;
            this.AddDomainEvent(new UserRegistrationConfirmedDomainEvent(this.Id));
        }
    }
}
