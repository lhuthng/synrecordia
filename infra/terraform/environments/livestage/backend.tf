terraform {
  required_version = ">= 1.5"

  # Remote state in S3 with DynamoDB locking. Bucket is bootstrapped manually
  # (see infra/terraform/bootstrap/).
  backend "s3" {
    bucket         = "synrecordia-terraform-state"
    key            = "livestage/terraform.tfstate"
    region         = "eu-central-1"
    dynamodb_table = "synrecordia-terraform-locks"
    encrypt        = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

provider "aws" {
  region = var.region
  # Livestage is real AWS: no endpoint override.
  default_tags {
    tags = var.tags
  }
}

# Cloudflare manages DNS for the custom domain (ACM validation + ALB record).
provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
