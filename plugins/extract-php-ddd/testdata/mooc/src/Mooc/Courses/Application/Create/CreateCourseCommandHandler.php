<?php

declare(strict_types=1);

namespace Acme\Mooc\Courses\Application\Create;

use Acme\Mooc\Courses\Domain\CourseDuration;
use Acme\Mooc\Courses\Domain\CourseName;
use Acme\Mooc\Shared\Domain\Courses\CourseId;
use Acme\Shared\Domain\Bus\Command\CommandHandler;

final readonly class CreateCourseCommandHandler implements CommandHandler
{
	public function __construct(private CourseCreator $creator) {}

	public function __invoke(CreateCourseCommand $command): void
	{
		$id = new CourseId($command->id());
		$name = new CourseName($command->name());
		$duration = new CourseDuration($command->duration());

		$this->creator->__invoke($id, $name, $duration);
	}
}
