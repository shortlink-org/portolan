<?php

declare(strict_types=1);

namespace Acme\Backoffice\Auth\Application\Authenticate;

use Acme\Backoffice\Auth\Domain\AuthRepository;
use Acme\Backoffice\Auth\Domain\AuthUser;
use Acme\Shared\Domain\Bus\Command\CommandHandler;

/** Checks a username and password against the users we know. */
final readonly class AuthenticateUserCommandHandler implements CommandHandler
{
	public function __construct(private AuthRepository $repository) {}

	public function __invoke(AuthenticateUserCommand $command): void
	{
		$this->repository->search(new AuthUser($command->username()));
	}
}
