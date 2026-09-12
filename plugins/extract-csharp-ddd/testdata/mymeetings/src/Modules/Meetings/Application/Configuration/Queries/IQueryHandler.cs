using CompanyName.MyMeetings.Modules.Meetings.Application.Contracts;
using MediatR;

namespace CompanyName.MyMeetings.Modules.Meetings.Application.Configuration.Queries
{
    public interface IQueryHandler<in TQuery, TResult> : IRequestHandler<TQuery, TResult>
        where TQuery : IQuery<TResult>
    {
    }

    public abstract class QueryBase<TResult> : IQuery<TResult>
    {
    }

    public interface ISqlConnectionFactory
    {
        System.Data.IDbConnection GetOpenConnection();
    }
}
