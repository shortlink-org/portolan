package extractk8s

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func write(t *testing.T, root, name, contents string) {
	t.Helper()
	path := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
}

func extracted(t *testing.T, root string, opts Options) (catalog.Service, plugin.Response) {
	t.Helper()
	if opts.Context == "" {
		opts.Context = "shop"
	}
	if opts.Service == "" {
		opts.Service = "pricing"
	}
	resp, err := extract(plugin.Input{Root: root}, opts)
	if err != nil {
		t.Fatal(err)
	}
	var out catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &out); err != nil {
		t.Fatal(err)
	}
	return out.Contexts[0].Services[0], resp
}

func warnings(resp plugin.Response) []string {
	var out []string
	for _, warning := range resp.Warnings() {
		out = append(out, warning.Ref+": "+warning.Message)
	}
	return out
}

const pricingDeployment = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: pricing
  namespace: shop
spec:
  selector:
    matchLabels:
      app: pricing
  template:
    metadata:
      labels:
        app: pricing
        tier: backend
    spec:
      containers:
        - name: pricing
          image: ghcr.io/acme/pricing:1.4.2
          env:
            - name: CART_URL
              value: http://cart.shop.svc:8080/api
            - name: LEDGER_DSN
              value: postgres://pricing:hunter2@ledger-db.payments.svc:5432/ledger?sslmode=disable
            - name: LOG_LEVEL
              value: info
            - name: DB_PASSWORD
              value: s3cr3t-password
            - name: FEATURE_FLAGS
              value: "true"
            - name: AUTH_URL
              value: http://auth:9000
            - name: OMS_URL
              valueFrom:
                configMapKeyRef:
                  name: pricing-config
                  key: OMS_URL
            - name: API_TOKEN
              valueFrom:
                secretKeyRef:
                  name: pricing-secrets
                  key: token
          envFrom:
            - configMapRef:
                name: pricing-shared
            - secretRef:
                name: pricing-secrets
`

const pricingNetwork = `apiVersion: v1
kind: Service
metadata:
  name: pricing
  namespace: shop
spec:
  selector:
    app: pricing
  ports:
    - port: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: auth
  namespace: shop
spec:
  selector:
    app: auth
  ports:
    - port: 9000
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: shop
  namespace: shop
spec:
  rules:
    - host: shop.example.com
      http:
        paths:
          - path: /pricing
            pathType: Prefix
            backend:
              service:
                name: pricing
                port:
                  number: 8080
          - path: /auth
            pathType: Prefix
            backend:
              service:
                name: auth
                port:
                  number: 9000
    - host: admin.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: auth
                port:
                  number: 9000
`

const pricingConfig = `apiVersion: v1
kind: ConfigMap
metadata:
  name: pricing-config
  namespace: shop
data:
  OMS_URL: grpc://oms.shop.svc:9090
  GREETING: hello
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: pricing-shared
  namespace: shop
data:
  CATALOG_URL: https://catalog.shop.svc.cluster.local/v1
  REGION: eu-west-1
---
apiVersion: v1
kind: Secret
metadata:
  name: pricing-secrets
  namespace: shop
type: Opaque
stringData:
  token: tok-abcdef
  EVIL_URL: http://leaked.shop.svc
