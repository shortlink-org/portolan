using CompanyName.MyMeetings.BuildingBlocks.Domain;

namespace CompanyName.MyMeetings.Modules.Payments.Domain.Subscriptions.Events
{
    public class SubscriptionCreatedDomainEvent : DomainEventBase
    {
        public SubscriptionCreatedDomainEvent(Guid subscriptionId, Guid payerId, DateTime expirationDate)
        {
            SubscriptionId = subscriptionId;
            PayerId = payerId;
            ExpirationDate = expirationDate;
        }

        public Guid SubscriptionId { get; }

        public Guid PayerId { get; }

        public DateTime ExpirationDate { get; }
    }

    public class SubscriptionExpiredDomainEvent : DomainEventBase
    {
        public SubscriptionExpiredDomainEvent(Guid subscriptionId)
        {
            SubscriptionId = subscriptionId;
        }

        public Guid SubscriptionId { get; }
    }
}
