using CompanyName.MyMeetings.Modules.Payments.Application.Configuration.Commands;
using CompanyName.MyMeetings.Modules.Payments.Domain.Subscriptions.Events;
using Dapper;
using MediatR;

namespace CompanyName.MyMeetings.Modules.Payments.Application.Subscriptions.GetSubscriptionDetails
{
    internal class SubscriptionDetailsProjector : INotificationHandler<SubscriptionCreatedDomainEvent>
    {
        private readonly ISqlConnectionFactory _sqlConnectionFactory;

        public SubscriptionDetailsProjector(ISqlConnectionFactory sqlConnectionFactory)
        {
            _sqlConnectionFactory = sqlConnectionFactory;
        }

        public async Task Handle(SubscriptionCreatedDomainEvent @event, CancellationToken cancellationToken)
        {
            var connection = _sqlConnectionFactory.GetOpenConnection();

            await connection.ExecuteAsync(
                "INSERT INTO [payments].[SubscriptionDetails] ([Id], [PayerId], [ExpirationDate]) " +
                "VALUES (@SubscriptionId, @PayerId, @ExpirationDate)",
                new { @event.SubscriptionId, @event.PayerId, @event.ExpirationDate });
        }
    }
}
