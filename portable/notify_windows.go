package main

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

func notifyError(message string) {
	fmt.Fprintln(os.Stderr, message)
	text, _ := syscall.UTF16PtrFromString(message)
	title, _ := syscall.UTF16PtrFromString("Commons")
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), 0x10)
}
