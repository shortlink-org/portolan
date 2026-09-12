using CompanyName.MyMeetings.Modules.Registrations.Application.Configuration.Commands;

namespace CompanyName.MyMeetings.Modules.Registrations.Application.UserRegistrations.RegisterNewUser
{
    public class RegisterNewUserCommand : CommandBase<Guid>
    {
        public RegisterNewUserCommand(string login, string email)
        {
            Login = login;
            Email = email;
        }

        public string Login { get; }

        public string Email { get; }
    }
}
