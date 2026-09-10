package extractk8s

import (
	"sort"

	"github.com/shortlink-org/portolan/catalog"
)

// workload is one thing that runs: a Deployment, StatefulSet, DaemonSet,
// ReplicaSet, Job or CronJob, with the labels its pods carry - which is how a
// Service selects it - and the values its containers are configured with.
//
// The values are held only until extract has looked at each one for a host,
// and never leave this package.
type workload struct {
	object
	podLabels map[string]string
	values    []string
	kind      catalog.ComponentKind
}

var workloadKinds = map[string]catalog.ComponentKind{
	"Deployment":  "",
	"StatefulSet": "",
	"DaemonSet":   "",
	"ReplicaSet":  "",
	"Job":         catalog.ComponentKindJob,
	"CronJob":     catalog.ComponentKindJob,
}

// configMaps is what the tree's ConfigMaps say, keyed by namespace/name, so
// that an env entry reading a key of one can be followed to its value. Only
// `data` is read: `binaryData` is bytes, and no host was ever written in
// base64 on purpose.
func configMaps(objects []object) map[string]map[string]string {
	out := map[string]map[string]string{}
	for _, o := range objects {
		if o.kind != "ConfigMap" {
			continue
		}
		key := o.namespace + "/" + o.name
		data := out[key]
		if data == nil {
			data = map[string]string{}
			out[key] = data
		}
		for k, v := range stringMapAt(o.body, "data") {
			data[k] = v
		}
	}
	return out
}

// workloads folds the tree's workload documents by kind and name - a base
// and the overlays over it are one workload - and gathers each one's pod
// labels and configured values.
func workloads(objects []object, maps map[string]map[string]string) []workload {
	byID := map[string]*workload{}
	var order []string
	for _, o := range objects {
		kind, ok := workloadKinds[o.kind]
		if !ok {
			continue
		}
		w := byID[o.id()]
		if w == nil {
			w = &workload{object: o, podLabels: map[string]string{}, kind: kind}
			byID[o.id()] = w
			order = append(order, o.id())
		}
		template := podTemplate(o)
		for k, v := range stringMapAt(mapAt(template, "metadata"), "labels") {
			w.podLabels[k] = v
		}
		spec := mapAt(template, "spec")
		for _, list := range []string{"initContainers", "containers"} {
			for _, container := range listAt(spec, list) {
				w.values = append(w.values, containerValues(container, o.namespace, maps)...)
			}
		}
	}
	out := make([]workload, 0, len(order))
	for _, id := range order {
		out = append(out, *byID[id])
	}
	return out
}

func podTemplate(o object) map[string]any {
	spec := mapAt(o.body, "spec")
	if o.kind == "CronJob" {
		spec = mapAt(mapAt(spec, "jobTemplate"), "spec")
	}
	return mapAt(spec, "template")
}

// containerValues is every configured value of one container that this
// reader is allowed to look at: a literal `value`, a `configMapKeyRef`
// followed into the tree's ConfigMaps, and everything a `configMapRef` under
// envFrom brings in. A `secretKeyRef` or `secretRef` is not followed - by
// rule, not by chance - and the entry contributes nothing.
func containerValues(container map[string]any, namespace string, maps map[string]map[string]string) []string {
	var out []string
	for _, env := range listAt(container, "env") {
		if value := stringAt(env, "value"); value != "" {
			out = append(out, value)
			continue
		}
		ref := mapAt(mapAt(env, "valueFrom"), "configMapKeyRef")
		if ref == nil {
			continue
		}
		if data := maps[namespace+"/"+stringAt(ref, "name")]; data != nil {
			if value, ok := data[stringAt(ref, "key")]; ok {
				out = append(out, value)
			}
		}
	}
	for _, from := range listAt(container, "envFrom") {
		ref := mapAt(from, "configMapRef")
		if ref == nil {
			continue
		}
		data := maps[namespace+"/"+stringAt(ref, "name")]
		keys := make([]string, 0, len(data))
		for k := range data {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			out = append(out, data[k])
		}
	}
	return out
}
