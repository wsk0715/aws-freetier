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

# 이력 함수가 재시도 끝에 실패한 호출을 남기는 큐. 소비자가 없어 폴링 요청이 생기지 않는다.
resource "aws_sqs_queue" "history_failed" {
  name                      = "${local.name_prefix}-history-failed"
  message_retention_seconds = local.queue_retention_seconds
}

resource "aws_sns_topic" "processed" {
  name = "${local.name_prefix}-processed"
}

# SNS가 이력 함수를 직접 호출한다. 큐를 거치면 메시지가 없어도 폴링 요청이 계속 생긴다.
resource "aws_sns_topic_subscription" "history" {
  topic_arn = aws_sns_topic.processed.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.history.arn
}
