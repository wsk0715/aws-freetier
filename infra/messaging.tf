resource "aws_sqs_queue" "dlq" {
  name                       = "${local.name_prefix}-dlq"
  message_retention_seconds  = local.queue_retention_seconds
  visibility_timeout_seconds = local.worker_visibility_timeout
}

resource "aws_sqs_queue" "work" {
  name                       = "${local.name_prefix}-work"
  message_retention_seconds  = local.queue_retention_seconds
  visibility_timeout_seconds = local.worker_visibility_timeout

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = local.max_receive_count
  })
}

resource "aws_sqs_queue" "history" {
  name                       = "${local.name_prefix}-history"
  message_retention_seconds  = local.queue_retention_seconds
  visibility_timeout_seconds = local.history_visibility_timeout
}

resource "aws_sns_topic" "processed" {
  name = "${local.name_prefix}-processed"
}

resource "aws_sns_topic_subscription" "history" {
  topic_arn            = aws_sns_topic.processed.arn
  protocol             = "sqs"
  endpoint             = aws_sqs_queue.history.arn
  raw_message_delivery = true
}

data "aws_iam_policy_document" "history_queue" {
  statement {
    sid       = "AllowProcessedTopic"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.history.arn]

    principals {
      type        = "Service"
      identifiers = ["sns.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_sns_topic.processed.arn]
    }
  }
}

resource "aws_sqs_queue_policy" "history" {
  queue_url = aws_sqs_queue.history.id
  policy    = data.aws_iam_policy_document.history_queue.json
}
