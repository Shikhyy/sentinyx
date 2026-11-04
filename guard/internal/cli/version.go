package cli

import (
	"fmt"
	"io"
	"runtime"
	"runtime/debug"
)

// Version is set at release time:
//
//	go build -ldflags "-X github.com/Shikhyy/sentinyx/guard/internal/cli.Version=v0.1.0" ./cmd/sentinyx
//
// Builds made with `go install …@version` or from a git checkout fall back to what Go embeds in the binary.
var Version = "dev"

// versionString describes this build: the release version if set, else the module version or commit Go recorded.
func versionString() string {
	v := Version
	if v == "dev" {
		if bi, ok := debug.ReadBuildInfo(); ok {
			if mv := bi.Main.Version; mv != "" && mv != "(devel)" {
				v = mv
			} else {
				for _, s := range bi.Settings {
					if s.Key == "vcs.revision" && len(s.Value) >= 7 {
						v = "dev+" + s.Value[:7]
					}
				}
			}
		}
	}
	return fmt.Sprintf("sentinyx %s (%s, %s/%s)", v, runtime.Version(), runtime.GOOS, runtime.GOARCH)
}

func printVersion(w io.Writer) int {
	fmt.Fprintln(w, versionString())
	return 0
}
