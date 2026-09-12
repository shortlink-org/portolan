using CompanyName.MyMeetings.Modules.Meetings.Application.Configuration.Queries;

namespace CompanyName.MyMeetings.Modules.Meetings.Application.Countries
{
    public class GetAllCountriesQuery : QueryBase<List<CountryDto>>
    {
    }

    public class CountryDto
    {
        public string Code { get; set; }

        public string Name { get; set; }
    }
}
