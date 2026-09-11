package extractargocd

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

// extracted runs the extractor the way the host does: the repository is the
// workspace, and the input root is a directory inside it.
func extracted(t *testing.T, repo, root string, opts Options) ([]catalog.Deployment, []string) {
	t.Helper()
	resp, err := extract(plugin.Input{Root: filepath.Join(repo, root)}, opts, repo)
	if err != nil {
		t.Fatal(err)
	}
	var out catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &out); err != nil {
		t.Fatal(err)
	}
	var warnings []string
	for _, w := range resp.Warnings() {
		warnings = append(warnings, w.Message)
	}
	return out.Deployments, warnings
}

const shopAppSet = `apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: shop
  namespace: argocd
spec:
  goTemplate: true
  goTemplateOptions: ["missingkey=error"]
  generators:
    - matrix:
        generators:
          - git:
              repoURL: https://github.com/acme/gitops.git
              revision: main
              files:
                - path: gitops/envs/*/cluster.yaml
          - git:
              repoURL: https://github.com/acme/gitops.git
              revision: main
              directories:
                - path: "gitops/envs/{{.env}}/shop/*"
                - path: "gitops/envs/{{.env}}/shop/_draft"
                  exclude: true
  template:
    metadata:
      name: "shop-{{.path.basename}}-{{.env}}"
      labels:
        app.kubernetes.io/part-of: shop
        app.kubernetes.io/name: "{{.path.basename}}"
        env: "{{.env}}"
    spec:
      project: shop
      source:
        repoURL: https://github.com/acme/gitops.git
        targetRevision: main
        path: "{{.path.path}}"
      destination:
        name: "{{.cluster.name}}"
        namespace: shop
`

func TestExpandsAMatrixOfFilesAndDirectoriesAgainstTheTree(t *testing.T) {
	repo := t.TempDir()
	write(t, repo, "gitops/appsets/shop.yaml", shopAppSet)
	write(t, repo, "gitops/envs/prod/cluster.yaml", "env: prod\ncluster:\n  name: in-cluster\n  server: https://kubernetes.default.svc\n")
	write(t, repo, "gitops/envs/staging/cluster.yaml", "env: staging\ncluster:\n  name: staging-eu\n")
	write(t, repo, "gitops/envs/prod/shop/cart/kustomization.yaml", "resources:\n  - ../../../../../shop/cart\nimages:\n  - name: ghcr.io/acme/cart\n    newTag: 2.1.0\n")
	write(t, repo, "gitops/envs/prod/shop/pricing/kustomization.yaml", "resources:\n  - base\nimages:\n  - name: pricing\n    newName: ghcr.io/acme/pricing\n    digest: sha256:abc\n  - name: untouched\n")
	write(t, repo, "gitops/envs/prod/shop/_draft/kustomization.yaml", "resources: []\n")
	write(t, repo, "gitops/envs/staging/shop/cart/kustomization.yaml", "resources:\n  - base\n")

	got, warnings := extracted(t, repo, "gitops", Options{Repo: "github.com/acme/gitops"})
	if len(warnings) != 0 {
		t.Fatalf("unexpected warnings: %v", warnings)
	}
	want := []catalog.Deployment{
		{ID: "argocd/shop-cart-prod", Name: "shop-cart-prod", Project: "shop", Environment: "prod", Cluster: "in-cluster", Namespace: "shop", Repo: "github.com/acme/gitops", Path: "gitops/envs/prod/shop/cart", TargetRevision: "main", Tool: "kustomize", Service: "shop.cart", Images: []string{"ghcr.io/acme/cart:2.1.0"}, Basis: "manifest"},
		{ID: "argocd/shop-cart-staging", Name: "shop-cart-staging", Project: "shop", Environment: "staging", Cluster: "staging-eu", Namespace: "shop", Repo: "github.com/acme/gitops", Path: "gitops/envs/staging/shop/cart", TargetRevision: "main", Tool: "kustomize", Service: "shop.cart", Basis: "manifest"},
		{ID: "argocd/shop-pricing-prod", Name: "shop-pricing-prod", Project: "shop", Environment: "prod", Cluster: "in-cluster", Namespace: "shop", Repo: "github.com/acme/gitops", Path: "gitops/envs/prod/shop/pricing", TargetRevision: "main", Tool: "kustomize", Service: "shop.pricing", Images: []string{"ghcr.io/acme/pricing@sha256:abc"}, Basis: "manifest"},
	}
	if !reflect.DeepEqual(got, want) {
		gotJSON, _ := json.MarshalIndent(got, "", "  ")
		wantJSON, _ := json.MarshalIndent(want, "", "  ")
		t.Fatalf("deployments differ\ngot:\n%s\nwant:\n%s", gotJSON, wantJSON)
	}
}

