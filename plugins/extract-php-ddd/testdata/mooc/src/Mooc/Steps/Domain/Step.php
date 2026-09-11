<?php

declare(strict_types=1);

namespace Acme\Mooc\Steps\Domain;

use Acme\Shared\Domain\Aggregate\AggregateRoot;

/** One thing a student does in a course: watch, answer, solve. */
abstract class Step extends AggregateRoot
{
	public function __construct(private readonly StepId $id, private readonly StepTitle $title) {}

	public function id(): StepId
	{
		return $this->id;
	}

	public function title(): StepTitle
	{
		return $this->title;
	}
}
