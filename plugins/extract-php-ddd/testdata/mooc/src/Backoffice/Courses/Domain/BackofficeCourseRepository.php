<?php

declare(strict_types=1);

namespace Acme\Backoffice\Courses\Domain;

interface BackofficeCourseRepository
{
	public function save(BackofficeCourse $course): void;

	public function searchAll(): array;
}
