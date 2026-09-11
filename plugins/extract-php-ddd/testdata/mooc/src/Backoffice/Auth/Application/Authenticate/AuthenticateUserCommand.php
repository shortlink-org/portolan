<?php

declare(strict_types=1);

namespace Acme\Backoffice\Auth\Application\Authenticate;

use Acme\Shared\Domain\Bus\Command\Command;

final readonly class AuthenticateUserCommand implements Command
{
	public function __construct(private string $username, private string $password) {}

	public function username(): string
	{
		return $this->username;
	}

	public function password(): string
	{
		return $this->password;
	}
}
