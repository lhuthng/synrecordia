variable "project" { type = string }
variable "environment" { type = string }
variable "repos" { type = list(string) }

# ECR repos per app: "web" and "relay" (image names livestage-web / livestage-relay).
resource "aws_ecr_repository" "repo" {
  for_each = toset(var.repos)
  name     = "${var.project}-${var.environment}-${each.value}"
  image_scanning_configuration { scan_on_push = true }
  image_tag_mutability = "MUTABLE"
  tags                 = { Name = "${var.project}-${var.environment}-${each.value}" }
}

# Prune old images, keep latest 10 (supports rollback).
resource "aws_ecr_lifecycle_policy" "policy" {
  for_each   = aws_ecr_repository.repo
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

output "repo_urls" {
  value = { for k, v in aws_ecr_repository.repo : k => v.repository_url }
}
output "repo_names" {
  value = { for k, v in aws_ecr_repository.repo : k => v.name }
}
