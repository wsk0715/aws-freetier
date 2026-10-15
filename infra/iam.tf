data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "receive" {
  name               = "${local.name_prefix}-receive"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "receive" {
  statement {
    sid       = "StoreOriginal"
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.inbox.arn]
  }

  statement {
    sid       = "EnqueueWork"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.work.arn]
  }

  statement {
    sid       = "WriteLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.receive.arn}:*"]
  }
}

resource "aws_iam_role_policy" "receive" {
  name   = "${local.name_prefix}-receive"
  role   = aws_iam_role.receive.id
  policy = data.aws_iam_policy_document.receive.json
}

resource "aws_iam_role" "worker" {
  name               = "${local.name_prefix}-worker"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "worker" {
  statement {
    sid       = "ReadWriteInbox"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query"]
    resources = [aws_dynamodb_table.inbox.arn]
  }

  statement {
    sid       = "ConsumeWorkQueue"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [aws_sqs_queue.work.arn]
  }

  statement {
    sid       = "PublishProcessed"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.processed.arn]
  }

  statement {
    sid       = "WriteLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.worker.arn}:*"]
  }
}

resource "aws_iam_role_policy" "worker" {
  name   = "${local.name_prefix}-worker"
  role   = aws_iam_role.worker.id
  policy = data.aws_iam_policy_document.worker.json
}

resource "aws_iam_role" "history" {
  name               = "${local.name_prefix}-history"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "history" {
  statement {
    sid       = "WriteDeliveryHistory"
    actions   = ["dynamodb:PutItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.inbox.arn]
  }

  statement {
    sid       = "ConsumeHistoryQueue"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [aws_sqs_queue.history.arn]
  }

  statement {
    sid       = "WriteLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.history.arn}:*"]
  }
}

resource "aws_iam_role_policy" "history" {
  name   = "${local.name_prefix}-history"
  role   = aws_iam_role.history.id
  policy = data.aws_iam_policy_document.history.json
}

resource "aws_iam_role" "ops" {
  name               = "${local.name_prefix}-ops"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "ops" {
  statement {
    sid       = "ReadWriteInbox"
    actions   = ["dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query"]
    resources = [aws_dynamodb_table.inbox.arn]
  }

  statement {
    sid       = "DrainDeadLetterQueue"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [aws_sqs_queue.dlq.arn]
  }

  statement {
    sid       = "ReenqueueWork"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.work.arn]
  }

  statement {
    sid       = "WriteLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.ops.arn}:*"]
  }
}

resource "aws_iam_role_policy" "ops" {
  name   = "${local.name_prefix}-ops"
  role   = aws_iam_role.ops.id
  policy = data.aws_iam_policy_document.ops.json
}

resource "aws_iam_role" "query" {
  name               = "${local.name_prefix}-query"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "query" {
  statement {
    sid       = "ReadInbox"
    actions   = ["dynamodb:Query"]
    resources = [aws_dynamodb_table.inbox.arn]
  }

  statement {
    sid       = "WriteLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.query.arn}:*"]
  }
}

resource "aws_iam_role_policy" "query" {
  name   = "${local.name_prefix}-query"
  role   = aws_iam_role.query.id
  policy = data.aws_iam_policy_document.query.json
}

data "aws_iam_policy_document" "scheduler_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${local.name_prefix}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume_role.json
}

data "aws_iam_policy_document" "scheduler" {
  statement {
    sid       = "InvokeOps"
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.ops.arn]
  }
}

resource "aws_iam_role_policy" "scheduler" {
  name   = "${local.name_prefix}-scheduler"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler.json
}
