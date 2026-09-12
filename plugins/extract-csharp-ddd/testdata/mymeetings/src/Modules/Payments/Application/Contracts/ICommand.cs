using MediatR;

namespace CompanyName.MyMeetings.Modules.Payments.Application.Contracts
{
    public interface ICommand : IRequest
    {
        Guid Id { get; }
    }

    public interface IRecurringCommand
    {
    }
}
