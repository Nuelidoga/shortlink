{{/* Labels shared by every resource in the chart */}}
{{- define "shortlink.labels" -}}
app.kubernetes.io/part-of: shortlink
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Values.image.tag | quote }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{/* Pod security settings shared by both deployments */}}
{{- define "shortlink.containerSecurity" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: ["ALL"]
{{- end -}}
