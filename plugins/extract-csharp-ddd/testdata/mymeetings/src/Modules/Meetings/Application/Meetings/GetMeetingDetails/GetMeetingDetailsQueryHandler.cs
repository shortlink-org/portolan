using CompanyName.MyMeetings.Modules.Meetings.Application.Configuration.Queries;
using Dapper;

namespace CompanyName.MyMeetings.Modules.Meetings.Application.Meetings.GetMeetingDetails
{
    internal class GetMeetingDetailsQueryHandler : IQueryHandler<GetMeetingDetailsQuery, MeetingDetailsDto>
    {
        private readonly ISqlConnectionFactory _sqlConnectionFactory;

        public GetMeetingDetailsQueryHandler(ISqlConnectionFactory sqlConnectionFactory)
        {
            _sqlConnectionFactory = sqlConnectionFactory;
        }

        public async Task<MeetingDetailsDto> Handle(GetMeetingDetailsQuery query, CancellationToken cancellationToken)
        {
            var connection = _sqlConnectionFactory.GetOpenConnection();

            return await connection.QuerySingleAsync<MeetingDetailsDto>(
                $"""
                 SELECT
                     [MeetingDetails].[Id] AS [{nameof(MeetingDetailsDto.Id)}],
                     [MeetingDetails].[Title] AS [{nameof(MeetingDetailsDto.Title)}],
                     [MeetingDetails].[TermStartDate] AS [{nameof(MeetingDetailsDto.TermStartDate)}]
                 FROM [meetings].[v_MeetingDetails] AS [MeetingDetails]
                 WHERE [MeetingDetails].[Id] = @MeetingId
                 """,
                new { query.MeetingId });
        }
    }
}
