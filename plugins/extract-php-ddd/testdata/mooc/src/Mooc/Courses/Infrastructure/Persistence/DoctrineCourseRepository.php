<?php

declare(strict_types=1);

namespace Acme\Mooc\Courses\Infrastructure\Persistence;

use Acme\Mooc\Courses\Domain\Course;
use Acme\Mooc\Courses\Domain\CourseRepository;
use Acme\Mooc\Shared\Domain\Courses\CourseId;
use Acme\Shared\Infrastructure\Persistence\Doctrine\DoctrineRepository;

final class DoctrineCourseRepository extends DoctrineRepository implements CourseRepository
{
	public function save(Course $course): void
	{
		$this->persist($course);
	}

	public function search(CourseId $id): ?Course
	{
		return null;
	}
}
