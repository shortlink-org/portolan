using CompanyName.MyMeetings.BuildingBlocks.Domain;

namespace CompanyName.MyMeetings.Modules.Payments.Domain.SeedWork
{
    public abstract class AggregateRoot
    {
        private readonly List<IDomainEvent> _domainEvents = new List<IDomainEvent>();

        public Guid Id { get; protected set; }

        public int Version { get; private set; }

        protected void AddDomainEvent(IDomainEvent @event)
        {
            _domainEvents.Add(@event);
        }

        protected abstract void Apply(IDomainEvent @event);
    }

    public abstract class AggregateId<T>
        where T : AggregateRoot
    {
        protected AggregateId(Guid value)
        {
            Value = value;
        }

        public Guid Value { get; }
    }

    public interface IAggregateStore
    {
        Task Save();

        Task<T> Load<T>(AggregateId<T> aggregateId)
            where T : AggregateRoot;

        void AppendChanges<T>(T aggregate)
            where T : AggregateRoot;
    }
}
