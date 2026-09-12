using CompanyName.MyMeetings.Modules.Registrations.Application.Contracts;
using CompanyName.MyMeetings.Modules.Registrations.Application.UserRegistrations.ConfirmUserRegistration;
using CompanyName.MyMeetings.Modules.Registrations.Application.UserRegistrations.RegisterNewUser;
using Microsoft.AspNetCore.Mvc;

namespace CompanyName.MyMeetings.API.Modules.Registrations
{
    [Route("registrations/[controller]")]
    [ApiController]
    public class UserRegistrationsController : ControllerBase
    {
        private readonly IRegistrationsModule _registrationsModule;

        public UserRegistrationsController(IRegistrationsModule registrationsModule)
        {
            _registrationsModule = registrationsModule;
        }

        [HttpPost("")]
        public async Task<IActionResult> RegisterNewUser([FromBody] RegisterNewUserRequest request)
        {
            await _registrationsModule.ExecuteCommandAsync(new RegisterNewUserCommand(request.Login, request.Email));

            return Ok();
        }

        [HttpPatch("{userRegistrationId}/confirm")]
        public async Task<IActionResult> ConfirmRegistration(Guid userRegistrationId)
        {
            await _registrationsModule.ExecuteCommandAsync(new ConfirmUserRegistrationCommand(userRegistrationId));

            return Ok();
        }
    }

    public class RegisterNewUserRequest
    {
        public string Login { get; set; }

        public string Email { get; set; }
    }
}
