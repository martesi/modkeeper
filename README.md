# Modkeeper

Modkeeper is a desktop mod manager for **SPT (Single Player Tarkov)**. It installs mods into a separate library, and it turns mods on and off in your game folder without copying them by hand.

Modkeeper does not install SPT or the game. It works with an SPT installation you already have.

## What it does

- **Keeps mods apart from the game.** Your mods live in a library folder. Modkeeper links or copies only the active mods into the game folder.
- **Runs several libraries.** Use one library for each playthrough or server setup, and switch between them.
- **Installs mods from archives.** Import ZIP and 7z files. Modkeeper finds whether each mod is for the client, the server, or both.
- **Warns about conflicts.** If two mods change the same file, Modkeeper shows the conflict before it deploys.
- **Protects existing mods.** If an update fails, Modkeeper restores the previous version.
- **Checks the SPT version.** It reads the installed server data to confirm that a mod matches your SPT version.
- **Blocks unsafe changes.** On Windows, Modkeeper does not change mods while the game or server runs.

## Get it

Download the file for your system from [Releases](https://github.com/martesi/modkeeper/releases/latest).

### Windows

Windows x64 and ARM64 are supported. Run the setup file for your processor. Modkeeper uses the Microsoft Edge WebView2 Runtime. The installer can download it if it is missing, so you may need an internet connection during setup.

### Linux

Linux x86-64 is supported.

1. Make the file executable.
2. Run it from a desktop session.

The file does not install its dependencies or create a shortcut. Modkeeper needs GTK 4 and WebKitGTK 6.0. On Ubuntu 24.04, Debian 13, or newer, install them with:

```sh
sudo apt install libgtk-4-1 libwebkitgtk-6.0-4 xdg-utils
```

Other distributions need the matching GTK 4 and WebKitGTK 6.0 libraries. `xdg-utils` opens external links.

Close the game and the server before you deploy or change mods. On Linux, Modkeeper cannot check whether they run.
