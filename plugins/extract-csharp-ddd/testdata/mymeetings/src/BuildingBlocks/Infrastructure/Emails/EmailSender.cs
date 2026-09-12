using Dapper;

namespace CompanyName.MyMeetings.BuildingBlocks.Infrastructure.Emails
{
    public class EmailSender
    {
        public async Task SendEmail(System.Data.IDbConnection connection)
        {
            await connection.ExecuteAsync("INSERT INTO [app].[Emails] ([Id], [To]) VALUES (@Id, @To)");
        }
    }
}
