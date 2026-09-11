<?php

declare(strict_types=1);

namespace Acme\Analytics\DomainEvents\Application\Store;

use Acme\Analytics\DomainEvents\Domain\AnalyticsDomainEvent;
use Acme\Analytics\DomainEvents\Domain\DomainEventsRepository;
use Acme\Shared\Domain\Bus\Event\DomainEvent;

final readonly class DomainEventStorer
{
	public function __construct(private DomainEventsRepository $repository) {}

	public function __invoke(DomainEvent $event): void
	{
		$this->repository->save(new AnalyticsDomainEvent('', $event->aggregateId(), $event::eventName(), $event->toPrimitives()));
	}
}
