<?php

declare(strict_types=1);

namespace Acme\Shared\Domain\Bus\Event;

abstract class DomainEvent
{
	public function __construct(private readonly string $aggregateId, private readonly ?string $eventId = null, private readonly ?string $occurredOn = null) {}

	abstract public static function eventName(): string;

	abstract public function toPrimitives(): array;

	public function aggregateId(): string
	{
		return $this->aggregateId;
	}
}
