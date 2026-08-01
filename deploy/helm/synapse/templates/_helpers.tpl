{{/*
SYNAPSE Helm helpers — doc 33 §11 / ADR-007. Standard name/label/selector helpers.
*/}}

{{/* Chart base name (nameOverride wins), max 63 chars for label safety. */}}
{{- define "synapse.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Fully-qualified release name. */}}
{{- define "synapse.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/* chart name+version label value. */}}
{{- define "synapse.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Common labels applied to every object. */}}
{{- define "synapse.labels" -}}
helm.sh/chart: {{ include "synapse.chart" . }}
{{ include "synapse.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: synapse
synapse.io/edition: {{ .Values.edition.code | quote }}
{{- end -}}

{{/* Immutable selector labels (name + instance). Do NOT add version/edition here. */}}
{{- define "synapse.selectorLabels" -}}
app.kubernetes.io/name: {{ include "synapse.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* Resolved image reference (image.tag falls back to appVersion). */}}
{{- define "synapse.image" -}}
{{- $tag := default .Chart.AppVersion .Values.image.tag -}}
{{- printf "%s:%s" .Values.image.repository $tag -}}
{{- end -}}

{{/* Secret name (existingSecret wins). */}}
{{- define "synapse.secretName" -}}
{{- if .Values.existingSecret -}}
{{- .Values.existingSecret -}}
{{- else -}}
{{- include "synapse.fullname" . -}}
{{- end -}}
{{- end -}}

{{/* ServiceAccount name. */}}
{{- define "synapse.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "synapse.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}
