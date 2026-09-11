<?php

declare(strict_types=1);

namespace Acme\Mooc\CoursesCounter\Infrastructure\Persistence;

use Acme\Mooc\CoursesCounter\Domain\CoursesCounter;
use Acme\Mooc\CoursesCounter\Domain\CoursesCounterRepository;
use Acme\Shared\Infrastructure\Persistence\Doctrine\DoctrineRepository;

final class DoctrineCoursesCounterRepository extends DoctrineRepository implements CoursesCounterRepository
{
	public function search(): ?CoursesCounter
	{
		return null;
	}

	public function save(CoursesCounter $counter): void
	{
		$this->persist($counter);
	}
}
