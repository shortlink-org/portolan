<?php

declare(strict_types=1);

namespace Acme\Shared\Infrastructure\Symfony;

use Acme\Shared\Domain\Bus\Command\Command;
use Acme\Shared\Domain\Bus\Query\Query;

abstract class ApiController
{
	protected function dispatch(Command $command): void {}

	protected function ask(Query $query): mixed
	{
		return null;
	}
}
