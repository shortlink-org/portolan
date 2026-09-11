<?php

declare(strict_types=1);

namespace Acme\Backoffice\Courses\Application\Create;

use Acme\Backoffice\Courses\Domain\BackofficeCourse;
use Acme\Backoffice\Courses\Domain\BackofficeCourseRepository;

/** Copies a course into the back office's own list. */
final readonly class BackofficeCourseCreator
{
	public function __construct(private BackofficeCourseRepository $repository) {}

	public function __invoke(string $id, string $name, string $duration): void
	{
		$this->repository->save(new BackofficeCourse($id, $name, $duration));
	}
}