`

func TestReadsHostsAndDialsAndNothingElse(t *testing.T) {
	root := t.TempDir()
	write(t, root, "deploy/k8s/deployment.yaml", pricingDeployment)
	write(t, root, "deploy/k8s/network.yaml", pricingNetwork)
	write(t, root, "deploy/k8s/config.yaml", pricingConfig)
	write(t, root, "docker-compose.yaml", "services:\n  db:\n    image: postgres\n    environment:\n      POSTGRES_PASSWORD: compose-password\n")

	svc, resp := extracted(t, root, Options{})

	if svc.ID != "shop.pricing" || svc.Slug != "pricing" {
		t.Fatalf("service = %q / %q", svc.ID, svc.Slug)
	}
	if svc.Kind != "" {
		t.Errorf("a Deployment says nothing about kind, got %q", svc.Kind)
	}
	wantHosts := []string{"pricing", "pricing.shop", "pricing.shop.svc", "pricing.shop.svc.cluster.local", "shop.example.com"}
	if !reflect.DeepEqual(svc.Hosts, wantHosts) {
		t.Errorf("hosts = %v, want %v", svc.Hosts, wantHosts)
	}
	wantDials := []string{"auth", "cart.shop.svc", "catalog.shop.svc.cluster.local", "ledger-db.payments.svc", "oms.shop.svc"}
	if !reflect.DeepEqual(svc.Dials, wantDials) {
		t.Errorf("dials = %v, want %v", svc.Dials, wantDials)
	}

	// The fragment and the warnings hold no value from any manifest: not a
	// password, a token, a port, a path, a variable name, a flag or a level.
	everything := resp.Files[0].Contents + strings.Join(warnings(resp), "\n")
	for _, leaked := range []string{
		"hunter2", "s3cr3t", "tok-abcdef", "leaked", "compose-password",
		"8080", "9090", "/api", "sslmode", "pricing:hunter2",
		"CART_URL", "LEDGER_DSN", "OMS_URL", "DB_PASSWORD", "LOG_LEVEL",
		"info", "true", "hello", "eu-west-1", "ghcr.io",
	} {
		if strings.Contains(everything, leaked) {
			t.Errorf("fragment or warnings carry %q:\n%s", leaked, everything)
		}
	}
	if len(resp.Warnings()) != 0 {
		t.Errorf("warnings = %v", warnings(resp))
	}
}

func TestASecretIsNotOpenedEvenWhenItsValueLooksLikeAHost(t *testing.T) {
	root := t.TempDir()
	write(t, root, "deploy.yaml", pricingDeployment+"---\n"+pricingConfig)
	// The Secret above carries EVIL_URL: http://leaked.shop.svc, a value
	// hostOnly would accept by shape. It is not in the dials because the
	// Secret was never decoded, and that is the property under test.
	svc, _ := extracted(t, root, Options{})
	for _, host := range svc.Dials {
		if strings.Contains(host, "leaked") {
			t.Fatalf("a Secret's value reached the fragment: %v", svc.Dials)
		}
	}
	if len(svc.Dials) == 0 {
		t.Fatal("the deployment's own dials should still be read")
	}
}

func TestSecretRefsUnderEnvFromContributeNothing(t *testing.T) {
	root := t.TempDir()
	write(t, root, "deploy.yaml", `apiVersion: apps/v1
kind: Deployment
metadata:
  name: pricing
spec:
  template:
    metadata:
      labels:
        app: pricing
    spec:
      containers:
        - name: pricing
          envFrom:
            - secretRef:
                name: everything
          env:
            - name: X
              valueFrom:
                secretKeyRef:
                  name: everything
                  key: url
---
apiVersion: v1
kind: Secret
metadata:
  name: everything
data:
  url: aHR0cDovL2xlYWtlZC5zaG9wLnN2Yw==
`)
	svc, resp := extracted(t, root, Options{})
	if len(svc.Dials) != 0 || len(resp.Warnings()) != 0 {
		t.Fatalf("dials = %v, warnings = %v", svc.Dials, warnings(resp))
	}
}

func TestHelmTemplatesAreSkippedWithOneWarningPerDirectory(t *testing.T) {
	root := t.TempDir()
	write(t, root, "chart/Chart.yaml", "apiVersion: v2\nname: pricing\nversion: 0.1.0\n")
	write(t, root, "chart/values.yaml", "image: ghcr.io/acme/pricing\npassword: values-password\n")
	write(t, root, "chart/templates/deployment.yaml", "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {{ .Release.Name }}\nspec: {}\n")
	write(t, root, "chart/templates/service.yaml", "apiVersion: v1\nkind: Service\nmetadata:\n  name: {{ .Release.Name }}\n")

	svc, resp := extracted(t, root, Options{})
	if len(svc.Hosts) != 0 || len(svc.Dials) != 0 {
		t.Fatalf("nothing should be read from templates: %v %v", svc.Hosts, svc.Dials)
	}
	got := warnings(resp)
	want := []string{
		"chart/templates: holds templates ({{ … }}), which are not YAML until rendered; nothing under it was read",
		root + ": no Deployment, StatefulSet, DaemonSet, Job or CronJob was found",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("warnings = %q, want %q", got, want)
	}
	if strings.Contains(strings.Join(got, "\n"), "values-password") {
		t.Error("a warning quoted a value")
	}
}

func TestAnOverlayFoldsOntoItsBase(t *testing.T) {
	root := t.TempDir()
	write(t, root, "base/deployment.yaml", `apiVersion: apps/v1
kind: Deployment
metadata:
  name: pricing
spec:
  template:
    metadata:
      labels:
        app: pricing
    spec:
      containers:
        - name: pricing
          env:
            - name: CART_URL
              value: http://cart.shop.svc
`)
	write(t, root, "base/kustomization.yaml", "resources:\n  - deployment.yaml\n")
	write(t, root, "overlays/prod/kustomization.yaml", "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources:\n  - ../../base\npatches:\n  - path: env.yaml\n")
	write(t, root, "overlays/prod/env.yaml", `apiVersion: apps/v1
kind: Deployment
metadata:
  name: pricing
spec:
  template:
    spec:
      containers:
        - name: pricing
          env:
            - name: OMS_URL
              value: http://oms.shop.svc
`)
	svc, resp := extracted(t, root, Options{})
	want := []string{"cart.shop.svc", "oms.shop.svc"}
	if !reflect.DeepEqual(svc.Dials, want) {
		t.Errorf("dials = %v, want %v; warnings %v", svc.Dials, want, warnings(resp))
	}
}

func TestACronJobIsAJobAndFindsItsWorkloadByLabel(t *testing.T) {
	root := t.TempDir()
	write(t, root, "cron.yaml", `apiVersion: batch/v1
