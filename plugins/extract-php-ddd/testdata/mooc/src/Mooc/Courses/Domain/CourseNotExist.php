<?php

declare(strict_types=1);

namespace Acme\Mooc\Courses\Domain;

use Acme\Mooc\Shared\Domain\Courses\CourseId;

final class CourseNotExist extends \DomainException
{
	public function __construct(CourseId $id)
	{
		parent::__construct(sprintf('The course <%s> does not exist', $id->value()));
	}
}
