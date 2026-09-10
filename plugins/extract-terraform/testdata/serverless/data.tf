resource "aws_dynamodb_table" "orders" {
  name             = "${var.prefix}-orders"
  billing_mode     = "PAY_PER_REQUEST"
  hash_key         = "order_id"
  range_key        = "version"
  stream_enabled   = true
  stream_view_type = "NEW_IMAGE"

  attribute {
    name = "customer_id"
    type = "S"
  }

  attribute {
    name = "order_id"
    type = "S"
  }

  attribute {
    name = "version"
    type = "N"
  }

  global_secondary_index {
    name            = "by_customer"
    hash_key        = "customer_id"
    range_key       = "version"
    projection_type = "ALL"
  }

  local_secondary_index {
    name            = "by_version"
    range_key       = "version"
    projection_type = "KEYS_ONLY"
  }
}

resource "aws_s3_bucket" "labels" {
  bucket = "${var.prefix}-labels"
}

resource "aws_s3_bucket_notification" "labels" {
  bucket = aws_s3_bucket.labels.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.notify.arn
    events              = ["s3:ObjectCreated:*"]
  }

  queue {
    queue_arn = aws_sqs_queue.audit.arn
    events    = ["s3:ObjectRemoved:*"]
  }
}

resource "aws_db_instance" "reporting" {
  identifier        = "fulfillment-reporting"
  engine            = "postgres"
  engine_version    = "16"
  instance_class    = "db.t4g.micro"
  allocated_storage = 20
}

resource "aws_rds_cluster" "ledger" {
  cluster_identifier = lower("Fulfillment-Ledger")
  engine             = "aurora-mysql"
}

data "aws_caller_identity" "current" {}

resource "random_id" "suffix" {
  byte_length = 4
}

resource "aws_s3_bucket" "uploads" {
  bucket = "${var.prefix}-uploads-${random_id.suffix.hex}"
}

resource "aws_sqs_queue" "per_account" {
  name = "${var.prefix}-events-${data.aws_caller_identity.current.account_id}"
}

resource "aws_kinesis_stream" "clicks" {
  name        = "clicks"
  shard_count = 1
}
