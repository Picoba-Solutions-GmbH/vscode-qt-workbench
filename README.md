# Qt Workbench

Make developing QT applications in VS Code fun

## Features

- **New Qt project**: offers multiple templates for starting a Qt application.
- **QML hot reload**: when saving a `.qml` file while debugging, the running application updates automatically without needing a rebuild, and the C++ debugger stays attached.
- **Breakpoints while the program runs**: breakpoints you add while it runs bind and hit
- **Move and rename files** refactoring capabilities: when you move or rename a file in the explorer, all relevant references in CMakeLists.txt, .pro files, #includes, QML imports, .qrc, qmldir, and qrc:/ URLs are updated accordingly. One `Ctrl+Z` undoes all changes.
- **Rename QML types**: renaming `MyView.qml` renames `MyView {}` everywhere. F2 on a
  `QML_ELEMENT` C++ class renames its QML uses too.
- **Delete files**: their entries leave CMake, qmake, `.qrc` and `qmldir`. Code still using
  them is listed in the log.
- **Context menu**: right-clicking in the Qt Project Explorer provides quick access to actions like creating new files, renaming, deleting, and copying paths.
- **Qt Project Explorer**: Qt Creator's project tree in the side bar. Targets, Header Files,
  Source Files and CMake Modules, with rename, delete, drag and drop and New File.
- **Set up vcpkg**: choose a Qt kit and vcpkg, and the project gets a `CMakePresets.json` that
  builds with both, and a `vcpkg.json`. Compiler, generator and triplet are found for you.
- **vcpkg packages**: the Qt Project Explorer lists the installed packages. Add one there, and it
  is added to `vcpkg.json`, installed, and found and linked in `CMakeLists.txt`. Remove one, and
  it leaves all three again.

Build folders and git-ignored files are never touched.

Full details: [docs/features.md](docs/features.md). Contributing: [AGENTS.md](AGENTS.md).

Licensed under the [MIT License](LICENSE). Qt Workbench is an independent project, not
affiliated with or endorsed by The Qt Company. Qt is a trademark of The Qt Company Ltd.
