<?php

declare(strict_types=1);

namespace Acme\Mooc\CoursesCounter\Domain;

interface CoursesCounterRepository
{
	public function search(): ?CoursesCounter;

	public function save(CoursesCounter $counter): void;
}
