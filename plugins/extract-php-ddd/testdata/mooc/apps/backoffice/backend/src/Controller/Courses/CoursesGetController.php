<?php

declare(strict_types=1);

namespace Acme\Apps\Backoffice\Backend\Controller\Courses;

use Acme\Backoffice\Courses\Application\SearchAll\SearchAllBackofficeCoursesQuery;
use Acme\Shared\Infrastructure\Symfony\ApiController;
use Symfony\Component\HttpFoundation\JsonResponse;

/** Lists every course for the back office UI. */
final class CoursesGetController extends ApiController
{
	public function __invoke(): JsonResponse
	{
		return new JsonResponse($this->ask(new SearchAllBackofficeCoursesQuery()));
	}
}
