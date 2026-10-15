output "receive_url_base" {
  description = "수신 Function URL의 기본 주소. 발신자에게 알릴 주소는 여기에 비밀 경로를 붙인 값이다."
  value       = aws_lambda_function_url.receive.function_url
}

output "query_url" {
  description = "조회 Function URL. 프런트엔드 VITE_QUERY_API_URL에 넣는다."
  value       = aws_lambda_function_url.query.function_url
}

output "site_url" {
  description = "수신함 UI 주소."
  value       = "https://${aws_cloudfront_distribution.site.domain_name}"
}

output "site_bucket" {
  description = "프런트엔드 산출물을 올리는 버킷."
  value       = aws_s3_bucket.site.id
}

output "cloudfront_distribution_id" {
  description = "배포 후 캐시를 무효화할 때 쓴다."
  value       = aws_cloudfront_distribution.site.id
}

output "inbox_table_name" {
  description = "수신함 테이블."
  value       = aws_dynamodb_table.inbox.name
}

output "site_deploy_role_arn" {
  description = "GitHub Actions 배포 워크플로가 맡는 역할. 저장소 변수 AWS_DEPLOY_ROLE_ARN에 넣는다."
  value       = aws_iam_role.site_deploy.arn
}

output "cognito_domain" {
  description = "로그인 도메인. 프런트엔드 VITE_COGNITO_DOMAIN에 넣는다."
  value       = "https://${aws_cognito_user_pool_domain.site.domain}.auth.${var.region}.amazoncognito.com"
}

output "cognito_client_id" {
  description = "수신함 UI 앱 클라이언트. 프런트엔드 VITE_COGNITO_CLIENT_ID에 넣는다."
  value       = aws_cognito_user_pool_client.site.id
}
