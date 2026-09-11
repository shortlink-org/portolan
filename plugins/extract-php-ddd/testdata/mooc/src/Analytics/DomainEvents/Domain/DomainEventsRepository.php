<?php

declare(strict_types=1);

namespace Acme\Analytics\DomainEvents\Domain;

interface DomainEventsRepository
{
	public function save(AnalyticsDomainEvent $event): void;
}
