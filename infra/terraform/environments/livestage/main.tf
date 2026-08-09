# Root wiring for the SynRecordia livestage deployment.
locals {
  prefix = "${var.project}-${var.environment}"
}

module "vpc" {
  source      = "../../modules/vpc"
  project     = var.project
  environment = var.environment
  vpc_cidr    = var.vpc_cidr
  azs         = var.azs
}

module "sg" {
  source      = "../../modules/sg"
  project     = var.project
  environment = var.environment
  vpc_id      = module.vpc.vpc_id
}

module "ssm" {
  source      = "../../modules/ssm"
  project     = var.project
  environment = var.environment
  redis_url   = var.redis_url
  redis_auth  = var.redis_auth
  relay_token = var.relay_token
}

module "ecr" {
  source      = "../../modules/ecr"
  project     = var.project
  environment = var.environment
  repos       = ["web", "relay"]
}

module "redis" {
  source             = "../../modules/redis"
  project            = var.project
  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  relay_sg_id        = module.sg.relay_sg_id
  redis_secret_arn   = module.ssm.redis_auth_param
}

module "iam" {
  source      = "../../modules/iam"
  project     = var.project
  environment = var.environment
  github_repo = var.github_repo
}

# ALB + ACM need target group ARNs, so they depend on the ECS module's outputs.
module "ecs" {
  source                 = "../../modules/ecs"
  project                = var.project
  environment            = var.environment
  region                 = var.region
  vpc_id                 = module.vpc.vpc_id
  private_subnet_ids     = module.vpc.private_subnet_ids
  web_sg_id              = module.sg.web_sg_id
  relay_sg_id            = module.sg.relay_sg_id
  ecs_execution_role_arn = module.iam.ecs_execution_role_arn
  ecs_task_role_arn      = module.iam.ecs_task_role_arn
  web_log_group          = module.cloudwatch.web_log_group
  relay_log_group        = module.cloudwatch.relay_log_group
  web_image              = module.ecr.repo_urls["web"]
  relay_image            = module.ecr.repo_urls["relay"]
  web_cpu                = var.web_cpu
  web_memory             = var.web_memory
  relay_cpu              = var.relay_cpu
  relay_memory           = var.relay_memory
  relay_desired_count    = var.relay_desired_count
  redis_url_param        = module.ssm.redis_url_param
  redis_auth_param       = module.ssm.redis_auth_param
  relay_token_param      = module.ssm.relay_token_param
}

module "cloudwatch" {
  source      = "../../modules/cloudwatch"
  project     = var.project
  environment = var.environment
}

module "alb" {
  source             = "../../modules/alb"
  project            = var.project
  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  public_subnet_ids  = module.vpc.public_subnet_ids
  alb_sg_id          = module.sg.alb_sg_id
  domain_name        = var.domain_name
  web_target_arn     = module.ecs.web_target_arn
  relay_target_arn   = module.ecs.relay_target_arn
  cloudflare_zone_id = var.cloudflare_zone_id
}
