<?php

declare(strict_types=1);

namespace Acme\Mooc\Steps\Infrastructure\Persistence;

use Acme\Mooc\Steps\Domain\Step;
use Acme\Mooc\Steps\Domain\StepRepository;
use Acme\Shared\Infrastructure\Persistence\Doctrine\DoctrineRepository;

final class MySqlStepRepository extends DoctrineRepository implements StepRepository
{
	public function save(Step $step): void
	{
		$this->persist($step);
	}
}
