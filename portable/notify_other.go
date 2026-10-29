//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
)

func notifyError(message string) {
	fmt.Fprintln(os.Stderr, message)
	if runtime.GOOS == "darwin" {
		// Pass the message as an argument, not interpolated AppleScript code.
		exec.Command("osascript", "-e", `on run argv
display alert "Commons" message (item 1 of argv)
end run`, message).Run()
	}
}
