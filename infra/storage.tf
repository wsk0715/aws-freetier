resource "aws_dynamodb_table" "inbox" {
  name           = "${local.name_prefix}-inbox"
  billing_mode   = "PROVISIONED"
  read_capacity  = var.dynamodb_read_capacity
  write_capacity = var.dynamodb_write_capacity
  hash_key       = "inboxId"
  range_key      = "sortKey"
  table_class    = "STANDARD"

  attribute {
    name = "inboxId"
    type = "S"
  }

  attribute {
    name = "sortKey"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  # 지속 백업은 무료 대상이 아니므로 켜지 않는다.
  point_in_time_recovery {
    enabled = false
  }
}
