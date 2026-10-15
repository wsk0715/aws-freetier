# GitHub Actions가 수신함 UI를 배포할 때 쓰는 역할. 장기 액세스 키 없이 OIDC로 위임받는다.

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "site_deploy_assume_role" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # main 브랜치에서 실행된 워크플로만 배포 역할을 받는다.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "site_deploy" {
  name               = "${local.name_prefix}-site-deploy"
  assume_role_policy = data.aws_iam_policy_document.site_deploy_assume_role.json
}

data "aws_iam_policy_document" "site_deploy" {
  statement {
    sid       = "ListSite"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.site.arn]
  }

  statement {
    sid       = "WriteSite"
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]
  }

  statement {
    sid       = "InvalidateSite"
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [aws_cloudfront_distribution.site.arn]
  }
}

resource "aws_iam_role_policy" "site_deploy" {
  name   = "${local.name_prefix}-site-deploy"
  role   = aws_iam_role.site_deploy.id
  policy = data.aws_iam_policy_document.site_deploy.json
}
