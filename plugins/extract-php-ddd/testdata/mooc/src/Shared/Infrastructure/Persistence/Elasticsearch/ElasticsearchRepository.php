<?php

declare(strict_types=1);

namespace Acme\Shared\Infrastructure\Persistence\Elasticsearch;

abstract class ElasticsearchRepository
{
	abstract protected function aggregateName(): string;

	protected function persist(string $id, array $plainBody): void {}

	protected function searchAllInElastic(): array
	{
		return [];
	}
}
