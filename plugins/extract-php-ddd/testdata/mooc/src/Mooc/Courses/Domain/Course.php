<?php

declare(strict_types=1);

namespace Acme\Mooc\Courses\Domain;

use Acme\Mooc\Shared\Domain\Courses\CourseId;
use Acme\Shared\Domain\Aggregate\AggregateRoot;

/**
 * A course a student can enrol in: a name and how long it takes.
 */
final class Course extends AggregateRoot
{
	public function __construct(private readonly CourseId $id, private CourseName $name, private readonly CourseDuration $duration) {}

	public static function create(CourseId $id, CourseName $name, CourseDuration $duration): self
	{
		$course = new self($id, $name, $duration);

		$course->record(new CourseCreatedDomainEvent($id->value(), $name->value(), $duration->value()));

		return $course;
	}

	public function id(): CourseId
	{
		return $this->id;
	}

	public function rename(CourseName $newName): void
	{
		$this->name = $newName;
	}
}