kind: CronJob
metadata:
  name: nightly-reprice
  labels:
    app.kubernetes.io/name: pricing
spec:
  schedule: "0 3 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: reprice
              env:
                - name: PRICING_URL
                  value: http://pricing.shop.svc
`)
	svc, _ := extracted(t, root, Options{})
	if svc.Kind != catalog.ComponentKindJob {
		t.Errorf("kind = %q, want job", svc.Kind)
	}
	if !reflect.DeepEqual(svc.Dials, []string{"pricing.shop.svc"}) {
		t.Errorf("dials = %v", svc.Dials)
	}
}

func TestBareNamesQualifyOnlyWhenTheTreeDeclaresThem(t *testing.T) {
	root := t.TempDir()
	write(t, root, "deploy.yaml", `apiVersion: apps/v1
kind: Deployment
metadata:
  name: pricing
spec:
  template:
    metadata:
      labels:
        app: pricing
    spec:
      containers:
        - name: pricing
          env:
            - name: A
              value: cart
            - name: B
              value: cart.shop
            - name: C
              value: example.com
            - name: D
              value: ledger:7000
            - name: E
              value: oms.shop.svc.cluster.local:9090
---
apiVersion: v1
kind: Service
metadata:
  name: ledger
  namespace: payments
spec:
  selector:
    app: ledger
`)
	svc, _ := extracted(t, root, Options{})
	want := []string{"ledger", "oms.shop.svc.cluster.local"}
	if !reflect.DeepEqual(svc.Dials, want) {
		t.Errorf("dials = %v, want %v", svc.Dials, want)
	}
}

func TestNamespaceOptionAndPathsOption(t *testing.T) {
	root := t.TempDir()
	write(t, root, "k8s/staging.yaml", strings.ReplaceAll(pricingDeployment, "namespace: shop", "namespace: staging"))
	write(t, root, "k8s/prod.yaml", pricingDeployment)
	write(t, root, "k8s/network.yaml", pricingNetwork)
	write(t, root, "elsewhere/other.yaml", strings.ReplaceAll(pricingNetwork, "name: pricing", "name: elsewhere"))

	svc, resp := extracted(t, root, Options{Paths: []string{"k8s"}, Namespace: "shop"})
	if len(resp.Warnings()) != 0 {
		t.Fatalf("warnings = %v", warnings(resp))
	}
	for _, host := range svc.Hosts {
		if strings.Contains(host, "elsewhere") || strings.Contains(host, "staging") {
			t.Errorf("read outside paths or namespace: %v", svc.Hosts)
		}
	}
	if len(svc.Hosts) == 0 {
		t.Error("the shop deployment should have hosts")
	}
}

func TestSeveralWorkloadsNoneNamedIsAWarningNotAGuess(t *testing.T) {
	root := t.TempDir()
	write(t, root, "a.yaml", strings.ReplaceAll(pricingDeployment, "pricing", "alpha"))
	write(t, root, "b.yaml", strings.ReplaceAll(pricingDeployment, "pricing", "beta"))
	svc, resp := extracted(t, root, Options{})
	if len(svc.Hosts) != 0 || len(svc.Dials) != 0 {
		t.Fatalf("guessed a workload: %v %v", svc.Hosts, svc.Dials)
	}
	got := warnings(resp)
	if len(got) != 1 || !strings.Contains(got[0], `none of the 2 workloads is named or labelled "pricing"`) {
		t.Errorf("warnings = %q", got)
	}
}

func TestHostOnly(t *testing.T) {
	known := map[string]bool{"auth": true, "auth.shop": true}
	cases := map[string]string{
		"http://cart.shop.svc:8080/api":                     "cart.shop.svc",
		"postgres://u:p@db.payments.svc:5432/x?sslmode=off": "db.payments.svc",
		"HTTPS://Cart.Shop.SVC.cluster.local":               "cart.shop.svc.cluster.local",
		"auth:9000":                                         "auth",
		"auth.shop":                                         "auth.shop",
		"oms.shop.svc.cluster.local":                        "oms.shop.svc.cluster.local",
		"cart":                                              "",
		"example.com":                                       "",
		"https://api.stripe.com/v1":                         "",
		"hunter2":                                           "",
		"true":                                              "",
		"info":                                              "",
		"host=db.shop.svc user=x password=y":                "",
		"":                                                  "",
		"-bad.shop.svc":                                     "",
		"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc": "",
	}
	for value, want := range cases {
		got, ok := hostOnly(value, known)
		if got != want || ok != (want != "") {
			t.Errorf("hostOnly(%q) = %q, %v; want %q", value, got, ok, want)
		}
	}
}
