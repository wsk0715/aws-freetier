data "archive_file" "receive" {
  type        = "zip"
  source_file = "${local.functions_dir}/receive/index.js"
  output_path = "${path.module}/build/receive.zip"
}

resource "aws_cloudwatch_log_group" "receive" {
  name              = "/aws/lambda/${local.name_prefix}-receive"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "receive" {
  function_name    = "${local.name_prefix}-receive"
  role             = aws_iam_role.receive.arn
  handler          = "index.handler"
  runtime          = local.lambda_runtime
  architectures    = ["arm64"]
  timeout          = local.receive_timeout
  memory_size      = local.memory_size
  filename         = data.archive_file.receive.output_path
  source_code_hash = data.archive_file.receive.output_base64sha256

  environment {
    variables = {
      INBOX_TABLE            = aws_dynamodb_table.inbox.name
      WORK_QUEUE_URL         = aws_sqs_queue.work.url
      RECEIVE_PATH           = var.receive_path_secret
      WEBHOOK_SIGNING_SECRET = var.webhook_signing_secret
      RETENTION_DAYS         = var.item_retention_days
    }
  }

  depends_on = [aws_cloudwatch_log_group.receive]
}

resource "aws_lambda_function_url" "receive" {
  function_name      = aws_lambda_function.receive.function_name
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "receive_url" {
  statement_id           = "AllowPublicFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.receive.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

data "archive_file" "worker" {
  type        = "zip"
  source_file = "${local.functions_dir}/worker/index.js"
  output_path = "${path.module}/build/worker.zip"
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/aws/lambda/${local.name_prefix}-worker"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "worker" {
  function_name    = "${local.name_prefix}-worker"
  role             = aws_iam_role.worker.arn
  handler          = "index.handler"
  runtime          = local.lambda_runtime
  architectures    = ["arm64"]
  timeout          = local.worker_timeout
  memory_size      = local.memory_size
  filename         = data.archive_file.worker.output_path
  source_code_hash = data.archive_file.worker.output_base64sha256

  environment {
    variables = {
      INBOX_TABLE         = aws_dynamodb_table.inbox.name
      PROCESSED_TOPIC_ARN = aws_sns_topic.processed.arn
      RETENTION_DAYS      = var.item_retention_days
    }
  }

  depends_on = [aws_cloudwatch_log_group.worker]
}

resource "aws_lambda_event_source_mapping" "worker" {
  event_source_arn        = aws_sqs_queue.work.arn
  function_name           = aws_lambda_function.worker.arn
  batch_size              = local.worker_batch_size
  function_response_types = ["ReportBatchItemFailures"]
}

data "archive_file" "history" {
  type        = "zip"
  source_file = "${local.functions_dir}/history/index.js"
  output_path = "${path.module}/build/history.zip"
}

resource "aws_cloudwatch_log_group" "history" {
  name              = "/aws/lambda/${local.name_prefix}-history"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "history" {
  function_name    = "${local.name_prefix}-history"
  role             = aws_iam_role.history.arn
  handler          = "index.handler"
  runtime          = local.lambda_runtime
  architectures    = ["arm64"]
  timeout          = local.history_timeout
  memory_size      = local.memory_size
  filename         = data.archive_file.history.output_path
  source_code_hash = data.archive_file.history.output_base64sha256

  environment {
    variables = {
      INBOX_TABLE    = aws_dynamodb_table.inbox.name
      RETENTION_DAYS = var.item_retention_days
    }
  }

  depends_on = [aws_cloudwatch_log_group.history]
}

resource "aws_lambda_permission" "history_sns" {
  statement_id  = "AllowProcessedTopic"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.history.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.processed.arn
}

resource "aws_lambda_function_event_invoke_config" "history" {
  function_name          = aws_lambda_function.history.function_name
  maximum_retry_attempts = 2

  destination_config {
    on_failure {
      destination = aws_sqs_queue.history_failed.arn
    }
  }
}

data "archive_file" "ops" {
  type        = "zip"
  source_file = "${local.functions_dir}/ops/index.js"
  output_path = "${path.module}/build/ops.zip"
}

resource "aws_cloudwatch_log_group" "ops" {
  name              = "/aws/lambda/${local.name_prefix}-ops"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "ops" {
  function_name    = "${local.name_prefix}-ops"
  role             = aws_iam_role.ops.arn
  handler          = "index.handler"
  runtime          = local.lambda_runtime
  architectures    = ["arm64"]
  timeout          = local.ops_timeout
  memory_size      = local.memory_size
  filename         = data.archive_file.ops.output_path
  source_code_hash = data.archive_file.ops.output_base64sha256

  environment {
    variables = {
      INBOX_TABLE    = aws_dynamodb_table.inbox.name
      WORK_QUEUE_URL = aws_sqs_queue.work.url
      DLQ_URL        = aws_sqs_queue.dlq.url
      RETENTION_DAYS = var.item_retention_days
    }
  }

  depends_on = [aws_cloudwatch_log_group.ops]
}

data "archive_file" "query" {
  type        = "zip"
  source_file = "${local.functions_dir}/query/index.js"
  output_path = "${path.module}/build/query.zip"
}

resource "aws_cloudwatch_log_group" "query" {
  name              = "/aws/lambda/${local.name_prefix}-query"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "query" {
  function_name    = "${local.name_prefix}-query"
  role             = aws_iam_role.query.arn
  handler          = "index.handler"
  runtime          = local.lambda_runtime
  architectures    = ["arm64"]
  timeout          = local.query_timeout
  memory_size      = local.memory_size
  filename         = data.archive_file.query.output_path
  source_code_hash = data.archive_file.query.output_base64sha256

  environment {
    variables = {
      INBOX_TABLE    = aws_dynamodb_table.inbox.name
      QUERY_TOKEN    = var.query_token
      WORK_QUEUE_URL = aws_sqs_queue.work.url
    }
  }

  depends_on = [aws_cloudwatch_log_group.query]
}

resource "aws_lambda_function_url" "query" {
  function_name      = aws_lambda_function.query.function_name
  authorization_type = "NONE"

  cors {
    allow_credentials = false
    allow_headers     = ["content-type", "x-inbox-token"]
    allow_methods     = ["GET", "POST"]
    allow_origins     = [var.allowed_origin != "" ? var.allowed_origin : "https://${aws_cloudfront_distribution.site.domain_name}"]
    max_age           = 300
  }
}

resource "aws_lambda_permission" "query_url" {
  statement_id           = "AllowQueryFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.query.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}
