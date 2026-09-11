<?php

declare(strict_types=1);

namespace Acme\Mooc\Courses\Application\Create;

use Acme\Mooc\Courses\Domain\Course;
use Acme\Mooc\Courses\Domain\CourseDuration;
use Acme\Mooc\Courses\Domain\CourseName;
use Acme\Mooc\Courses\Domain\CourseRepository;
use Acme\Mooc\Shared\Domain\Courses\CourseId;
use Acme\Shared\Domain\Bus\Event\EventBus;

/** Creates a course and tells the world. */
final readonly class CourseCreator
{
	public function __construct(private CourseRepository $repository, private EventBus $bus) {}

	public function __invoke(CourseId $id, CourseName $name, CourseDuration $duration): void
	{
		$course = Course::create($id, $name, $duration);

		$this->repository->save($course);
		$this->bus->publish(...$course->pullDomainEvents());
	}
}
