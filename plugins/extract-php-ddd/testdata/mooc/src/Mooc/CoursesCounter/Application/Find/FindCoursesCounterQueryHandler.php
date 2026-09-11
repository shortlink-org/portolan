<?php

declare(strict_types=1);

namespace Acme\Mooc\CoursesCounter\Application\Find;

use Acme\Mooc\CoursesCounter\Domain\CoursesCounterRepository;
use Acme\Shared\Domain\Bus\Query\QueryHandler;

/** The current total, or nothing when no course was ever created. */
final readonly class FindCoursesCounterQueryHandler implements QueryHandler
{
	public function __construct(private CoursesCounterRepository $repository) {}

	public function __invoke(FindCoursesCounterQuery $query): CoursesCounterResponse
	{
		$counter = $this->repository->search();

		return new CoursesCounterResponse($counter?->total()->value() ?? 0);
	}
}
