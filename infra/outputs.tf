output "resource_group" {
  value = azurerm_resource_group.main.name
}

output "aks_name" {
  value = azurerm_kubernetes_cluster.main.name
}

output "acr_name" {
  value = azurerm_container_registry.acr.name
}

output "acr_login_server" {
  value = azurerm_container_registry.acr.login_server
}

output "mysql_server_name" {
  value = azurerm_mysql_flexible_server.main.name
}

output "mysql_fqdn" {
  value = azurerm_mysql_flexible_server.main.fqdn
}

output "mysql_admin_username" {
  value = var.mysql_admin_username
}

output "mysql_admin_password" {
  value     = random_password.mysql.result
  sensitive = true # hidden in normal output; read with: terraform output -raw mysql_admin_password
}
