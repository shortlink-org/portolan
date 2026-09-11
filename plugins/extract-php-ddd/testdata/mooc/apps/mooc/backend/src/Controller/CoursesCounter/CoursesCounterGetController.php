<?php

declare(strict_types=1);

namespace Acme\Apps\Mooc\Backend\Controller\CoursesCounter;

use Acme\Mooc\CoursesCounter\Application\Find\FindCoursesCounterQuery;
use Acme\Shared\Infrastructure\Symfony\ApiController;
use Symfony\Component\HttpFoundation\JsonResponse;

final class CoursesCounterGetController extends ApiController
{
	public function __invoke(): JsonResponse
	{
		$response = $this->ask(new FindCoursesCounterQuery());

		return new JsonResponse(['total' => $response->total()]);
	}
}
