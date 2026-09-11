<?php

declare(strict_types=1);

namespace Acme\Mooc\Courses\Domain;

use Acme\Shared\Domain\ValueObject\StringValueObject;

/** How long the course takes, as the author wrote it: `5 hours`. */
final class CourseDuration extends StringValueObject {}
