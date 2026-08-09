variable "project" { type = string }
variable "environment" { type = string }
variable "vpc_id" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "relay_sg_id" { type = string }
variable "redis_secret_arn" { type = string }

# ElastiCache Redis — private, reachable only from the relay SG. Room state lives here.
resource "aws_elasticache_subnet_group" "redis" {
  name       = "${var.project}-${var.environment}-redis"
  subnet_ids = var.private_subnet_ids
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = "${var.project}-${var.environment}-redis"
  description                = "SynRecordia shared room state"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = "cache.t3.micro"
  num_cache_clusters         = 2
  port                       = 6379
  automatic_failover_enabled = true
  multi_az_enabled           = true
  subnet_group_name          = aws_elasticache_subnet_group.redis.name
  security_group_ids         = [aws_security_group.redis.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = data.aws_ssm_parameter.redis_auth.value
  auth_token_update_strategy = "ROTATE"
  maintenance_window         = "sun:05:00-sun:06:00"
  snapshot_window            = "04:00-05:00"
  snapshot_retention_limit   = 1
  auto_minor_version_upgrade = true
  tags                       = { Name = "${var.project}-${var.environment}-redis" }
}

# Redis auth token stored in SSM (parameter created in the ssm module).
data "aws_ssm_parameter" "redis_auth" {
  name = var.redis_secret_arn
}

resource "aws_security_group" "redis" {
  name_prefix = "${var.project}-${var.environment}-redis-"
  vpc_id      = var.vpc_id
  description = "Redis: allow relay only"
  tags        = { Name = "${var.project}-${var.environment}-redis-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "redis_from_relay" {
  security_group_id            = aws_security_group.redis.id
  referenced_security_group_id = var.relay_sg_id
  from_port                    = 6379
  to_port                      = 6379
  ip_protocol                  = "tcp"
  description                  = "Relay -> Redis"
}

resource "aws_vpc_security_group_egress_rule" "redis_all" {
  security_group_id = aws_security_group.redis.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

output "redis_address" { value = aws_elasticache_replication_group.redis.primary_endpoint_address }
output "redis_port" { value = aws_elasticache_replication_group.redis.port }
