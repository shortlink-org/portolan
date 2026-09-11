<?php

declare(strict_types=1);

namespace Acme\Backoffice\Courses\Application\Create;

use Acme\Mooc\Courses\Domain\CourseCreatedDomainEvent;
use Acme\Shared\Domain\Bus\Event\DomainEventSubscriber;

final readonly class CreateBackofficeCourseOnCourseCreated implements DomainEventSubscriber
{
	public function __construct(private BackofficeCourseCreator $creator) {}

	public static function subscribedTo(): array
	{
		return [CourseCreatedDomainEvent::class];
	}

	public function __invoke(CourseCreatedDomainEvent $event): void
	{
		$this->creator->__invoke($event->aggregateId(), $event->name(), $event->duration());
	}
}
