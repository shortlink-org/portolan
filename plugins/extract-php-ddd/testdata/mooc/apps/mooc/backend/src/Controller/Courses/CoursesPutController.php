<?php

declare(strict_types=1);

namespace Acme\Apps\Mooc\Backend\Controller\Courses;

use Acme\Mooc\Courses\Application\Create\CreateCourseCommand;
use Acme\Shared\Infrastructure\Symfony\ApiController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/** Creates the course with the given id. */
final class CoursesPutController extends ApiController
{
	public function __invoke(string $id, Request $request): Response
	{
		$this->dispatch(
			new CreateCourseCommand(
				$id,
				$request->request->get('name'),
				$request->request->get('duration')
			)
		);

		return new Response('', Response::HTTP_CREATED);
	}
}
