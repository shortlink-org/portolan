using CompanyName.MyMeetings.Modules.Meetings.Application.Contracts;
using CompanyName.MyMeetings.Modules.Meetings.Application.Countries;
using Microsoft.AspNetCore.Mvc;

namespace CompanyName.MyMeetings.API.Modules.Meetings.Countries
{
    [Route("api/meetings/countries")]
    [ApiController]
    public class CountriesController : ControllerBase
    {
        private readonly IMeetingsModule _meetingsModule;

        public CountriesController(IMeetingsModule meetingsModule)
        {
            _meetingsModule = meetingsModule;
        }

        [HttpGet("")]
        [ProducesResponseType(typeof(List<CountryDto>), StatusCodes.Status200OK)]
        public async Task<IActionResult> GetAllCountries()
        {
            var countries = await _meetingsModule.ExecuteQueryAsync(new GetAllCountriesQuery());

            return Ok(countries);
        }
    }
}
