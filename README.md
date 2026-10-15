# webhook-inbox

AWS 상시 무료 자원만으로 만든 웹훅 수신 대행 프로토타입이다. 웹훅을 받자마자 응답하고 원본을 보관한 뒤, 큐로 넘겨 비동기로 처리한다.

## 구조

```
발신자 ─▶ receive (Function URL) ─▶ DynamoDB 원본 보관
                    │
                    ▼
             SQS 작업 큐 ─▶ worker ─▶ SNS 처리 완료 ─▶ history (발송 이력)
                    │
                    ▼ 최대 수신 횟수 초과
                   DLQ ◀── ops (매일 09:07 KST: 한 번 재처리, 그다음 격리, 일일 요약)

브라우저 ─▶ CloudFront + S3 (수신함 UI) ─▶ query (Function URL: 목록, 요약, 수동 재처리)
```

| 경로 | 내용 |
|---|---|
| `backend/` | Lambda 함수 5개 (TypeScript, esbuild로 함수별 번들) |
| `frontend/` | 수신함 UI (React + Vite) |
| `infra/` | Terraform 자원 정의 |
| `.github/workflows/` | CI 검사, 수신함 UI 배포 |

## 개발

Node 22와 pnpm 11이 필요하다.

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build     # backend/dist/, frontend/dist/
```

수신함 UI를 로컬에서 띄우려면 `frontend/.env`에 `VITE_QUERY_API_URL`을 넣고 `pnpm --filter frontend dev`를 실행한다. 조회 API는 `allowed_origin`에 등록된 출처만 허용하므로, 로컬 주소로 부르려면 그 값도 바꿔 적용해야 한다.

## 배포

1. `pnpm build`로 함수 번들을 만든다.
2. `infra/terraform.tfvars.example`을 `terraform.tfvars`로 복사해 값을 채운다.
3. 비밀값 세 개는 파일이 아니라 환경변수 `TF_VAR_receive_path_secret`, `TF_VAR_webhook_signing_secret`, `TF_VAR_query_token`으로 넘긴다. 셋은 서로 다른 값을 쓴다.
4. `infra/`에서 `terraform apply`를 실행한다.
5. 출력값 `site_deploy_role_arn`, `site_bucket`, `cloudfront_distribution_id`, `query_url`을 GitHub 저장소 변수 `AWS_DEPLOY_ROLE_ARN`, `SITE_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID`, `VITE_QUERY_API_URL`에 넣는다.

수신함 UI는 `main`에 프런트엔드 변경이 푸시되면 GitHub Actions가 S3에 올리고 CloudFront 캐시를 무효화한다. 함수와 인프라는 `terraform apply`로만 바뀐다.

## 웹훅 보내기

수신 주소는 출력값 `receive_url_base` 뒤에 비밀 경로를 붙인 값이다. 요청에는 두 헤더가 필요하다.

| 헤더 | 값 |
|---|---|
| `x-webhook-timestamp` | 유닉스 초. 서버 시각과 300초 넘게 차이 나면 거절한다 |
| `x-webhook-signature` | `sha256=` + HMAC-SHA256(서명 비밀값, `{timestamp}.{body}`)의 16진수 |

본문은 `id`, `type`, `data`를 가진 JSON이며 64KB까지 받는다. 같은 `id`는 한 번만 처리한다. 응답은 `202` 수신, `401` 서명 오류, `413` 본문 초과다.
