package sim

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// parseNonTest parses the non-test Go files of a directory.
func parseNonTest(t *testing.T, dir string) map[string]*ast.File {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	files := map[string]*ast.File{}
	fset := token.NewFileSet()
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		f, err := parser.ParseFile(fset, filepath.Join(dir, name), nil, parser.SkipObjectResolution)
		if err != nil {
			t.Fatal(err)
		}
		files[filepath.Join(dir, name)] = f
	}
	return files
}

func simDir(t *testing.T) string {
	return filepath.Join(repoRoot(t), "server", "internal", "sim")
}

// pureFiles are the non-test files of the pure packages: the simulation
// and its archipelago generator (D-053).
func pureFiles(t *testing.T) map[string]*ast.File {
	t.Helper()
	files := parseNonTest(t, simDir(t))
	for path, f := range parseNonTest(t, filepath.Join(simDir(t), "archipelago")) {
		files[path] = f
	}
	return files
}

// TestPurity enforces that the simulation package and the archipelago
// generator perform no I/O, read no clock, use no randomness and do not
// log.
func TestPurity(t *testing.T) {
	forbidden := []string{"os", "io", "io/fs", "bufio", "log", "log/slog", "math/rand", "math/rand/v2", "crypto/rand", "net", "net/http", "syscall", "unsafe", "sync"}
	for path, f := range pureFiles(t) {
		for _, imp := range f.Imports {
			p, _ := strconv.Unquote(imp.Path.Value)
			for _, bad := range forbidden {
				if p == bad {
					t.Errorf("%s imports %s", path, p)
				}
			}
		}
		ast.Inspect(f, func(n ast.Node) bool {
			sel, ok := n.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			if id, ok := sel.X.(*ast.Ident); ok && id.Name == "time" && (sel.Sel.Name == "Now" || sel.Sel.Name == "Since" || sel.Sel.Name == "Until" || sel.Sel.Name == "Sleep") {
				t.Errorf("%s uses time.%s", path, sel.Sel.Name)
			}
			return true
		})
		// Package-level variables are only allowed for sentinel errors.
		for _, decl := range f.Decls {
			gd, ok := decl.(*ast.GenDecl)
			if !ok || gd.Tok != token.VAR {
				continue
			}
			for _, spec := range gd.Specs {
				for _, v := range spec.(*ast.ValueSpec).Values {
					if !isErrorsNew(v) {
						t.Errorf("%s declares a package-level variable that is not a sentinel error (global state)", path)
					}
				}
			}
		}
	}
}

// TestArchipelagoIntegerOnly: the generator uses integer arithmetic only
// (D-053: identical archipelagos on every platform): no floating-point
// types or literals and no package math (math/bits is fine).
func TestArchipelagoIntegerOnly(t *testing.T) {
	files := parseNonTest(t, filepath.Join(simDir(t), "archipelago"))
	if len(files) == 0 {
		t.Fatal("no generator files")
	}
	for path, f := range files {
		for _, imp := range f.Imports {
			if p, _ := strconv.Unquote(imp.Path.Value); p == "math" {
				t.Errorf("%s imports math", path)
			}
		}
		ast.Inspect(f, func(n ast.Node) bool {
			switch n := n.(type) {
			case *ast.Ident:
				if n.Name == "float32" || n.Name == "float64" {
					t.Errorf("%s uses %s", path, n.Name)
				}
			case *ast.BasicLit:
				if n.Kind == token.FLOAT {
					t.Errorf("%s has the float literal %s", path, n.Value)
				}
			}
			return true
		})
	}
}

func isErrorsNew(e ast.Expr) bool {
	call, ok := e.(*ast.CallExpr)
	if !ok {
		return false
	}
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	pkg, ok := sel.X.(*ast.Ident)
	return ok && pkg.Name == "errors" && sel.Sel.Name == "New"
}

// TestNoBuildingIDLiterals enforces that the simulation (including the
// scenario runner) has no building-specific code.
func TestNoBuildingIDLiterals(t *testing.T) {
	c := catalogue(t)
	dirs := []string{simDir(t), filepath.Join(simDir(t), "scenario")}
	for _, dir := range dirs {
		for path, f := range parseNonTest(t, dir) {
			ast.Inspect(f, func(n ast.Node) bool {
				lit, ok := n.(*ast.BasicLit)
				if !ok || lit.Kind != token.STRING {
					return true
				}
				s, err := strconv.Unquote(lit.Value)
				if err == nil && c.BuildingByID[s] != nil {
					t.Errorf("%s contains building ID literal %q", path, s)
				}
				return true
			})
		}
	}
}

// TestNoQuestIDsInCode enforces that no Go code of the server (tests
// excluded) contains a quest ID of the shipped content: quests are data
// evaluated by generic predicates.
func TestNoQuestIDsInCode(t *testing.T) {
	c := catalogue(t)
	if len(c.Quests) == 0 {
		t.Fatal("no quests in the shipped content")
	}
	root := filepath.Join(repoRoot(t), "server")
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || !d.IsDir() {
			return err
		}
		for file, f := range parseNonTest(t, path) {
			ast.Inspect(f, func(n ast.Node) bool {
				lit, ok := n.(*ast.BasicLit)
				if !ok || lit.Kind != token.STRING {
					return true
				}
				for _, q := range c.Quests {
					if strings.Contains(lit.Value, q.ID) {
						t.Errorf("%s contains quest ID %q", file, q.ID)
					}
				}
				return true
			})
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// TestWorkforceGrantIsNotACommand (R28a): workforce can only be granted by
// GrantWorkforce (seeding), never through a Command passed to Apply.
func TestWorkforceGrantIsNotACommand(t *testing.T) {
	for path, f := range parseNonTest(t, simDir(t)) {
		for _, decl := range f.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok {
				continue
			}
			if fn.Name.Name == "isCommand" && fn.Recv != nil {
				typ := fmt.Sprint(fn.Recv.List[0].Type)
				if strings.Contains(strings.ToLower(typ), "workforce") || strings.Contains(strings.ToLower(typ), "grant") {
					t.Errorf("%s: command type %s grants workforce", path, typ)
				}
			}
			if fn.Name.Name == "ApplyWithLedger" || fn.Name.Name == "Apply" {
				ast.Inspect(fn, func(n ast.Node) bool {
					if id, ok := n.(*ast.Ident); ok && id.Name == "GrantWorkforce" {
						t.Errorf("%s: %s reaches GrantWorkforce", path, fn.Name.Name)
					}
					return true
				})
			}
		}
	}
}
