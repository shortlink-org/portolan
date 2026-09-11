<?php

declare(strict_types=1);

namespace Acme\Apps\Mooc\Backend\Controller\HealthCheck;

use Symfony\Component\HttpFoundation\JsonResponse;

/** Answers that the application is up. */
final class HealthCheckGetController
{
	public function __invoke(): JsonResponse
	{
		return new JsonResponse(['mooc-backend' => 'ok']);
	}
}
