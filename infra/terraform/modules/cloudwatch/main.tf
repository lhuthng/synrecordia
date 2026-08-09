variable "project" { type = string }
variable "environment" { type = string }

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${var.project}-${var.environment}-web"
  retention_in_days = 30
  tags              = { Name = "${var.project}-${var.environment}-web-logs" }
}

resource "aws_cloudwatch_log_group" "relay" {
  name              = "/ecs/${var.project}-${var.environment}-relay"
  retention_in_days = 30
  tags              = { Name = "${var.project}-${var.environment}-relay-logs" }
}

output "web_log_group" { value = aws_cloudwatch_log_group.web.name }
output "relay_log_group" { value = aws_cloudwatch_log_group.relay.name }
