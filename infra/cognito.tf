# 수신함 UI 로그인. 구글 계정으로만 들어오고, 조회 함수가 허용한 이메일인지 다시 확인한다.

data "aws_ssm_parameter" "google_client_id" {
  name = "/${local.name_prefix}/google-client-id"
}

data "aws_ssm_parameter" "google_client_secret" {
  name = "/${local.name_prefix}/google-client-secret"
}

resource "aws_cognito_user_pool" "site" {
  name           = "${local.name_prefix}-site"
  user_pool_tier = "LITE"

  # 사용자는 구글 로그인으로만 생긴다.
  admin_create_user_config {
    allow_admin_create_user_only = true
  }
}

resource "aws_cognito_user_pool_domain" "site" {
  domain                = var.cognito_domain_prefix
  user_pool_id          = aws_cognito_user_pool.site.id
  managed_login_version = 1
}

resource "aws_cognito_identity_provider" "google" {
  user_pool_id  = aws_cognito_user_pool.site.id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    client_id        = data.aws_ssm_parameter.google_client_id.value
    client_secret    = data.aws_ssm_parameter.google_client_secret.value
    authorize_scopes = "openid email"
  }

  attribute_mapping = {
    email    = "email"
    username = "sub"
  }
}

resource "aws_cognito_user_pool_client" "site" {
  name         = "${local.name_prefix}-site"
  user_pool_id = aws_cognito_user_pool.site.id

  # 브라우저 앱이라 비밀값 없이 PKCE로 코드를 교환한다.
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email"]
  supported_identity_providers         = [aws_cognito_identity_provider.google.provider_name]
  callback_urls                        = ["${local.site_origin}/"]
  logout_urls                          = ["${local.site_origin}/"]

  id_token_validity = 60
  token_validity_units {
    id_token = "minutes"
  }
}
