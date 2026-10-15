locals {
  name_prefix = "webhook-inbox"

  functions_dir = "${path.module}/../backend/dist"

  lambda_runtime = "nodejs22.x"
  memory_size    = 256

  receive_timeout = 10
  worker_timeout  = 30
  history_timeout = 30
  ops_timeout     = 60
  query_timeout   = 10

  # 큐 가시성 제한은 소비 함수의 타임아웃보다 길어야 한다.
  worker_visibility_timeout = local.worker_timeout * 6

  worker_batch_size = 10
  max_receive_count = 3

  queue_retention_seconds = 4 * 24 * 60 * 60

  # 매일 00:07 UTC (09:07 KST)에 운영 작업을 실행한다.
  schedule_expression = "cron(7 0 * * ? *)"
}
