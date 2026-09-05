package main

import (
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

// renderModules gives schema registries a first-class place in the generated
// documentation. A module is shared by its publisher and every vendored
// consumer, so hiding it inside one service loses the relationship readers
// usually need it for.
func (s *site) renderModules() {
	if len(s.cat.Modules) == 0 {
		return
	}

	const self = "modules/README.md"
	var b strings.Builder
	b.WriteString("# Schema modules\n\n")
	b.WriteString(s.stamp() + "\n")
	rows := make([][]string, 0, len(s.cat.Modules))
	for i := range s.cat.Modules {
		module := &s.cat.Modules[i]
		rows = append(rows, []string{
			s.ref(self, module.ID, orDefault(module.Name, module.ID)),
			s.ref(self, module.Owner, module.Owner),
			module.Registry,
			module.Commit,
			plural(len(module.Packages), "package"),
		})
	}
	b.WriteString(table([]string{"Module", "Publisher", "Registry", "Commit", "Packages"}, rows))
	s.b.file(self, b.String())

	for i := range s.cat.Modules {
		s.renderModule(&s.cat.Modules[i])
	}
}

func (s *site) renderModule(module *catalog.ProtoModule) {
	self := s.pathOf[module.ID]
	owner := s.services[module.Owner]
	var b strings.Builder
	b.WriteString("# " + orDefault(module.Name, module.ID) + "\n\n")
	b.WriteString(s.stamp() + "\n")
	b.WriteString(defList([][]string{
		{"Id", code(module.ID)},
		{"Registry", module.Registry},
		{"Publisher", s.ref(self, module.Owner, module.Owner)},
		{"Commit", code(module.Commit)},
		{"Digest", code(module.Digest)},
		{"Source", s.source(self, module.Source, owner)},
	}))

	packages := make([][]string, 0, len(module.Packages))
	for _, pkg := range module.Packages {
		packages = append(packages, []string{code(pkg)})
	}
	section(&b, "Packages", table([]string{"Package"}, packages))

	files := make([][]string, 0, len(module.Files))
	for _, file := range module.Files {
		files = append(files, []string{s.source(self, file, owner)})
	}
	section(&b, "Files", table([]string{"File"}, files))

	deps := make([][]string, 0, len(module.Deps))
	for _, id := range module.Deps {
		deps = append(deps, []string{s.ref(self, id, id)})
	}
	section(&b, "Dependencies", table([]string{"Module"}, deps))

	users := make([][]string, 0)
	for i := range s.cat.Contexts {
		for j := range s.cat.Contexts[i].Services {
			svc := &s.cat.Contexts[i].Services[j]
			for _, id := range svc.Modules {
				if id != module.ID {
					continue
				}
				access := "reads"
				if svc.ID == module.Owner {
					access = "publishes"
				}
				users = append(users, []string{s.ref(self, svc.ID, svc.Name), access})
			}
		}
	}
	section(&b, "Used by", table([]string{"Service", "Access"}, users))

	var interfaces strings.Builder
	for i := range s.cat.Contexts {
		for j := range s.cat.Contexts[i].Services {
			svc := &s.cat.Contexts[i].Services[j]
			for k := range svc.Provides {
				provided := &svc.Provides[k]
				if provided.Module == module.ID {
					interfaces.WriteString(s.providesBlock(self, []catalog.RpcService{*provided}, svc))
				}
			}
		}
	}
	section(&b, "Interfaces", interfaces.String())

	s.b.file(self, b.String())
}
