<?php

declare(strict_types=1);

namespace Acme\Mooc\Courses\Domain;

use Acme\Mooc\Shared\Domain\Courses\CourseId;

interface CourseRepository
{
	public function save(Course $course): void;

	public function search(CourseId $id): ?Course;
}
