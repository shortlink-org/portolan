<?php

declare(strict_types=1);

namespace Acme\Mooc\CoursesCounter\Application\Find;

final readonly class CoursesCounterResponse
{
	public function __construct(private int $total) {}

	public function total(): int
	{
		return $this->total;
	}
}
