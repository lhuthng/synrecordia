variable "project" { type = string }
variable "environment" { type = string }
variable "vpc_id" { type = string }

# --- ALB SG: ingress 443 from anywhere, egress to web/relay SGs ---
resource "aws_security_group" "alb" {
  name_prefix = "${var.project}-${var.environment}-alb-"
  vpc_id      = var.vpc_id
  description = "ALB: HTTPS ingress"
  tags        = { Name = "${var.project}-${var.environment}-alb-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "alb_egress_web" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.web.id
  ip_protocol                  = "-1"
}

resource "aws_vpc_security_group_egress_rule" "alb_egress_relay" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.relay.id
  ip_protocol                  = "-1"
}

# --- Web SG: ingress from ALB only ---
resource "aws_security_group" "web" {
  name_prefix = "${var.project}-${var.environment}-web-"
  vpc_id      = var.vpc_id
  description = "Web (nginx) task SG"
  tags        = { Name = "${var.project}-${var.environment}-web-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "web_from_alb" {
  security_group_id            = aws_security_group.web.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "-1"
}

# --- Relay SG: ingress from ALB only (WS + API), egress to Redis via redis SG ---
resource "aws_security_group" "relay" {
  name_prefix = "${var.project}-${var.environment}-relay-"
  vpc_id      = var.vpc_id
  description = "Relay (Go WS/API) task SG"
  tags        = { Name = "${var.project}-${var.environment}-relay-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "relay_from_alb" {
  security_group_id            = aws_security_group.relay.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "-1"
}

resource "aws_vpc_security_group_egress_rule" "relay_egress" {
  security_group_id = aws_security_group.relay.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

output "alb_sg_id" { value = aws_security_group.alb.id }
output "web_sg_id" { value = aws_security_group.web.id }
output "relay_sg_id" { value = aws_security_group.relay.id }
