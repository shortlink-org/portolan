<?php

declare(strict_types=1);

namespace Acme\Backoffice\Courses\Application\SearchAll;

use Acme\Backoffice\Courses\Domain\BackofficeCourseRepository;
use Acme\Shared\Domain\Bus\Query\QueryHandler;

/** Every course the back office knows, in no particular order. */
final readonly class SearchAllBackofficeCoursesQueryHandler implements QueryHandler
{
	public function __construct(private BackofficeCourseRepository $repository) {}

	public function __invoke(SearchAllBackofficeCoursesQuery $query): array
	{
		return $this->repository->searchAll();
	}
}
