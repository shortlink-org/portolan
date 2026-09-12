using CompanyName.MyMeetings.Modules.Registrations.Application.Contracts;
using CompanyName.MyMeetings.Modules.Registrations.Application.UserRegistrations.ConfirmUserRegistration;
using CompanyName.MyMeetings.Modules.Registrations.Application.UserRegistrations.RegisterNewUser;
using Microsoft.AspNetCore.Mvc;

namespace CompanyName.MyMeetings.API.Modules.UserAccess
{
    // Filed under a module the tree does not have: reported, not read.
    [Route("userAccess/[controller]")]
    [ApiController]
    public class UserRegistrationsController : ControllerBase
    {
        private readonly IRegistrationsModule _registrationsModule;

        public UserRegistrationsController(IRegistrationsModule registrationsModule)
        {
            _registrationsModule = registrationsModule;
        }

        [HttpPost("")]
        public async Task<IActionResult> RegisterNewUser(RegisterNewUserRequest request)
        {
            await _registrationsModule.ExecuteCommandAsync(new RegisterNewUserCommand(request.Login, request.Email));

            return Ok();
        }
    }

    public class RegisterNewUserRequest
    {
        public string Login { get; set; }

        public string Email { get; set; }
    }
}
