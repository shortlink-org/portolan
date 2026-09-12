using CompanyName.MyMeetings.Modules.Registrations.Domain.UserRegistrations;

namespace CompanyName.MyMeetings.Modules.Registrations.Infrastructure.Domain.UserRegistrations
{
    internal class UserRegistrationRepository : IUserRegistrationRepository
    {
        public Task AddAsync(UserRegistration userRegistration) => Task.CompletedTask;

        public Task<UserRegistration> GetByIdAsync(UserRegistrationId userRegistrationId) => Task.FromResult<UserRegistration>(null);
    }
}
