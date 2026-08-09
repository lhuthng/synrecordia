variable "region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "eu-central-1"
}

variable "aws_endpoint" {
  description = "Override endpoint for all AWS services. Set to http://localhost:4566 for LocalStack testing (leave empty for real AWS)."
  type        = string
  default     = ""
}

variable "project" {
  description = "Short project/namespace prefix for resource naming."
  type        = string
  default     = "synrecordia"
}

variable "environment" {
  description = "Deployment environment (e.g. livestage)."
  type        = string
  default     = "livestage"
}

variable "domain_name" {
  description = "Public custom domain served by the ALB (managed at Cloudflare)."
  type        = string
  default     = "synrecordia.site"
}

variable "tags" {
  description = "Default tags applied to all resources."
  type        = map(string)
  default = {
    project     = "synrecordia"
    environment = "livestage"
    managed_by  = "terraform"
  }
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "azs" {
  description = "Availability zones (must match region)."
  type        = list(string)
  default     = ["eu-west-1a", "eu-west-1b", "eu-west-1c"]
}

variable "web_cpu" {
  type    = number
  default = 256
}

variable "web_memory" {
  type    = number
  default = 256
}

variable "relay_cpu" {
  type    = number
  default = 256
}

variable "relay_memory" {
  type    = number
  default = 512
}

variable "relay_desired_count" {
  type    = number
  default = 2
}

variable "github_repo" {
  description = "GitHub org/repo used for the OIDC deploy role."
  type        = string
  default     = "synrecordia/synrecordia"
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for the custom domain (DNS records created here)."
  type        = string
  default     = ""
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token with Zone:DNS edit permission."
  type        = string
  sensitive   = true
  default     = ""
}

variable "redis_url" {
  description = "ElastiCache Redis endpoint host:port (initial value; real value comes from tfvars)."
  type        = string
  default     = ""
}

variable "redis_auth" {
  description = "ElastiCache Redis auth token (SecureString)."
  type        = string
  sensitive   = true
  default     = ""
}

variable "relay_token" {
  description = "Token required on /api* calls (SecureString)."
  type        = string
  sensitive   = true
  default     = ""
}
