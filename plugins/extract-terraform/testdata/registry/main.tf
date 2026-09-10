variable "prefix" {
  type    = string
  default = "orders"
}

module "queue" {
  source  = "terraform-aws-modules/sqs/aws"
  version = "~> 4.0"

  name       = "${var.prefix}-inbox"
  create_dlq = true
  redrive_policy = {
    maxReceiveCount = 5
  }
}

module "events" {
  source  = "terraform-aws-modules/sns/aws"
  version = "~> 6.0"

  name = "${var.prefix}-events"

  subscriptions = {
    inbox = {
      protocol = "sqs"
      endpoint = module.queue.queue_arn
    }
    audit = {
      protocol = "lambda"
      endpoint = module.audit.lambda_function_arn
    }
    ops = {
      protocol = "email"
      endpoint = "ops@example.com"
    }
  }
}

module "uploads" {
  source  = "terraform-aws-modules/s3-bucket/aws"
  version = "~> 4.0"

  bucket = "${var.prefix}-uploads"
}

module "uploads_notification" {
  source  = "terraform-aws-modules/s3-bucket/aws//modules/notification"
  version = "~> 4.0"

  bucket = module.uploads.s3_bucket_id

  lambda_notifications = {
    ingest = {
      function_arn  = module.ingest.lambda_function_arn
      function_name = module.ingest.lambda_function_name
      events        = ["s3:ObjectCreated:*"]
      filter_suffix = ".csv"
    }
  }

  sqs_notifications = {
    removed = {
      queue_arn = module.queue.dead_letter_queue_arn
      events    = ["s3:ObjectRemoved:*"]
    }
  }
}

module "table" {
  source  = "terraform-aws-modules/dynamodb-table/aws"
  version = "~> 4.0"

  name      = "${var.prefix}-table"
  hash_key  = "order_id"
  range_key = "version"

  attributes = [
    {
      name = "order_id"
      type = "S"
    },
    {
      name = "version"
      type = "N"
    },
    {
      name = "customer_id"
      type = "S"
    },
  ]

  global_secondary_indexes = [
    {
      name            = "by_customer"
      hash_key        = "customer_id"
      projection_type = "ALL"
    },
  ]
}

module "ingest" {
  source  = "terraform-aws-modules/lambda/aws"
  version = "~> 7.0"

  function_name = "${var.prefix}-ingest"
  handler       = "index.handler"
  runtime       = "python3.12"
  source_path   = "${path.module}/src/ingest"

  environment_variables = {
    TABLE_NAME = module.table.dynamodb_table_id
    BUCKET     = module.uploads.s3_bucket_id
    LOG_LEVEL  = "info"
  }

  event_source_mapping = {
    inbox = {
      event_source_arn        = module.queue.queue_arn
      function_response_types = ["ReportBatchItemFailures"]
    }
  }

  allowed_triggers = {
    uploads = {
      service    = "s3"
      source_arn = module.uploads.s3_bucket_arn
    }
    inbox = {
      service    = "sqs"
      source_arn = module.queue.queue_arn
    }
  }
}

module "audit" {
  source = "git::https://github.com/terraform-aws-modules/terraform-aws-lambda.git?ref=v7.20.1"

  function_name = "${var.prefix}-audit"
  handler       = "index.handler"
  runtime       = "nodejs20.x"

  event_source_mapping = {
    stream = {
      event_source_arn  = module.table.dynamodb_table_stream_arn
      starting_position = "LATEST"
    }
  }
}

module "shared_layer" {
  source  = "terraform-aws-modules/lambda/aws"
  version = "~> 7.0"

  create_layer        = true
  layer_name          = "${var.prefix}-shared"
  compatible_runtimes = ["python3.12"]
  source_path         = "${path.module}/src/layer"
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "${var.prefix}-vpc"
}
