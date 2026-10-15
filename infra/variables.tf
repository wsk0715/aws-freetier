variable "region" {
  description = "자원을 만들 리전. 계정의 무료 자격을 확인한 뒤 정한다."
  type        = string
}

variable "receive_path_secret" {
  description = "수신 Function URL 뒤에 붙는 비밀 경로 조각. 추측 불가능한 값이어야 하며 서명 비밀값과 다른 값을 쓴다."
  type        = string
  sensitive   = true
}

variable "allowed_email" {
  description = "수신함 UI에 로그인할 수 있는 구글 계정 이메일. 공개 저장소에 남기지 않도록 tfvars나 환경변수로 넘긴다."
  type        = string
}

variable "cognito_domain_prefix" {
  description = "Cognito 로그인 도메인 접두사. 리전 안에서 유일해야 하며, 구글 OAuth 클라이언트의 리디렉션 URI에 들어간다."
  type        = string
  default     = "abyss-webhook-inbox"
}

variable "webhook_signing_secret" {
  description = "웹훅 본문 서명을 검증하는 HMAC 키. 수신 경로 비밀값과 다른 값을 쓴다."
  type        = string
  sensitive   = true
}

variable "allowed_origin" {
  description = "조회 API의 CORS 허용 출처. 비워 두면 수신함 UI의 CloudFront 주소만 허용한다."
  type        = string
  default     = ""
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

variable "github_oidc_subject_prefix" {
  description = "배포 저장소의 OIDC sub 접두사. immutable subject를 쓰는 저장소는 소유자·저장소 ID가 붙으며, GitHub API repos/{owner}/{repo}/actions/oidc/customization/sub의 sub_claim_prefix 값이다."
  type        = string
  default     = "repo:wsk0715@58899677/aws-freetier@1420232275"
}
