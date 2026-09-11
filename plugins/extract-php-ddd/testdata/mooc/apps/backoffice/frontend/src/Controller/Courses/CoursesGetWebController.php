<?php

declare(strict_types=1);

namespace Acme\Apps\Backoffice\Frontend\Controller\Courses;

use Acme\Backoffice\Courses\Application\SearchAll\SearchAllBackofficeCoursesQuery;
use Acme\Shared\Infrastructure\Symfony\WebController;
use Symfony\Component\HttpFoundation\Response;

/** The courses page. */
final class CoursesGetWebController extends WebController
{
	public function __invoke(): Response
	{
		$courses = $this->ask(new SearchAllBackofficeCoursesQuery());

		return new Response($this->render('pages/courses/courses.html.twig', ['courses' => $courses]));
	}
}
