<?php

declare(strict_types=1);

namespace Acme\Backoffice\Auth\Infrastructure\Persistence;

use Acme\Backoffice\Auth\Domain\AuthRepository;
use Acme\Backoffice\Auth\Domain\AuthUser;

final class InMemoryAuthRepository implements AuthRepository
{
	public function search(AuthUser $username): ?string
	{
		return null;
	}
}
