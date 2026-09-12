using CompanyName.MyMeetings.Modules.Payments.Application.Configuration.Commands;

namespace CompanyName.MyMeetings.Modules.Payments.Application.Subscriptions.CreateSubscription
{
    public class CreateSubscriptionCommand : InternalCommandBase
    {
        public CreateSubscriptionCommand(Guid id, Guid payerId)
            : base(id)
        {
            PayerId = payerId;
        }

        public Guid PayerId { get; }
    }
}
