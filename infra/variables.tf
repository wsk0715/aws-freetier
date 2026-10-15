variable "region" {
  description = "자원을 만들 리전. 계정의 무료 자격을 확인한 뒤 정한다."
  type        = string
}

variable "receive_path_secret" {
  description = "수신 Function URL 뒤에 붙는 비밀 경로 조각. 추측 불가능한 값이어야 하며 조회 토큰과 다른 값을 쓴다."
  type        = string
  sensitive   = true
}

variable "query_token" {
  description = "조회 API가 요구하는 비밀 토큰. 수신 경로 비밀값과 다른 값을 쓴다."
  type        = string
  sensitive   = true
}

variable "webhook_signing_secret" {
  description = "웹훅 본문 서명을 검증하는 HMAC 키. 수신 경로 비밀값·조회 토큰과 다른 값을 쓴다."
  type        = string
  sensitive   = true
}

variable "allowed_origin" {
  description = "조회 API의 CORS 허용 출처. 최초 적용 뒤 CloudFront 도메인으로 좁힌다."
  type        = string
  default     = "*"
}

variable "log_retention_days" {
  description = "CloudWatch Logs 보존 기간."
  type        = number
  default     = 14
}

variable "item_retention_days" {
  description = "수신 원본과 이력의 보존 기간. DynamoDB TTL로 삭제한다."
  type        = number
  default     = 30
}

variable "dynamodb_write_capacity" {
  description = "수신함 테이블의 provisioned WCU. 계정 무료 한도는 25다."
  type        = number
  default     = 5
}

variable "dynamodb_read_capacity" {
  description = "수신함 테이블의 provisioned RCU. 계정 무료 한도는 25다."
  type        = number
  default     = 5
}

variable "github_repository" {
  description = "수신함 UI를 배포하는 GitHub 저장소 (소유자/이름)."
  type        = string
  default     = "wsk0715/aws-freetier"
}
