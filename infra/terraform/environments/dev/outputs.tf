output "alb_dns_name" {
  value       = module.alb.alb_dns_name
  description = "Point the Cloudflare A record to this ALB."
}

output "alb_zone_id" {
  value       = module.alb.alb_zone_id
  description = "Route53 alias target zone id (if using alias records)."
}

output "redis_endpoint" {
  value       = module.redis.redis_address
  description = "ElastiCache Redis primary endpoint host."
}

output "web_service" {
  value = module.ecs.web_service
}
output "relay_service" {
  value = module.ecs.relay_service
}

output "ecr_repo_urls" {
  value       = module.ecr.repo_urls
  description = "Map of app -> ECR repository URL (used by CI/CD to push images)."
}

output "github_deploy_role_arn" {
  value       = module.iam.github_deploy_role_arn
  description = "IAM role ARN assumed by GitHub Actions for deploy."
}
