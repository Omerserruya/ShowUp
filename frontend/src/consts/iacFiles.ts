export const providerTfContent = `provider "aws" {
    region = var.region
    access_key = var.aws_access_key  
    secret_key = var.aws_secret_key  
  }`;


export const variablesTfContent = `variable "region" {
    default = "us-east-1"
  }
  
  variable "aws_access_key" {
    description = "AWS access key"
    type        = string
  }
  
  variable "aws_secret_key" {
    description = "AWS secret key"
    type        = string
  }`;

export const tfvarsContent = `region        = "us-east-1"
aws_access_key = "YOUR_ACCESS_KEY"
aws_secret_key = "YOUR_SECRET_KEY"`;