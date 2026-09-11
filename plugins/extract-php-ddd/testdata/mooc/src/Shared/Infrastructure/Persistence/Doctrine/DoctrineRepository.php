<?php

declare(strict_types=1);

namespace Acme\Shared\Infrastructure\Persistence\Doctrine;

abstract class DoctrineRepository
{
	protected function persist(object $entity): void {}
}
