<?php

declare(strict_types=1);

namespace Acme\Backoffice\Courses\Infrastructure\Persistence;

use Acme\Backoffice\Courses\Domain\BackofficeCourse;
use Acme\Backoffice\Courses\Domain\BackofficeCourseRepository;
use Acme\Shared\Infrastructure\Persistence\Elasticsearch\ElasticsearchRepository;

final class ElasticsearchBackofficeCourseRepository extends ElasticsearchRepository implements BackofficeCourseRepository
{
	public function save(BackofficeCourse $course): void
	{
		$this->persist($course->id(), $course->toPrimitives());
	}

	public function searchAll(): array
	{
		return $this->searchAllInElastic();
	}

	protected function aggregateName(): string
	{
		return 'courses';
	}
}
