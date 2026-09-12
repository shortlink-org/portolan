using CompanyName.MyMeetings.Modules.Payments.Domain.SeedWork;

namespace CompanyName.MyMeetings.Modules.Payments.Infrastructure.AggregateStore
{
    public class SqlStreamAggregateStore : IAggregateStore
    {
        public Task Save() => Task.CompletedTask;

        public Task<T> Load<T>(AggregateId<T> aggregateId)
            where T : AggregateRoot => Task.FromResult<T>(null);

        public void AppendChanges<T>(T aggregate)
            where T : AggregateRoot
        {
        }
    }
}
