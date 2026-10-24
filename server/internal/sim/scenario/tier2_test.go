package scenario

import (
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode"

	"github.com/ricoberger/new-shores/server/internal/sim"
)

// simSentinelNames parses the non-test files of internal/sim and returns
// the error message of every exported Err* variable by name.
func simSentinelNames(t *testing.T) map[string]string {
	t.Helper()
	dir := filepath.Join(repoRoot(t), "server", "internal", "sim")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	fset := token.NewFileSet()
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".go") || strings.HasSuffix(e.Name(), "_test.go") {
			continue
		}
		f, err := parser.ParseFile(fset, filepath.Join(dir, e.Name()), nil, parser.SkipObjectResolution)
		if err != nil {
			t.Fatal(err)
		}
		ast.Inspect(f, func(n ast.Node) bool {
			vs, ok := n.(*ast.ValueSpec)
			if !ok {
				return true
			}
			for i, id := range vs.Names {
				if !strings.HasPrefix(id.Name, "Err") || i >= len(vs.Values) {
					continue
				}
				if call, ok := vs.Values[i].(*ast.CallExpr); ok && len(call.Args) == 1 {
					if lit, ok := call.Args[0].(*ast.BasicLit); ok {
						out[id.Name] = strings.Trim(lit.Value, `"`)
					}
				}
			}
			return true
		})
	}
	return out
}

func snakeName(name string) string {
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

// TestSentinelsCoverSim: expect_error names every sim sentinel by its
// snake_case name (the API error code).
func TestSentinelsCoverSim(t *testing.T) {
	names := simSentinelNames(t)
	table := Sentinels()
	if len(names) < 30 || len(table) != len(names) {
		t.Fatalf("%d sim sentinels, %d expect_error names", len(names), len(table))
	}
	for name, msg := range names {
		err, ok := table[snakeName(name)]
		if !ok || err.Error() != msg {
			t.Errorf("%s: expect_error name %q maps to %v", name, snakeName(name), err)
		}
	}
}

const tier2Island = `{"id": "main", "fertilities": ["wheat"], "rows": [
	"~~~~~~~~~~~~~~~~~~~~",
	"~~~~~.......mmmmmm.~",
	"~...........mSSmII.~",
	"~...........mSSmII.~",
	"~...........mmmmmm.~",
	"~..................~",
	"~..................~",
	"~~~~~~~~~~~~~~~~~~~~"]}`

func tier2Scenario(t *testing.T, steps string) *Scenario {
	t.Helper()
	s, err := Parse([]byte(`{"name": "t2", "start": "2026-01-01T00:00:00Z", "island": ` + tier2Island + `,
		"seed": {"trading_post": {"x": 1, "y": 0}, "gold": 100000, "stock": {"planks": 200, "stone": 100, "tools": 10}},
		"steps": ` + steps + `}`))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// TestTierTwoSteps (R-17): S tiles, fertilities, upgrade_warehouse and
// expect_error.
func TestTierTwoSteps(t *testing.T) {
	c := loadCatalogue(t)
	s := tier2Scenario(t, `[]`)
	w, err := BuildWorld(s, c, nil)
	if err != nil {
		t.Fatal(err)
	}
	is := w.Islands[0]
	if d := is.Tile(13, 2).Deposit; is.Tile(13, 2).Terrain != "mountain" || d == nil || d.Kind != "stone" || d.Quantity != -1 {
		t.Errorf("S tile = %+v", is.Tile(13, 2))
	}
	if d := is.Tile(16, 2).Deposit; d == nil || d.Kind != "iron" {
		t.Errorf("I tile = %+v", is.Tile(16, 2))
	}
	if len(is.Fertilities) != 1 || is.Fertilities[0] != "wheat" {
		t.Errorf("fertilities = %v", is.Fertilities)
	}

	// Expected failures are recorded; the run continues.
	s = tier2Scenario(t, `[
		{"place": {"type": "house_citizens", "x": 6, "y": 5}, "expect_error": "upgrade_only"},
		{"place": {"type": "quarry", "x": 6, "y": 4}, "expect_error": "tier_locked"},
		{"upgrade_warehouse": {"x": 1, "y": 1}},
		{"upgrade_warehouse": {"x": 1, "y": 1}},
		{"upgrade_warehouse": {"x": 1, "y": 1}},
		{"upgrade_warehouse": {"x": 1, "y": 1}, "expect_error": "upgrade_unavailable"},
		{"advance": {"duration": "1s"}}
	]`)
	rep, err := Run(s, c)
	if err != nil {
		t.Fatal(err)
	}
	if len(rep.ExpectedErrors) != 3 || rep.ExpectedErrors[0].Error != "upgrade_only" || rep.ExpectedErrors[0].Step != 0 ||
		rep.ExpectedErrors[2].Error != "upgrade_unavailable" || rep.ExpectedErrors[2].Step != 5 || rep.ExpectedErrors[1].Message == "" {
		t.Errorf("expected errors = %+v", rep.ExpectedErrors)
	}
	for _, b := range rep.Final.Islands[0].Buildings {
		if b.Type == "trading_post" && (*b.Level != 4 || *b.Capacity != 1_200_000) {
			t.Errorf("trading post level %d capacity %d", *b.Level, *b.Capacity)
		}
	}

	for _, tc := range []struct {
		steps, want string
	}{
		// A step that succeeds although an error is expected.
		{`[{"upgrade_warehouse": {"x": 1, "y": 1}, "expect_error": "no_deposit"}]`, "step succeeded"},
		// A different error than expected.
		{`[{"place": {"type": "house_citizens", "x": 6, "y": 5}, "expect_error": "no_deposit"}]`, "expected no_deposit, got"},
		{`[{"place": {"type": "fisher", "x": 1, "y": 1}, "expect_error": "nonsense"}]`, "unknown sentinel"},
		{`[{"advance": {"duration": "1s"}, "expect_error": "occupied"}]`, "cannot fail"},
	} {
		if _, err := Run(tier2Scenario(t, tc.steps), c); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: err = %v, want %q", tc.steps, err, tc.want)
		}
	}
}

// TestExpectErrorDetectsChangedWorld: a step that fails but changes the
// world (a scenario-level grant before the failing part) is rejected. The
// place_grid step places its first item and then fails on the second.
func TestExpectErrorDetectsChangedWorld(t *testing.T) {
	c := loadCatalogue(t)
	s := tier2Scenario(t, `[{"place_grid": {"type": "house_settlers", "x": 6, "y": 5, "count": 2, "dx": 0, "dy": 0}, "expect_error": "occupied"}]`)
	_, err := Run(s, c)
	if err == nil || !strings.Contains(err.Error(), "changed the world") {
		t.Fatalf("err = %v", err)
	}
	if !errors.Is(Sentinels()["occupied"], sim.ErrOccupied) {
		t.Error("occupied sentinel")
	}
}
