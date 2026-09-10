terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

variable "region" {
  type    = string
  default = "eu-west-1"
}

variable "prefix" {
  type    = string
  default = "fulfillment"
}

variable "opaque_name" {
  type = string
}

locals {
  queue_name = "${var.prefix}-orders"
  tags = {
    service = var.prefix
  }
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.0.0"
  name    = "${var.prefix}-vpc"
}

module "archive" {
  source      = "./modules/archive"
  bucket_name = format("%s-archive", var.prefix)
}
