resource "aws_sns_topic" "order_events" {
  name = "${var.prefix}-order-events"
  tags = local.tags
}

resource "aws_sqs_queue" "orders_dlq" {
  name                      = "${local.queue_name}-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "orders" {
  name                       = local.queue_name
  visibility_timeout_seconds = 60
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.orders_dlq.arn
    maxReceiveCount     = 4
  })
}

resource "aws_sqs_queue" "audit" {
  name                        = "${var.prefix}-audit.fifo"
  fifo_queue                  = true
  content_based_deduplication = true
}

resource "aws_sqs_queue" "legacy_dlq" {
  name = "legacy-dlq"
}

resource "aws_sqs_queue" "legacy" {
  name           = "legacy"
  redrive_policy = <<EOT
{
  "deadLetterTargetArn": "${aws_sqs_queue.legacy_dlq.arn}",
  "maxReceiveCount": 10
}
EOT
}

resource "aws_sqs_queue" "generated" {
  name_prefix = "tmp-"
}

resource "aws_sqs_queue" "opaque" {
  name = var.opaque_name
}

resource "aws_sns_topic_subscription" "orders" {
  topic_arn = aws_sns_topic.order_events.arn
  protocol  = "sqs"
  endpoint  = aws_sqs_queue.orders.arn
}

resource "aws_sns_topic_subscription" "notify" {
  topic_arn = aws_sns_topic.order_events.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.notify.arn
}

resource "aws_sns_topic_subscription" "ops" {
  topic_arn = aws_sns_topic.order_events.arn
  protocol  = "email"
  endpoint  = "ops@example.com"
}