func TestReadsAListGeneratorAPlainApplicationAndFasttemplateSyntax(t *testing.T) {
	repo := t.TempDir()
	write(t, repo, "gitops/platform.yaml", `apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: platform
  namespace: argocd
spec:
  generators:
    - list:
        elements:
          - name: grafana
            chart: grafana
            version: 8.5.1
  template:
    metadata:
      name: 'platform-{{name}}'
      labels:
        app.kubernetes.io/part-of: platform
        app.kubernetes.io/name: '{{name}}'
    spec:
      project: platform
      sources:
        - repoURL: https://grafana.github.io/helm-charts
          chart: '{{chart}}'
          targetRevision: '{{version}}'
          helm:
            valueFiles: ['$values/platform/{{name}}/values.yaml']
        - repoURL: git@github.com:acme/gitops.git
          targetRevision: main
          ref: values
      destination:
        server: https://kubernetes.default.svc
        namespace: monitoring
---
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: root
  namespace: argocd
spec:
  project: default
  source:
    repoURL: git@github.com:acme/gitops.git
    targetRevision: HEAD
    path: ./gitops/bootstrap/
    directory:
      recurse: true
  destination:
    server: https://kubernetes.default.svc
    namespace: argocd
`)
	got, warnings := extracted(t, repo, "gitops", Options{})
	if len(warnings) != 0 {
		t.Fatalf("unexpected warnings: %v", warnings)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 deployments, got %d", len(got))
	}
	grafana, root := got[0], got[1]
	if grafana.ID != "argocd/platform-grafana" || grafana.Chart != "grafana" || grafana.TargetRevision != "8.5.1" || grafana.Tool != "helm" || grafana.Service != "platform.grafana" || grafana.Repo != "grafana.github.io/helm-charts" || grafana.Environment != "in-cluster" {
		t.Errorf("grafana read wrong: %+v", grafana)
	}
	if root.ID != "argocd/root" || root.Path != "gitops/bootstrap" || root.Tool != "directory" || root.Repo != "github.com/acme/gitops" || root.Service != "" || root.Project != "default" {
		t.Errorf("root read wrong: %+v", root)
	}
}

func TestWarnsForWhatATreeCannotAnswer(t *testing.T) {
	repo := t.TempDir()
	write(t, repo, "gitops/clusters.yaml", `apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: addons
spec:
  goTemplate: true
  generators:
    - clusters: {}
    - git:
        repoURL: https://github.com/acme/other.git
        directories:
          - path: apps/*
  template:
    metadata:
      name: 'addons-{{.name}}'
    spec:
      project: default
      source:
        repoURL: https://github.com/acme/other.git
        path: addons
      destination:
        server: '{{.server}}'
        namespace: addons
`)
	write(t, repo, "gitops/broken.yaml", "kind: Application\napiVersion: argoproj.io/v1alpha1\nmetadata: {name: [\n")
	got, warnings := extracted(t, repo, "gitops", Options{Repo: "github.com/acme/gitops"})
	if len(got) != 0 {
		t.Fatalf("nothing should be declared, got %+v", got)
	}
	joined := strings.Join(warnings, "\n")
	for _, want := range []string{"cluster generator is not read", "github.com/acme/other, which is not this repository", "could not be parsed as YAML", "no Application or ApplicationSet was found"} {
		if !strings.Contains(joined, want) {
			t.Errorf("no warning saying %q in:\n%s", want, joined)
		}
	}
}

func TestReadsTheExampleGitopsTreeOfThisRepository(t *testing.T) {
	repo := filepath.Join("..", "..")
	got, warnings := extracted(t, repo, "examples/gitops", Options{Repo: "github.com/shortlink-org/portolan"})
	if len(warnings) != 0 {
		t.Fatalf("unexpected warnings: %v", warnings)
	}
	var ids []string
	for _, d := range got {
		ids = append(ids, d.ID)
	}
	want := []string{"argocd/platform-grafana", "argocd/platform-ingress-nginx", "argocd/root", "argocd/shop-cart-prod", "argocd/shop-cart-staging", "argocd/shop-pricing-prod"}
	if !reflect.DeepEqual(ids, want) {
		t.Fatalf("ids differ: got %v want %v", ids, want)
	}
	for _, d := range got {
		if strings.HasPrefix(d.Name, "shop-") && (d.Service == "" || d.Tool != "kustomize" || len(d.Images) != 1) {
			t.Errorf("%s should be placed by label, rendered by kustomize and pin one image: %+v", d.ID, d)
		}
	}
}
