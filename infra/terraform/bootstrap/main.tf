# Bootstraps the S3 state bucket + DynamoDB lock table referenced by backend.tf.
# Run once manually (before `terraform init`):
#   terraform init && terraform apply -auto-approve
# then delete this directory's state (bootstrap state is local/throwaway) and
# run the real `terraform init` in the parent dir.

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

variable "bucket" {
  type    = string
  default = "synrecordia-terraform-state"
}
variable "region" {
  type    = string
  default = "eu-central-1"
}

provider "aws" { region = var.region }

resource "aws_s3_bucket" "state" {
  bucket = var.bucket
  tags   = { Name = "synrecordia-tf-state" }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "locks" {
  name         = "synrecordia-terraform-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"
  attribute {
    name = "LockID"
    type = "S"
  }
}
