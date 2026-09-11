<?php

declare(strict_types=1);

namespace Acme\Analytics\DomainEvents\Domain;

final readonly class AnalyticsDomainEvent
{
	public function __construct(private string $id, private string $aggregateId, private string $name, private array $body) {}
}
