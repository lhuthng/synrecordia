variable "project" { type = string }
variable "environment" { type = string }

# SSM parameters consumed by tasks (redis URL, relay token). Values injected at
# apply time from tfvars / environment, kept out of git.
resource "aws_ssm_parameter" "redis_url" {
  name  = "/${var.project}/${var.environment}/redis-url"
  type  = "SecureString"
  value = var.redis_url
}
resource "aws_ssm_parameter" "redis_auth" {
  name  = "/${var.project}/${var.environment}/redis-auth"
  type  = "SecureString"
  value = var.redis_auth
}
resource "aws_ssm_parameter" "relay_token" {
  name  = "/${var.project}/${var.environment}/relay-token"
  type  = "SecureString"
  value = var.relay_token
}

variable "redis_url" { type = string }
variable "redis_auth" { type = string }
variable "relay_token" { type = string }

output "redis_url_param" { value = aws_ssm_parameter.redis_url.name }
output "redis_auth_param" { value = aws_ssm_parameter.redis_auth.name }
output "relay_token_param" { value = aws_ssm_parameter.relay_token.name }
