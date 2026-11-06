{{- define "osusume.labels" -}}
app.kubernetes.io/name: osusume
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "osusume.selector" -}}
app.kubernetes.io/name: osusume
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{- define "osusume.secretName" -}}
{{ .Release.Name }}-secrets
{{- end }}

{{- define "osusume.apiImage" -}}
{{ .Values.image.api.repository }}:{{ .Values.image.api.tag }}
{{- end }}

{{- define "osusume.nonRootPod" -}}
runAsNonRoot: true
runAsUser: {{ .uid }}
runAsGroup: {{ .uid }}
fsGroup: {{ .uid }}
{{- end }}

{{- define "osusume.nonRootContainer" -}}
allowPrivilegeEscalation: false
capabilities:
  drop: [ALL]
{{- end }}

{{- define "osusume.databaseUrlEnv" -}}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "osusume.secretName" . }}
      key: DATABASE_URL
{{- end }}
