<?php

declare(strict_types=1);

namespace Acme\Apps\Backoffice\Frontend\Controller\Courses;

use Acme\Mooc\Courses\Application\Create\CreateCourseCommand;
use Acme\Shared\Infrastructure\Symfony\WebController;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Request;

/** The new-course form, submitted. */
final class CoursesPostWebController extends WebController
{
	public function __invoke(Request $request): RedirectResponse
	{
		return $this->createCourse($request);
	}

	private function createCourse(Request $request): RedirectResponse
	{
		$this->dispatch(
			new CreateCourseCommand(
				(string) $request->request->get('id'),
				(string) $request->request->get('name'),
				(string) $request->request->get('duration')
			)
		);

		return new RedirectResponse('/courses');
	}
}
