resource "aws_scheduler_schedule" "ops_daily" {
  name       = "${local.name_prefix}-ops-daily"
  group_name = "default"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = local.schedule_expression
  schedule_expression_timezone = "UTC"

  target {
    arn      = aws_lambda_function.ops.arn
    role_arn = aws_iam_role.scheduler.arn
  }
}
