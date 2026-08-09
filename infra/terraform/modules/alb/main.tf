terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

variable "project" { type = string }
variable "environment" { type = string }
variable "vpc_id" { type = string }
variable "public_subnet_ids" { type = list(string) }
variable "alb_sg_id" { type = string }
variable "domain_name" { type = string }
variable "web_target_arn" { type = string }
variable "relay_target_arn" { type = string }
variable "cloudflare_zone_id" { type = string }

# --- ACM cert (TLS for ALB). DNS-validated; validation CNAME lives at Cloudflare. ---
resource "aws_acm_certificate" "main" {
  domain_name       = var.domain_name
  validation_method = "DNS"
  subject_alternative_names = ["www.${var.domain_name}"]
  lifecycle { create_before_destroy = true }
}

resource "aws_acm_certificate_validation" "main" {
  certificate_arn = aws_acm_certificate.main.arn
  # domain_validation_options fields are flat in provider v5 (no nested resource_record).
  validation_record_fqdns = [for r in aws_acm_certificate.main.domain_validation_options : r.resource_record_name]
}

# Cloudflare DNS: validation CNAME + proxied A/AAAA to the ALB.
resource "cloudflare_record" "validation" {
  for_each = { for d in aws_acm_certificate.main.domain_validation_options : d.domain_name => d }
  zone_id  = var.cloudflare_zone_id
  name     = each.value.resource_record_name
  type     = each.value.resource_record_type
  content  = each.value.resource_record_value
  proxied  = false
  ttl      = 120
}

resource "cloudflare_record" "www" {
  zone_id = var.cloudflare_zone_id
  name    = "www"
  type    = "CNAME"
  content = var.domain_name
  proxied = true
  ttl     = 120
}

# --- ALB ---
resource "aws_lb" "main" {
  name               = "${var.project}-${var.environment}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [var.alb_sg_id]
  subnets            = var.public_subnet_ids
  enable_deletion_protection = false
  tags = { Name = "${var.project}-${var.environment}-alb" }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = aws_acm_certificate_validation.main.certificate_arn
  default_action {
    type = "fixed-response"
    fixed_response {
      status_code  = "404"
      content_type = "text/plain"
      message_body = "Not found"
    }
  }
}

# HTTP -> HTTPS redirect.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      protocol    = "HTTPS"
      port        = "443"
      status_code = "HTTP_301"
    }
  }
}

# --- Path-based routing ---
# / -> web
resource "aws_lb_listener_rule" "web" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10
  action {
    type             = "forward"
    target_group_arn = var.web_target_arn
  }
  condition {
    path_pattern {
      values = ["/"]
    }
  }
}
# /ws* and /api* -> relay (WebSocket must forward to a target group with sticky off, long idle)
resource "aws_lb_listener_rule" "relay" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 20
  action {
    type             = "forward"
    target_group_arn = var.relay_target_arn
  }
  condition {
    path_pattern {
      values = ["/ws/*", "/api/*"]
    }
  }
}

output "alb_dns_name" { value = aws_lb.main.dns_name }
output "alb_zone_id" { value = aws_lb.main.zone_id }
output "alb_arn" { value = aws_lb.main.arn }
output "listener_https_arn" { value = aws_lb_listener.https.arn }

# Alarm when the relay target group reports unhealthy hosts.
resource "aws_cloudwatch_metric_alarm" "relay_unhealthy" {
  alarm_name          = "${var.project}-${var.environment}-relay-unhealthy"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "UnHealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = "60"
  statistic           = "Sum"
  threshold           = "0"
  dimensions          = { TargetGroup = var.relay_target_arn }
  alarm_description   = "Relay target group has unhealthy hosts"
}
