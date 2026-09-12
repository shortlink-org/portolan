using CompanyName.MyMeetings.BuildingBlocks.Domain;
using CompanyName.MyMeetings.Modules.Payments.Domain.SeedWork;
using CompanyName.MyMeetings.Modules.Payments.Domain.Subscriptions.Events;

namespace CompanyName.MyMeetings.Modules.Payments.Domain.Subscriptions
{
    public class Subscription : AggregateRoot
    {
        private Guid _payerId;

        private DateTime _expirationDate;

        private Subscription()
        {
        }

        public static Subscription Create(Guid payerId, DateTime expirationDate)
        {
            var subscription = new Subscription();
            var created = new SubscriptionCreatedDomainEvent(Guid.NewGuid(), payerId, expirationDate);
            subscription.Apply(created);
            subscription.AddDomainEvent(created);
            return subscription;
        }

        public void Expire()
        {
            var expired = new SubscriptionExpiredDomainEvent(this.Id);
            this.Apply(expired);
            this.AddDomainEvent(expired);
        }

        protected override void Apply(IDomainEvent @event)
        {
        }
    }
}
