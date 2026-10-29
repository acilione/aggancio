// Archive build helper. Recipients do not need Go or an archive utility.
package main

import (
	"archive/zip"
	"flag"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"time"
)

func main() {
	source := flag.String("source", "", "Directory to archive")
	output := flag.String("output", "", "ZIP output")
	flag.Parse()
	if *source == "" || *output == "" {
		panic("source and output are required")
	}
	file, err := os.Create(*output)
	must(err)
	archive := zip.NewWriter(file)
	must(filepath.WalkDir(*source, func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(*source, name)
		if err != nil {
			return err
		}
		header, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		header.Name = filepath.ToSlash(relative)
		header.Method = zip.Deflate
		header.Modified = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
		writer, err := archive.CreateHeader(header)
		if err != nil {
			return err
		}
		input, err := os.Open(name)
		if err != nil {
			return err
		}
		defer input.Close()
		_, err = io.Copy(writer, input)
		return err
	}))
	must(archive.Close())
	must(file.Close())
}
func must(err error) {
	if err != nil {
		panic(err)
	}
}
