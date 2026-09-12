using CompanyName.MyMeetings.Modules.Payments.Application.Configuration.Commands;
using CompanyName.MyMeetings.Modules.Payments.Domain.SeedWork;
using CompanyName.MyMeetings.Modules.Payments.Domain.Subscriptions;

namespace CompanyName.MyMeetings.Modules.Payments.Application.Subscriptions.CreateSubscription
{
    internal class CreateSubscriptionCommandHandler : ICommandHandler<CreateSubscriptionCommand>
    {
        private readonly IAggregateStore _aggregateStore;

        internal CreateSubscriptionCommandHandler(IAggregateStore aggregateStore)
        {
            _aggregateStore = aggregateStore;
        }

        public async Task Handle(CreateSubscriptionCommand command, CancellationToken cancellationToken)
        {
            var subscription = Subscription.Create(command.PayerId, DateTime.UtcNow.AddMonths(1));

            _aggregateStore.AppendChanges(subscription);

            await _aggregateStore.Save();
        }
    }
}
