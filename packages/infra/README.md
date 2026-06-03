# @eventforge/infra

CloudFormation templates. 11 of them, deployed as nested stacks from the root `template.yaml`.

## Templates

| File | What it creates |
|------|----------------|
| vpc.yaml | VPC, 2 public and 2 private subnets across 2 AZs, NAT gateways, route tables, flow logs |
| dynamodb.yaml | The events table with GSIs and TTL |
| iam.yaml | 9 IAM roles (one per service component, least privilege) |
| cognito.yaml | User pool with email auth and 1-hour token expiry |
| ecs.yaml | ECS cluster, task definition, service, ALB, autoscaling, security groups |
| eventbridge.yaml | Custom bus, 5 routing rules, queue policies |
| sqs.yaml | 3 queues + 3 dead letter queues with redrive policies |
| apigateway.yaml | HTTP API with throttling at 100 req/s |
| cloudfront.yaml | S3 bucket + CloudFront distribution for the React app |
| alarms.yaml | SNS topic + 3 CloudWatch alarms on DLQ depth |
| lambdas.yaml | All 10 Lambda functions with SQS triggers and X-Ray |

## The state machine

`statemachines/order-workflow.asl.json` is the ASL definition for the order saga. It has retry/catch on every step and X-Ray tracing enabled.

## Deploying

From the project root:

```bash
sam deploy --guided
```

CloudFormation figures out the dependency order from the nested stack references. VPC and DynamoDB go first, then IAM, then everything else.

## Parameters

| Name | Default | What |
|------|---------|------|
| EnvironmentName | dev | Prefix for all resource names |
| VpcCidr | 10.0.0.0/16 | VPC address space |
| EcsMinTasks | 1 | Minimum Fargate tasks |
| EcsMaxTasks | 4 | Maximum Fargate tasks |
| DomainName | (empty) | Custom domain, optional |
| LogRetentionDays | 30 | How long to keep CloudWatch logs |
| ContainerImage | (required) | ECR image URI for the API |

## Validating templates

```bash
sam validate
cfn-lint packages/infra/templates/*.yaml
```
