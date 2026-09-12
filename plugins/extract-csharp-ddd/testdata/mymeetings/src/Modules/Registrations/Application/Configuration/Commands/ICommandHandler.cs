using CompanyName.MyMeetings.Modules.Registrations.Application.Contracts;
using MediatR;

namespace CompanyName.MyMeetings.Modules.Registrations.Application.Configuration.Commands
{
    public interface ICommandHandler<in TCommand> : IRequestHandler<TCommand>
        where TCommand : ICommand
    {
    }

    public interface ICommandHandler<in TCommand, TResult> : IRequestHandler<TCommand, TResult>
        where TCommand : ICommand<TResult>
    {
    }

    public abstract class CommandBase<TResult> : ICommand<TResult>
    {
        public Guid Id { get; } = Guid.NewGuid();
    }

    public abstract class CommandBase : ICommand
    {
        public Guid Id { get; } = Guid.NewGuid();
    }

    public abstract class InternalCommandBase : ICommand
    {
        public Guid Id { get; }

        protected InternalCommandBase(Guid id)
        {
            Id = id;
        }
    }

    public interface ICommandsScheduler
    {
        Task EnqueueAsync(ICommand command);
    }
}
