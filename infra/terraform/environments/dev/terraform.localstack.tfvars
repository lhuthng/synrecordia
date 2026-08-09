# LocalStack test configuration (NOT for real AWS).
# Usage (from this dev/ directory):
#   terraform init        (backend is local; see backend.tf)
#   terraform plan  -var-file=terraform.localstack.tfvars
#   terraform apply -var-file=terraform.localstack.tfvars
region       = "eu-central-1"
aws_endpoint = "http://localhost:4566"
environment  = "local"

# Dummy secret values for LocalStack (never real).
redis_url   = "localhost:6379"
redis_auth  = "localstack-redis-auth"
relay_token = "localstack-relay-token"
github_repo = "synrecordia/synrecordia"
