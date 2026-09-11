<?php

declare(strict_types=1);

namespace Acme\Mooc\Steps\Domain\Video;

use Acme\Mooc\Steps\Domain\Step;
use Acme\Mooc\Steps\Domain\StepId;
use Acme\Mooc\Steps\Domain\StepTitle;

/** A step that is a video to watch. */
final class VideoStep extends Step
{
	public function __construct(StepId $id, StepTitle $title, private readonly VideoStepUrl $url)
	{
		parent::__construct($id, $title);
	}

	public static function create(StepId $id, StepTitle $title, VideoStepUrl $url): self
	{
		return new self($id, $title, $url);
	}
}
