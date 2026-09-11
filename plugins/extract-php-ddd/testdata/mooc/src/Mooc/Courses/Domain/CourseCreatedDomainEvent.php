<?php

declare(strict_types=1);

namespace Acme\Mooc\Courses\Domain;

use Acme\Shared\Domain\Bus\Event\DomainEvent;

/** A course exists and can be counted, listed and enrolled in. */
final class CourseCreatedDomainEvent extends DomainEvent
{
	public function __construct(
		string $id,
		private readonly string $name,
		private readonly string $duration,
		string $eventId = null,
		string $occurredOn = null
	) {
		parent::__construct($id, $eventId, $occurredOn);
	}

	public static function eventName(): string
	{
		return 'course.created';
	}

	public function toPrimitives(): array
	{
		return [
			'name' => $this->name,
			'duration' => $this->duration,
		];
	}
}
