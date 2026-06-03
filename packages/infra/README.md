# @eventforge/infra

AWS SAM / CloudFormation infrastructure templates for the EventForge platform. All resources are defined as code, parameterized for multi-environment deployment.

## Templates

| Template | Resources | Key Parameters |
|----------|-----------|----------------|
| `vpc.yaml` | VPC, 2 public + 2 private subnets, NAT Gateways, IGW, route tables, flow logs | VpcCidr, LogRetentionDays |
| `dynamodb.yaml` | DynamoDB table (PK/SK, GSI1, GSI2, TTL, on-demand) | EnvironmentName |
| `iam.yaml` | 9 IAM roles (ECS, Lambda x5, Step Functions, API Gateway) | Resource ARNs |
| `cognito.yaml` | User pool, client (1-hour tokens, email auth) | EnvironmentName |
| `ecs.yaml` | ECS cluster, task def, service, ALB, target group, autoscaling, security groups | VpcId, Subnets, ContainerImage |
| `eventbridge.yaml` | Custom bus, 5 routing rules, SQS/CloudWatch policies | Queue ARNs, StepFunctions ARN |
| `sqs.yaml` | 3 queues + 3 DLQs with redrive policies | EnvironmentName |
| `apigateway.yaml` | HTTP API, POST /webhooks/ingest, throttling (100 req/s) | Lambda ARN |
| `cloudfront.yaml` | S3 bucket, CloudFront distribution, OAI, SPA routing | EnvironmentName |
| `alarms.yaml` | SNS topic, 3 CloudWatch alarms (DLQ depth > 0) | DLQ names |
| `lambdas.yaml` | 10 Lambda functions, SQS event sources, X-Ray tracing | Role ARNs, Queue ARNs |

## State Machine

`statemachines/order-workflow.asl.json` — ASL definition for the order processing saga:
- ValidateOrder → ReserveInventory (retry 2x) → ChargePayment → ConfirmOrder
- Compensation: ChargePayment/ConfirmOrder failure → ReleaseInventory (retry 3x) → OrderFailed
- X-Ray tracing enabled

## Deployment

The root `template.yaml` (project root) orchestrates all templates as nested stacks:

```bash
sam deploy --guided
```

Deployment order (resolved by CloudFormation):
1. VPC, DynamoDB, SQS, Cognito, S3 Receipts, CloudFront (parallel)
2. IAM roles, Step Functions state machine
3. EventBridge bus and rules
4. ECS Fargate service, Webhook ingestion Lambda
5. API Gateway
6. CloudWatch alarms

## Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| EnvironmentName | dev | Environment (dev/staging/prod) |
| VpcCidr | 10.0.0.0/16 | VPC CIDR block |
| EcsMinTasks | 1 | Minimum ECS task count |
| EcsMaxTasks | 4 | Maximum ECS task count |
| DomainName | (empty) | Custom domain (optional) |
| LogRetentionDays | 30 | CloudWatch log retention |
| ContainerImage | (required) | ECR image URI for API |

## Validation

```bash
# Syntax check
sam validate

# Lint
cfn-lint packages/infra/templates/*.yaml

# Security scan
checkov -d packages/infra/templates/
```
