<?php

declare(strict_types=1);

namespace Acme\Backoffice\Courses\Infrastructure\Persistence;

use Acme\Backoffice\Courses\Domain\BackofficeCourse;
use Acme\Backoffice\Courses\Domain\BackofficeCourseRepository;
use Acme\Shared\Infrastructure\Persistence\Doctrine\DoctrineRepository;

final class MySqlBackofficeCourseRepository extends DoctrineRepository implements BackofficeCourseRepository
{
	public function save(BackofficeCourse $course): void
	{
		$this->persist($course);
	}

	public function searchAll(): array
	{
		return [];
	}
}
