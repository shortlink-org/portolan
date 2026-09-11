<?php

declare(strict_types=1);

namespace Acme\Analytics\DomainEvents\Application\Store;

use Acme\Shared\Domain\Bus\Event\DomainEvent;
use Acme\Shared\Domain\Bus\Event\DomainEventSubscriber;

/** Keeps a copy of every event that ever happened. */
final readonly class StoreDomainEventOnOccurred implements DomainEventSubscriber
{
	public function __construct(private DomainEventStorer $storer) {}

	public static function subscribedTo(): array
	{
		return [DomainEvent::class];
	}

	public function __invoke(DomainEvent $event): void
	{
		$this->storer->__invoke($event);
	}
}
