terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

variable "project" { type = string }
variable "environment" { type = string }
variable "region" { type = string }
variable "vpc_id" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "web_sg_id" { type = string }
variable "relay_sg_id" { type = string }
variable "ecs_execution_role_arn" { type = string }
variable "ecs_task_role_arn" { type = string }
variable "web_log_group" { type = string }
variable "relay_log_group" { type = string }
variable "web_image" { type = string }
variable "relay_image" { type = string }
variable "web_cpu" { type = number }
variable "web_memory" { type = number }
variable "relay_cpu" { type = number }
variable "relay_memory" { type = number }
variable "relay_desired_count" { type = number }
variable "redis_url_param" { type = string }
variable "redis_auth_param" { type = string }
variable "relay_token_param" { type = string }

# --- Cluster ---
resource "aws_ecs_cluster" "main" {
  name = "${var.project}-${var.environment}-cluster"
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# --- Target groups ---
resource "aws_lb_target_group" "web" {
  name        = "${var.project}-${var.environment}-web-tg"
  port        = 80
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"
  health_check {
    path                = "/"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }
}

# Relay target group: /readyz health check; long idle timeout for WebSockets.
resource "aws_lb_target_group" "relay" {
  name        = "${var.project}-${var.environment}-relay-tg"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"
  # WS needs a long idle timeout; ALB max is 4000s. Reads/writes are close to live.
  # Keep well under the relay heartbeat so ALB never kills an idle WS.
  deregistration_delay = 60
  health_check {
    path                = "/readyz"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }
  tags = { Name = "${var.project}-${var.environment}-relay-tg" }
}

# --- Web task ---
resource "aws_ecs_task_definition" "web" {
  family                   = "${var.project}-${var.environment}-web"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.web_cpu
  memory                   = var.web_memory
  execution_role_arn       = var.ecs_execution_role_arn
  task_role_arn            = var.ecs_task_role_arn
  container_definitions = jsonencode([{
    name  = "web"
    image = var.web_image
    essential = true
    portMappings = [{ containerPort = 80, protocol = "tcp" }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = var.web_log_group
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "web"
      }
    }
  }])
}

# --- Relay task ---
resource "aws_ecs_task_definition" "relay" {
  family                   = "${var.project}-${var.environment}-relay"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.relay_cpu
  memory                   = var.relay_memory
  execution_role_arn       = var.ecs_execution_role_arn
  task_role_arn            = var.ecs_task_role_arn
  container_definitions = jsonencode([{
    name  = "relay"
    image = var.relay_image
    essential = true
    portMappings = [{ containerPort = 8080, protocol = "tcp" }]
    # NOTE: distroless runtime has no shell/wget, so ECS-level container health
    # checks are omitted; the ALB target group /readyz check is the source of
    # truth for readiness.
    environment = [
      { name = "ADDR", value = ":8080" },
    ]
    secrets = [
      { name = "REDIS_URL", valueFrom = var.redis_url_param },
      { name = "REDIS_PASSWORD", valueFrom = var.redis_auth_param },
      { name = "RELAY_TOKEN", valueFrom = var.relay_token_param },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = var.relay_log_group
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "relay"
      }
    }
  }])
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
}

# --- Services (rolling deployments) ---
resource "aws_ecs_service" "web" {
  name            = "${var.project}-${var.environment}-web"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = 1
  launch_type     = "FARGATE"
  platform_version = "LATEST"
  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.web_sg_id]
    assign_public_ip = false
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 80
  }
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  lifecycle { ignore_changes = [task_definition, desired_count] }
}

resource "aws_ecs_service" "relay" {
  name            = "${var.project}-${var.environment}-relay"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.relay.arn
  desired_count   = var.relay_desired_count
  launch_type     = "FARGATE"
  platform_version = "LATEST"
  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.relay_sg_id]
    assign_public_ip = false
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.relay.arn
    container_name   = "relay"
    container_port   = 8080
  }
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  lifecycle { ignore_changes = [task_definition, desired_count] }
}

output "web_target_arn" { value = aws_lb_target_group.web.arn }
output "relay_target_arn" { value = aws_lb_target_group.relay.arn }
output "web_service" { value = aws_ecs_service.web.name }
output "relay_service" { value = aws_ecs_service.relay.name }
