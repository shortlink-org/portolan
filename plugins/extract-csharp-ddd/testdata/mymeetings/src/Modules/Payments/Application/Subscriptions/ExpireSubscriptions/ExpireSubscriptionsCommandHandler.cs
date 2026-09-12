using CompanyName.MyMeetings.Modules.Payments.Application.Configuration.Commands;
using CompanyName.MyMeetings.Modules.Payments.Domain.SeedWork;
using CompanyName.MyMeetings.Modules.Payments.Domain.Subscriptions;
using Dapper;

namespace CompanyName.MyMeetings.Modules.Payments.Application.Subscriptions.ExpireSubscriptions
{
    internal class ExpireSubscriptionsCommandHandler : ICommandHandler<ExpireSubscriptionsCommand>
    {
        private readonly ISqlConnectionFactory _sqlConnectionFactory;
        private readonly IAggregateStore _aggregateStore;

        internal ExpireSubscriptionsCommandHandler(ISqlConnectionFactory sqlConnectionFactory, IAggregateStore aggregateStore)
        {
            _sqlConnectionFactory = sqlConnectionFactory;
            _aggregateStore = aggregateStore;
        }

        public async Task Handle(ExpireSubscriptionsCommand command, CancellationToken cancellationToken)
        {
            var connection = _sqlConnectionFactory.GetOpenConnection();

            var ids = await connection.QueryAsync<Guid>(
                "SELECT [Subscription].[Id] FROM [payments].[SubscriptionDetails] AS [Subscription] WHERE [Subscription].[ExpirationDate] < @Now",
                new { Now = DateTime.UtcNow });

            foreach (var id in ids)
            {
                var subscription = await _aggregateStore.Load(new SubscriptionId(id));
                subscription.Expire();
                _aggregateStore.AppendChanges(subscription);
            }

            await _aggregateStore.Save();
        }
    }
}
