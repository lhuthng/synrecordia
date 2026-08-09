terraform {
  required_version = ">= 1.5"

  # Dev/LocalStack keeps state local so it never touches the real S3 bucket.
  backend "local" {
    path = "terraform.tfstate"
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
  # LocalStack: route every AWS call to the emulator (no real AWS spend).
  endpoints {
    acm         = var.aws_endpoint
    cloudwatch  = var.aws_endpoint
    ec2         = var.aws_endpoint
    ecr         = var.aws_endpoint
    ecs         = var.aws_endpoint
    elasticache = var.aws_endpoint
    elbv2       = var.aws_endpoint
    iam         = var.aws_endpoint
    logs        = var.aws_endpoint
    s3          = var.aws_endpoint
    ssm         = var.aws_endpoint
  }
  default_tags {
    tags = var.tags
  }
}
