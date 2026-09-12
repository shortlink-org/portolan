using CompanyName.MyMeetings.BuildingBlocks.Infrastructure.EventBus;
using CompanyName.MyMeetings.Modules.Registrations.IntegrationEvents;

namespace CompanyName.MyMeetings.Modules.Meetings.Infrastructure.Configuration.EventsBus
{
    public static class EventsBusStartup
    {
        public static void Initialize(IEventsBus eventBus)
        {
            SubscribeToIntegrationEvent<NewUserRegisteredIntegrationEvent>(eventBus);
        }

        private static void SubscribeToIntegrationEvent<T>(IEventsBus eventBus)
            where T : IntegrationEvent
        {
            eventBus.Subscribe(new IntegrationEventGenericHandler<T>());
        }
    }

    internal class IntegrationEventGenericHandler<T> : IIntegrationEventHandler<T>
        where T : IntegrationEvent
    {
        public Task Handle(T @event) => Task.CompletedTask;
    }
}
