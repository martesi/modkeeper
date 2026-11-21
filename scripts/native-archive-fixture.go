package main

import (
	"archive/zip"
	"fmt"
	"os"
)

func main() {
	if len(os.Args) != 4 {
		fmt.Fprintln(os.Stderr, "usage: native-archive-fixture <output.zip> <name> <content>")
		os.Exit(2)
	}
	file, err := os.Create(os.Args[1])
	check(err)
	writer := zip.NewWriter(file)
	entry, err := writer.Create("SPT/user/mods/" + os.Args[2] + "/" + os.Args[2] + ".dll")
	check(err)
	_, err = entry.Write([]byte(os.Args[3]))
	check(err)
	check(writer.Close())
	check(file.Close())
}

func check(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
