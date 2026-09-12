using CompanyName.MyMeetings.Modules.Meetings.Application.Configuration.Queries;
using Dapper;

namespace CompanyName.MyMeetings.Modules.Meetings.Application.Countries
{
    internal class GetAllCountriesQueryHandler : IQueryHandler<GetAllCountriesQuery, List<CountryDto>>
    {
        private readonly ISqlConnectionFactory _sqlConnectionFactory;

        public GetAllCountriesQueryHandler(ISqlConnectionFactory sqlConnectionFactory)
        {
            _sqlConnectionFactory = sqlConnectionFactory;
        }

        public async Task<List<CountryDto>> Handle(GetAllCountriesQuery query, CancellationToken cancellationToken)
        {
            var connection = _sqlConnectionFactory.GetOpenConnection();

            var countries = await connection.QueryAsync<CountryDto>(
                "SELECT [Country].[Code], [Country].[Name] " +
                "FROM [meetings].[v_Countries] AS [Country]");

            return countries.AsList();
        }
    }
}
