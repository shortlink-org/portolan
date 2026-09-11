<?php

declare(strict_types=1);

namespace Acme\Mooc\CoursesCounter\Domain;

use Acme\Shared\Domain\Bus\Event\DomainEvent;

final class CoursesCounterIncrementedDomainEvent extends DomainEvent
{
	public function __construct(string $id, private readonly int $total, string $eventId = null, string $occurredOn = null)
	{
		parent::__construct($id, $eventId, $occurredOn);
	}

	public static function eventName(): string
	{
		return 'courses_counter.incremented';
	}

	public function toPrimitives(): array
	{
		return ['total' => $this->total];
	}
}
