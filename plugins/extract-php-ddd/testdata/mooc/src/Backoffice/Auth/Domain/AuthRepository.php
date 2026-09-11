<?php

declare(strict_types=1);

namespace Acme\Backoffice\Auth\Domain;

interface AuthRepository
{
	public function search(AuthUser $username): ?string;
}
