variable "project" {
  description = "Short project name used in resource names (lowercase letters only)."
  type        = string
  default     = "shortlink"

  validation {
    condition     = can(regex("^[a-z]{3,12}$", var.project))
    error_message = "project must be 3-12 lowercase letters."
  }
}

variable "environment" {
  description = "Environment name, e.g. prod."
  type        = string
  default     = "prod"
}

variable "location" {
  description = "Azure region. Change it if your subscription is not allowed to use this region."
  type        = string
  default     = "northeurope"
}

variable "node_vm_size" {
  description = "VM size for the AKS node. Needs about 8 GB RAM for the app + Argo CD + Prometheus + Grafana."
  type        = string
  default     = "Standard_B2ms" # 2 vCPU, 8 GB RAM, burstable (cheap)
}

variable "node_count" {
  description = "Number of AKS nodes."
  type        = number
  default     = 1
}

variable "mysql_admin_username" {
  description = "Administrator username for the MySQL server."
  type        = string
  default     = "shortlinkadmin"
}
