terraform {
  required_version = ">= 1.8, < 2.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}
provider "aws" { region = "us-east-2" }
variable "name" { type = string }
variable "vpc_id" { type = string }
variable "subnet_id" { type = string }
variable "ami_id" { type = string }
variable "release_bucket" { type = string }
variable "release_key" { type = string }
variable "release_sha256" {
  type = string
  validation {
    condition = can(regex("^[0-9a-f]{64}$", var.release_sha256))
    error_message = "An immutable, verified runner release hash is required."
  }
}
variable "verified_total_infrastructure_usd" {
  type = number
  validation {
    condition = var.verified_total_infrastructure_usd > 0 && var.verified_total_infrastructure_usd <= 35
    error_message = "Verify regional EC2, EBS, IPv4, S3, egress and tracing charges within the $35 reservation before provisioning."
  }
}
variable "lifetime_minutes" {
  type = number
  default = 360
  validation {
    condition = var.lifetime_minutes >= 15 && var.lifetime_minutes <= 1440
    error_message = "The ephemeral research runner must stop within 24 hours."
  }
}
resource "aws_security_group" "runner" {
  name_prefix = "${var.name}-"
  vpc_id = var.vpc_id
  # No ingress. Administration uses SSM; database and runtime bind locally.
  egress {
    from_port = 443
    to_port = 443
    protocol = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { GoalSpec = var.name }
}
resource "aws_s3_bucket" "artifacts" {
  bucket_prefix = "${var.name}-"
  force_destroy = false
  tags = { GoalSpec = var.name }
}
resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  block_public_acls = true
  block_public_policy = true
  ignore_public_acls = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  rule { apply_server_side_encryption_by_default { sse_algorithm = "AES256" } }
}
resource "aws_iam_role" "runner" {
  name_prefix = "${var.name}-"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_iam_role_policy_attachment" "ssm" {
  role = aws_iam_role.runner.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}
resource "aws_iam_role_policy" "artifacts" {
  role = aws_iam_role.runner.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["s3:GetObject"], Resource = "arn:aws:s3:::${var.release_bucket}/${var.release_key}" },
    { Effect = "Allow", Action = ["s3:PutObject", "s3:GetObject"], Resource = "${aws_s3_bucket.artifacts.arn}/*" },
    { Effect = "Allow", Action = ["ec2:TerminateInstances"], Resource = "arn:aws:ec2:us-east-2:*:instance/*", Condition = { StringEquals = { "ec2:ResourceTag/GoalSpec" = var.name } } }
  ] })
}
resource "aws_iam_instance_profile" "runner" { role = aws_iam_role.runner.name }
resource "aws_instance" "runner" {
  ami = var.ami_id
  instance_type = "t3a.xlarge"
  subnet_id = var.subnet_id
  associate_public_ip_address = true
  vpc_security_group_ids = [aws_security_group.runner.id]
  iam_instance_profile = aws_iam_instance_profile.runner.name
  instance_initiated_shutdown_behavior = "stop"
  metadata_options { http_tokens = "required" }
  root_block_device {
    volume_size = 100
    volume_type = "gp3"
    encrypted = true
    delete_on_termination = true
  }
  user_data = templatefile("${path.module}/runner.sh.tftpl", {
    lifetime_minutes = var.lifetime_minutes, release_bucket = var.release_bucket,
    release_key = var.release_key, release_sha256 = var.release_sha256,
    artifact_bucket = aws_s3_bucket.artifacts.id
  })
  tags = { GoalSpec = var.name, LifetimeMinutes = tostring(var.lifetime_minutes) }
}
output "artifact_bucket" { value = aws_s3_bucket.artifacts.id }
output "instance_id" { value = aws_instance.runner.id }
