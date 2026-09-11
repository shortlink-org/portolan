<?php

declare(strict_types=1);

namespace Acme\Mooc\Steps\Application\Create;

use Acme\Mooc\Steps\Domain\StepId;
use Acme\Mooc\Steps\Domain\StepRepository;
use Acme\Mooc\Steps\Domain\StepTitle;
use Acme\Mooc\Steps\Domain\Video\VideoStep;
use Acme\Mooc\Steps\Domain\Video\VideoStepUrl;
use Acme\Shared\Domain\Bus\Command\CommandHandler;

/** Adds a video step to a course. */
final readonly class CreateVideoStepCommandHandler implements CommandHandler
{
	public function __construct(private StepRepository $repository) {}

	public function __invoke(CreateVideoStepCommand $command): void
	{
		$step = VideoStep::create(new StepId($command->id()), new StepTitle($command->title()), new VideoStepUrl($command->url()));

		$this->repository->save($step);
	}
}
