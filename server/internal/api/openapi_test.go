package api

import (
	"bytes"
	"context"
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
	"unicode"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/getkin/kin-openapi/routers/legacy"
)

// specValidator validates exchanges against server/api/openapi.yaml.
type specValidator struct {
	doc    *openapi3.T
	router routers.Router
}

func loadSpec(t testing.TB) *specValidator {
	t.Helper()
	loader := openapi3.NewLoader()
	doc, err := loader.LoadFromFile(filepath.Join(repoRoot(t), "server", "api", "openapi.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if err := doc.Validate(context.Background()); err != nil {
		t.Fatalf("openapi.yaml is invalid: %v", err)
	}
	router, err := legacy.NewRouter(doc)
	if err != nil {
		t.Fatal(err)
	}
	return &specValidator{doc: doc, router: router}
}

func (s *specValidator) validate(t *testing.T, method, path, body string, res response) {
	t.Helper()
	ctx := context.Background()
	req := httptest.NewRequestWithContext(ctx, method, "http://localhost:8080"+path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	route, params, err := s.router.FindRoute(req)
	if err != nil {
		t.Fatalf("%s %s: no route in openapi.yaml: %v", method, path, err)
	}
	in := &openapi3filter.RequestValidationInput{Request: req, PathParams: params, Route: route}
	if err := openapi3filter.ValidateRequest(ctx, in); err != nil {
		t.Fatalf("%s %s: request does not match openapi.yaml: %v", method, path, err)
	}
	out := &openapi3filter.ResponseValidationInput{
		RequestValidationInput: in,
		Status:                 res.status,
		Header:                 res.header,
		Body:                   io.NopCloser(bytes.NewReader(res.body)),
		Options:                &openapi3filter.Options{IncludeResponseStatus: true},
	}
	if err := openapi3filter.ValidateResponse(ctx, out); err != nil {
		t.Fatalf("%s %s: response %d does not match openapi.yaml: %v", method, path, res.status, err)
	}
}

func (s *specValidator) schemaError(name string, data []byte) error {
	var v any
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	return s.doc.Components.Schemas[name].Value.VisitJSON(v)
}

func (s *specValidator) validateSchema(t *testing.T, name string, data []byte) {
	t.Helper()
	if err := s.schemaError(name, data); err != nil {
		t.Fatalf("%s does not match schema %s: %v", data, name, err)
	}
}

// TestGoldenFinalsMatchDisplaySchema validates every golden final payload
// and every display fixture against the DisplayState schema.
func TestGoldenFinalsMatchDisplaySchema(t *testing.T) {
	spec := loadSpec(t)
	root := filepath.Join(repoRoot(t), "server", "testdata")
	goldens, _ := filepath.Glob(filepath.Join(root, "scenarios", "*.golden.json"))
	fixtures, _ := filepath.Glob(filepath.Join(root, "display", "*.json"))
	if len(goldens) < 5 || len(fixtures) != len(goldens) {
		t.Fatalf("found %d goldens and %d display fixtures", len(goldens), len(fixtures))
	}
	for _, f := range goldens {
		data, err := os.ReadFile(f) // #nosec G304 -- test fixture path.
		if err != nil {
			t.Fatal(err)
		}
		var rep struct {
			Final json.RawMessage `json:"final"`
		}
		if err := json.Unmarshal(data, &rep); err != nil {
			t.Fatal(err)
		}
		if err := spec.schemaError("DisplayState", rep.Final); err != nil {
			t.Errorf("%s: final: %v", filepath.Base(f), err)
		}
	}
	for _, f := range fixtures {
		data, err := os.ReadFile(f) // #nosec G304 -- test fixture path.
		if err != nil {
			t.Fatal(err)
		}
		var fx struct {
			Base    json.RawMessage `json:"base"`
			Samples []struct {
				Display json.RawMessage `json:"display"`
			} `json:"samples"`
		}
		if err := json.Unmarshal(data, &fx); err != nil {
			t.Fatal(err)
		}
		if err := spec.schemaError("DisplayState", fx.Base); err != nil {
			t.Errorf("%s: base: %v", filepath.Base(f), err)
		}
		for i, s := range fx.Samples {
			if err := spec.schemaError("DisplayState", s.Display); err != nil {
				t.Errorf("%s: sample %d: %v", filepath.Base(f), i, err)
			}
		}
	}
}

// TestUndeclaredDisplayFieldFails guards the additionalProperties: false
// contract: a field the spec does not declare must fail validation.
func TestUndeclaredDisplayFieldFails(t *testing.T) {
	spec := loadSpec(t)
	ts := newTestServer(t, 1)
	ts.command(cmdRoad, nil)
	ts.command(cmdSawmill, nil)
	disp := decodeDisplay(t, ts.getWorld().Display)
	inject := []func(map[string]any){
		func(d map[string]any) { d["undeclared"] = 1 },
		func(d map[string]any) {
			is := d["islands"].([]any)[0].(map[string]any)
			is["undeclared"] = 1
		},
		func(d map[string]any) {
			is := d["islands"].([]any)[0].(map[string]any)
			for _, b := range is["buildings"].([]any) {
				b.(map[string]any)["undeclared"] = 1
			}
		},
	}
	for i, f := range inject {
		raw, _ := json.Marshal(disp)
		var d map[string]any
		_ = json.Unmarshal(raw, &d)
		f(d)
		raw, _ = json.Marshal(d)
		if err := spec.schemaError("DisplayState", raw); err == nil {
			t.Errorf("case %d: undeclared field passed validation", i)
		}
	}
}

// simSentinels parses the non-test files of internal/sim and returns the
// package-level sentinel errors (name -> message).
func simSentinels(t *testing.T) map[string]string {
	t.Helper()
	dir := filepath.Join(repoRoot(t), "server", "internal", "sim")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	fset := token.NewFileSet()
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		f, err := parser.ParseFile(fset, filepath.Join(dir, name), nil, parser.SkipObjectResolution)
		if err != nil {
			t.Fatal(err)
		}
		for _, decl := range f.Decls {
			gd, ok := decl.(*ast.GenDecl)
			if !ok || gd.Tok != token.VAR {
				continue
			}
			for _, spec := range gd.Specs {
				vs := spec.(*ast.ValueSpec)
				for i, id := range vs.Names {
					if !strings.HasPrefix(id.Name, "Err") || i >= len(vs.Values) {
						continue
					}
					call, ok := vs.Values[i].(*ast.CallExpr)
					if !ok || len(call.Args) != 1 {
						continue
					}
					lit, ok := call.Args[0].(*ast.BasicLit)
					if !ok {
						continue
					}
					msg, _ := strconv.Unquote(lit.Value)
					out[id.Name] = msg
				}
			}
		}
	}
	return out
}

// snake converts ErrNoRoadAtEntrance to no_road_at_entrance.
func snake(name string) string {
	name = strings.TrimPrefix(name, "Err")
	var b strings.Builder
	for i, r := range name {
		if unicode.IsUpper(r) {
			if i > 0 {
				b.WriteByte('_')
			}
			r = unicode.ToLower(r)
		}
		b.WriteRune(r)
	}
	return b.String()
}

// TestErrorCodesCoverSentinels: every simulation sentinel has exactly one
// API error code (its snake_case name) and every sentinel code belongs to a
// sentinel, so a new sim error cannot ship without an API code.
func TestErrorCodesCoverSentinels(t *testing.T) {
	sentinels := simSentinels(t)
	if len(sentinels) < 20 {
		t.Fatalf("found only %d sentinels", len(sentinels))
	}
	byMessage := map[string]string{}
	for name, msg := range sentinels {
		byMessage[msg] = name
	}
	seen := map[string]bool{}
	for _, e := range simErrors {
		name, ok := byMessage[e.err.Error()]
		if !ok {
			t.Errorf("code %q maps to an error that is not a sim sentinel", e.code)
			continue
		}
		if want := snake(name); e.code != want {
			t.Errorf("%s has code %q, want %q", name, e.code, want)
		}
		if seen[name] {
			t.Errorf("%s mapped twice", name)
		}
		seen[name] = true
		if code, status := classify(e.err); code != e.code || status != e.status {
			t.Errorf("classify(%s) = %s %d", name, code, status)
		}
	}
	for name := range sentinels {
		if !seen[name] {
			t.Errorf("sim sentinel %s has no API error code", name)
		}
	}
}

// TestErrorCodeEnumMatchesSpec: the ErrorCode enum in openapi.yaml lists
// exactly the codes the server can return.
func TestErrorCodeEnumMatchesSpec(t *testing.T) {
	spec := loadSpec(t)
	var enum []string
	for _, v := range spec.doc.Components.Schemas["ErrorCode"].Value.Enum {
		enum = append(enum, v.(string))
	}
	codes := ErrorCodes()
	slices.Sort(enum)
	slices.Sort(codes)
	if !slices.Equal(enum, codes) {
		t.Fatalf("openapi ErrorCode enum %v\n!= server codes %v", enum, codes)
	}
	internalOnly := map[string]bool{}
	for _, e := range simErrors {
		if e.status == http.StatusInternalServerError {
			internalOnly[e.code] = true
			if !strings.Contains(spec.doc.Components.Schemas["ErrorCode"].Value.Description, "`"+e.code+"`") {
				t.Errorf("internal-only code %s is not described in openapi.yaml", e.code)
			}
		}
	}
	if len(internalOnly) != 4 {
		t.Errorf("internal-only codes: %v", internalOnly)
	}
}

// TestNumericFieldsStateTheirUnit walks every schema of openapi.yaml
// (components, request bodies, responses and parameters, including nested
// properties, items and map values) and requires a description on every
// integer or number schema, so that each numeric field states its unit and
// scale (or that it is an unscaled identifier or count).
func TestNumericFieldsStateTheirUnit(t *testing.T) {
	spec := loadSpec(t)
	visited := map[*openapi3.Schema]bool{}
	var missing []string
	var walk func(path string, ref *openapi3.SchemaRef)
	walk = func(path string, ref *openapi3.SchemaRef) {
		if ref == nil || ref.Value == nil || visited[ref.Value] {
			return
		}
		s := ref.Value
		visited[s] = true
		if (s.Type.Is(openapi3.TypeInteger) || s.Type.Is(openapi3.TypeNumber)) && strings.TrimSpace(s.Description) == "" {
			missing = append(missing, path)
		}
		for name, p := range s.Properties {
			walk(path+"."+name, p)
		}
		walk(path+"[]", s.Items)
		if s.AdditionalProperties.Schema != nil {
			walk(path+"{}", s.AdditionalProperties.Schema)
		}
		for i, sub := range s.OneOf {
			walk(path+"|"+strconv.Itoa(i), sub)
		}
		for i, sub := range s.AllOf {
			walk(path+"&"+strconv.Itoa(i), sub)
		}
		for i, sub := range s.AnyOf {
			walk(path+"~"+strconv.Itoa(i), sub)
		}
	}
	for name, ref := range spec.doc.Components.Schemas {
		walk(name, ref)
	}
	for path, item := range spec.doc.Paths.Map() {
		for method, op := range item.Operations() {
			for _, p := range op.Parameters {
				walk(method+" "+path+" param "+p.Value.Name, p.Value.Schema)
			}
			if op.RequestBody != nil {
				for _, mt := range op.RequestBody.Value.Content {
					walk(method+" "+path+" body", mt.Schema)
				}
			}
			for code, res := range op.Responses.Map() {
				for _, mt := range res.Value.Content {
					walk(method+" "+path+" "+code, mt.Schema)
				}
			}
		}
	}
	if len(visited) < 40 {
		t.Fatalf("walked only %d schemas", len(visited))
	}
	slices.Sort(missing)
	for _, m := range missing {
		t.Errorf("numeric schema without a unit description: %s", m)
	}
}
