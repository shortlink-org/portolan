using CompanyName.MyMeetings.BuildingBlocks.Domain;
using MediatR;

namespace CompanyName.MyMeetings.BuildingBlocks.Application.Events
{
    public interface IDomainEventNotification<out TEventType> : INotification
    {
        TEventType DomainEvent { get; }
    }
}
