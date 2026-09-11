<?php

declare(strict_types=1);

namespace Acme\Mooc\CoursesCounter\Application\Increment;

use Acme\Mooc\Courses\Domain\CourseCreatedDomainEvent;
use Acme\Mooc\Shared\Domain\Courses\CourseId;
use Acme\Shared\Domain\Bus\Event\DomainEventSubscriber;

use function Lambdish\Phunctional\apply;

final readonly class IncrementCoursesCounterOnCourseCreated implements DomainEventSubscriber
{
	public function __construct(private CoursesCounterIncrementer $incrementer) {}

	public static function subscribedTo(): array
	{
		return [CourseCreatedDomainEvent::class];
	}

	public function __invoke(CourseCreatedDomainEvent $event): void
	{
		$courseId = new CourseId($event->aggregateId());

		apply($this->incrementer, [$courseId]);
	}
}
