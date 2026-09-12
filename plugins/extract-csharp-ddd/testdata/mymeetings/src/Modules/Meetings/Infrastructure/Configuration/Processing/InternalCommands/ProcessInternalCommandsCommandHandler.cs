using CompanyName.MyMeetings.Modules.Meetings.Application.Configuration.Commands;

namespace CompanyName.MyMeetings.Modules.Meetings.Infrastructure.Configuration.Processing.InternalCommands
{
    internal class ProcessInternalCommandsCommand : CommandBase
    {
    }

    // A handler in the infrastructure is plumbing, not an operation: not read.
    internal class ProcessInternalCommandsCommandHandler : ICommandHandler<ProcessInternalCommandsCommand>
    {
        public Task Handle(ProcessInternalCommandsCommand command, CancellationToken cancellationToken) => Task.CompletedTask;
    }
}
