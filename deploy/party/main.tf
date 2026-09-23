terraform {
  required_version = ">= 1.6"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 6.0" }
  }
}

variable "project_id" { type = string }
variable "region" { type = string }
variable "service_url" { type = string }
variable "runtime_service_account" { type = string }
variable "cloud_run_service" { type = string }
variable "scheduler_region" {
  type        = string
  description = "Cloud Scheduler-supported region; need not match Cloud Run."
}

provider "google" {
  project = var.project_id
  region  = var.region
}
data "google_project" "current" {}

resource "google_project_service" "tasks" {
  service            = "cloudtasks.googleapis.com"
  disable_on_destroy = false
}
resource "google_project_service" "scheduler" {
  service            = "cloudscheduler.googleapis.com"
  disable_on_destroy = false
}
resource "google_service_account" "party_tasks" {
  account_id   = "brewtify-party-tasks"
  display_name = "Brewtify Party internal task identity"
}
resource "google_cloud_tasks_queue" "party" {
  name       = "brewtify-party"
  location   = var.region
  depends_on = [google_project_service.tasks]
  rate_limits {
    max_concurrent_dispatches = 5
    max_dispatches_per_second = 5
  }
  retry_config {
    max_attempts       = 8
    min_backoff        = "5s"
    max_backoff        = "120s"
    max_doublings      = 4
    max_retry_duration = "1800s"
  }
}
resource "google_cloud_tasks_queue_iam_member" "enqueue" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_tasks_queue.party.name
  role     = "roles/cloudtasks.enqueuer"
  member   = "serviceAccount:${var.runtime_service_account}"
}
resource "google_service_account_iam_member" "act_as" {
  service_account_id = google_service_account.party_tasks.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${var.runtime_service_account}"
}
resource "google_service_account_iam_member" "tasks_token" {
  service_account_id = google_service_account.party_tasks.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-cloudtasks.iam.gserviceaccount.com"
  depends_on         = [google_project_service.tasks]
}
resource "google_service_account_iam_member" "scheduler_token" {
  service_account_id = google_service_account.party_tasks.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-cloudscheduler.iam.gserviceaccount.com"
  depends_on         = [google_project_service.scheduler]
}
resource "google_cloud_run_service_iam_member" "invoker" {
  project  = var.project_id
  location = var.region
  service  = var.cloud_run_service
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.party_tasks.email}"
}
resource "google_cloud_scheduler_job" "maintenance" {
  name             = "brewtify-party-maintenance"
  region           = var.scheduler_region
  schedule         = "* * * * *"
  time_zone        = "Etc/UTC"
  paused           = true
  depends_on       = [google_project_service.scheduler]
  attempt_deadline = "180s"
  retry_config {
    retry_count          = 3
    min_backoff_duration = "5s"
    max_backoff_duration = "60s"
  }
  http_target {
    uri         = "${var.service_url}/internal/party/maintenance"
    http_method = "POST"
    headers     = { "Content-Type" = "application/json" }
    body        = base64encode("{}")
    oidc_token {
      service_account_email = google_service_account.party_tasks.email
      audience              = var.service_url
    }
  }
}

# Cloud Run's request log otherwise stores full callback and launch query strings.
# Audit any additional log sinks/proxies separately before enabling real traffic.
resource "google_logging_project_exclusion" "party_capabilities" {
  name        = "brewtify-party-capability-urls"
  description = "Do not retain OAuth or Telegram launch capabilities in request URLs."
  filter      = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${var.cloud_run_service}\" AND (httpRequest.requestUrl:\"/api/party/auth/\" OR httpRequest.requestUrl:\"/app?\")"
}

output "party_environment" {
  value = {
    PARTY_ENABLED               = "false"
    PARTY_PUBLIC_ORIGIN         = var.service_url
    PARTY_SPOTIFY_REDIRECT_URI  = "${var.service_url}/api/party/auth/callback"
    PARTY_TASKS_PROJECT         = var.project_id
    PARTY_TASKS_LOCATION        = var.region
    PARTY_TASKS_QUEUE           = google_cloud_tasks_queue.party.name
    PARTY_TASKS_SERVICE_ACCOUNT = google_service_account.party_tasks.email
    PARTY_TASKS_AUDIENCE        = var.service_url
  }
}
