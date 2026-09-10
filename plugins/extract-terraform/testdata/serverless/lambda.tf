resource "aws_iam_role" "lambda" {
  name               = "${var.prefix}-lambda"
  assume_role_policy = "{}"
}

resource "aws_lambda_function" "ship" {
  function_name = "${var.prefix}-ship"
  runtime       = "python3.12"
  handler       = "app.handler"
  role          = aws_iam_role.lambda.arn
  filename      = "ship.zip"

  environment {
    variables = {
      ORDERS_TABLE       = aws_dynamodb_table.orders.name
      AUDIT_QUEUE_URL    = aws_sqs_queue.audit.url
      LABELS_BUCKET      = aws_s3_bucket.labels.bucket
      ARCHIVE_BUCKET_ARN = module.archive.arn
      "LOG_LEVEL"        = "info"
    }
  }
}

resource "aws_lambda_event_source_mapping" "ship_orders" {
  event_source_arn = aws_sqs_queue.orders.arn
  function_name    = aws_lambda_function.ship.arn
  batch_size       = 10
}

resource "aws_lambda_function" "notify" {
  function_name = "${var.prefix}-notify"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  role          = aws_iam_role.lambda.arn
  filename      = "notify.zip"
}

resource "aws_lambda_function" "reindex" {
  function_name = "fulfillment-reindex"
  runtime       = "provided.al2023"
  handler       = "bootstrap"
  role          = aws_iam_role.lambda.arn
  filename      = "reindex.zip"
}

resource "aws_lambda_event_source_mapping" "reindex_stream" {
  event_source_arn  = aws_dynamodb_table.orders.stream_arn
  function_name     = "fulfillment-reindex"
  starting_position = "LATEST"
}

resource "aws_lambda_function" "unnamed" {
  runtime  = "python3.12"
  handler  = "app.handler"
  role     = aws_iam_role.lambda.arn
  filename = "x.zip"
}
