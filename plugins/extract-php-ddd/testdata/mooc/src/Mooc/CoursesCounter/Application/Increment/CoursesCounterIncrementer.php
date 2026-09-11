<?php

declare(strict_types=1);

namespace Acme\Mooc\CoursesCounter\Application\Increment;

use Acme\Mooc\CoursesCounter\Domain\CoursesCounter;
use Acme\Mooc\CoursesCounter\Domain\CoursesCounterId;
use Acme\Mooc\CoursesCounter\Domain\CoursesCounterRepository;
use Acme\Mooc\Shared\Domain\Courses\CourseId;
use Acme\Shared\Domain\Bus\Event\EventBus;

/** Counts a course once, however many times its creation is heard. */
final readonly class CoursesCounterIncrementer
{
	public function __construct(private CoursesCounterRepository $repository, private EventBus $bus) {}

	public function __invoke(CourseId $courseId): void
	{
		$counter = $this->repository->search() ?: $this->initializeCounter();

		if (!$counter->hasIncremented($courseId)) {
			$counter->increment($courseId);

			$this->repository->save($counter);
			$this->bus->publish(...$counter->pullDomainEvents());
		}
	}

	private function initializeCounter(): CoursesCounter
	{
		return CoursesCounter::initialize(new CoursesCounterId('00000000-0000-0000-0000-000000000000'));
	}
}
