# Qt Workbench — guide for agents and contributors

A VS Code extension for developing Qt applications (CMake or qmake, Qt Quick or widgets) in
VS Code: new projects from a template, QML hot reload while debugging, Qt Creator's project
tree, CMake presets with vcpkg and vcpkg packages added or removed in one step, and refactoring that keeps build files, includes, QML imports and types, `.qrc` and `qmldir`
in sync when files are moved, renamed, deleted or created.

## Where to read

| File | For | What is in it |
| --- | --- | --- |
| [README.md](README.md) | people installing the extension | features in one line each, install, hot reload setup. Keep it short |
| [docs/features.md](docs/features.md) | anyone changing behaviour | every feature in detail: what is rewritten, what is left alone and why, commands, settings, limits. The behaviour spec |
| this file | anyone changing code | project rules, code layout, extension points, tests, packaging |

When a change alters what the user sees, update `docs/features.md` in the same change. Touch
the README only for a new feature (one line) or a changed setup step.

## Project rules

- Plain CommonJS, **no dependencies, no build step**. `package.json` points `main` at
  `src/extension.js`. The only `require`s are Node built-ins, `vscode`, and the project's own
  modules.
- Every setting and command lives under `qtWorkbench.*` (declared in `package.json`). The
  output channel, notifications and command titles say `Qt Workbench`.
- *Resolve, then recompute*: a reference is only rewritten when the path it spells resolves to
  a file on disk. Anything that doesn't resolve is left alone, never guessed at.
- Reference updates go into one `WorkspaceEdit` applied together with the move, delete or
  rename, so a single `Ctrl+Z` undoes everything.
- Build folders and git-ignored paths are never read or written (`src/ignore.js`). Rewriters
  called from `refactor.js` only see files that passed it, and `refactor.js` refuses any edit
  to an ignored path as a last guard. A new code path that reads or writes project files must
  go through `IgnoreRules` too. `.vscode/launch.json` is VS Code's, not the project's: Set Up
  QML Hot Reload Debugging writes it even where git ignores `.vscode`. vcpkg's install database
  (`vcpkg_installed/vcpkg/status` and `updates/`) is vcpkg's: the Qt Project Explorer reads it in
  build folders and ignored ones (`io.readVcpkgInstalled`), and nothing else there.
- Everything the extension changes or declines to change is logged, with the reason. Warnings
  are for things the user has to fix by hand.
- All text files are LF (`.gitattributes`): the tests compare files byte for byte.

## Code layout

```text
src/
  extension.js       activation, rename and delete events, saving the edited files afterwards
  class-rename.js    the rename provider that adds QML edits to the language server's C++ rename
  new-file.js        New QML/C++ Source/C++ Header File: name, template, create, save, open
  new-project.js     New Qt Project: template, location, name, a kit and vcpkg for the vcpkg one; files written, folder opened
  project-explorer.js  Qt Project Explorer: the tree view, its commands, drag and drop, reveal, refresh
  qml-hot-reload.js  QML hot reload: debug sessions, file changes, status bar, Reload QML command
  hot-reload-setup.js  Set Up QML Hot Reload Debugging: the changes still needed, picked from a list, made in one edit
  gdb-interrupt.js   breakpoints while the program runs: a cppdbg session's gdb version, setupCommands, the tracker
  vcpkg-setup.js     Set Up vcpkg with CMake Presets: the project, a Qt kit and a vcpkg chosen, the presets written
  vcpkg-packages.js  Add vcpkg Package: preset, port and target chosen, vcpkg add port and install run, CMakeLists.txt edited;
                     Remove vcpkg Package: packages chosen, their usage from vcpkg print-usage, vcpkg.json and CMakeLists.txt edited, install run
  vcpkg-install.js   Install vcpkg: a folder chosen, git clone and the bootstrap script run in it, offered too where Set Up vcpkg and New Qt Project choose a vcpkg
  cmake-install.js   Install CMake: winget install on Windows after confirming, cmake.cmakePath set when CMake Tools has none; offered too by Set Up vcpkg when cmake is missing
  setup-picks.js     what the Set Up and New Qt Project commands ask: the CMake project, the Qt kit, the vcpkg
  refactor.js        one rename or delete -> one WorkspaceEdit: runs the rewriters over the project
  registration.js    one new file -> the edits adding it: runs the registrars up the folder tree
  context.js         MoveContext: which files move where, directory moves, QML type renames, what a delete removes
  summary.js         the confirmation before an update and the notification after it
  documents.js       reading files through the editor's unsaved copy, saving edited files
  ignore.js          what is never touched: build folders by name and content, git check-ignore, user globs
  project.js         project scan: files to visit, include roots, type index, qt_add_qml_module
  qml-syntax.js      QML import parsing, identifier tokens, where a new import line goes
  cpp-syntax.js      C++ class/struct/namespace definitions and which ones QML knows by name
  cmake-syntax.js    CMake command invocations and their arguments, with offsets and block depth
  qmake-syntax.js    qmake assignments, their continued lines and values, with offsets
  json-syntax.js     JSON values with offsets, to add to a JSON file without rewriting it
  paths.js           path keys, relative paths, which kind of file is which
  text.js            regex matches with offsets, line ranges and indentation, edit merging
  log.js             the output channel and the version it reports
  rewriters/         one module per kind of reference; each returns [{start, end, text}]
    build-files.js   CMakeLists.txt, *.cmake, *.pro, *.pri: moved paths, and entries of deleted files
    includes.js      #include "..." and the moc_/.moc/ui_ includes Qt generates
    qml-imports.js   directory imports that follow the types a file uses
    qml-types.js     type names that follow a .qml rename or a C++ class rename
    path-strings.js  file paths and qrc:/ URLs in string literals
    resources.js     .qrc files (moved and deleted entries) and resource references in .ui files
    qmldir.js        qmldir entries, moved and deleted
  project-tree/      what the Qt Project Explorer shows, read from the build files
    cmake.js         CMakeLists.txt evaluated for targets and their files in source groups
    qmake.js         .pro and .pri evaluated for Headers, Sources, Forms..., include() and SUBDIRS
    tree.js          which build files are projects, and the nodes: folders, .qrc contents, vcpkg packages
    vcpkg.js         a CMake project's vcpkg packages: vcpkg.json, and where its presets have vcpkg install
  registrars/        one module per kind of file list a new file is added to
    lists.js         which list suits a new file best, and where in it the entry goes
    cmake.js         CMakeLists.txt, and file(GLOB) that needs no entry
    qmake.js         HEADERS and SOURCES in *.pro, *.pri
    resources.js     .qrc files
    qmldir.js        qmldir entries
  hot-reload/        QML hot reload's parts that need no VS Code
    launch.js        which debug configurations to connect to: -qmljsdebugger parsed as Qt parses it
    resource-tree.js resource paths and the source files behind them, from the .qrc files rcc was given
    session.js       one application: connecting, answering its file requests, reloading
    setup.js         the debug configuration for a kit, and QT_QML_DEBUG and a console in CMakeLists.txt
    preview-client.js  the QmlPreview service's messages
    debug-connection.js  the QML debug protocol: packets, hello, services
    data-stream.js   the QDataStream encoding it all travels in
  presets/           CMake presets with vcpkg, without VS Code
    kits.js          Qt kits: where they are, what each is by its qconfig.pri and tools, its compiler, generator, triplet
    vcpkg.js         where vcpkg is, and how a preset spells the path to its toolchain file
    cmake-tool.js    whether cmake and winget are on PATH, and the winget command that installs cmake, for cmake-install.js
    cmake-presets.js the presets for a kit and a vcpkg, and the edits adding them to a CMakePresets.json
    configure-presets.js  a project's configure presets as CMake resolves them, and what each has vcpkg install with
  vcpkg/             vcpkg packages, without VS Code
    installed.js     vcpkg's install database, a vcpkg.json's dependencies, the tree of both, and dependencies taken out
    tool.js          vcpkg's executable, its ports, and running vcpkg add port, vcpkg install and vcpkg print-usage -- and any other executable, for vcpkg-install.js and cmake-install.js
    usage.js         what vcpkg install says about using a port, and the recipes in it
    cmake-edits.js   a recipe added to a target's CMakeLists.txt, and a usage taken out of a project's
    bootstrap.js     cloning vcpkg with git and its bootstrap script's command, for vcpkg-install.js
  gdb/               stopping a running program for an old gdb, without VS Code
    launch.js        which sessions need it: the gdb and its version, the setupCommand added
    interrupt-tracker.js  a session's debug adapter messages: when to stop the program
    break-helper.js  the PowerShell process that stops it, and break-helper.ps1 it runs
  templates/         what New Qt Project writes, with %{ProjectName} for the project's name
    qt-app/          the Qt Quick application, each header beside its source
    qt-core-app/     core/, a library linking Qt Core only; app/, the Qt Quick application on it; tests/, the core's
    qt-libs/         nlohmann-json, csv-parser, restc-cpp and snap7 from vcpkg, with an overlay port for snap7
docs/
  features.md        the behaviour spec
test/
  run.sh             runs the suites below
  harness.js         drives one move, delete, Rename Symbol, New File, New Qt Project, Set Up, Add or Remove vcpkg Package command, debug session or Qt Project Explorer session through the extension with a stubbed vscode API
  lib.sh             helpers and fixture preparation
  cases/             moves.sh, saving.sh, renames.sh, classes.sh, deletes.sh, newfiles.sh, newproject.sh, ignore.sh, explorer.sh, vcpkg.sh, packages.sh, hotreload.sh, debugsetup.sh, gdb.sh
  fake-vcpkg.js      vcpkg add port, vcpkg install and vcpkg print-usage, loaded into a copy of the runtime named vcpkg, for packages.sh
  fixtures/          source trees the tests copy and move files in
  fake-qml-app.js    a Qt application's QML debug server and QmlPreview service, for hotreload.sh
  real-app.js        hot reload against a real Qt application; run by hand
  interrupt-tracker.js  drives gdb/interrupt-tracker.js through a session's messages, for gdb.sh
  fake-break-helper.js  break-helper.ps1's part, for gdb.sh
  real-gdb.js        breakpoints while the program runs, against a real gdb, C/C++ extension and Qt application; run by hand
package.ps1          builds the .vsix without node, npm or vsce
```

## Extending it

**A new kind of reference to update on a move.** Add a rewriter under `src/rewriters/` that
takes `(text, filePath, ctx)` and returns edits as offsets into `text`, then call it from
`refactor.js` for the file types it applies to. `ctx.mapPath(p)` tells you where any path ends
up after the rename. Add a test for it too.

A delete gets the references a rewriter finds reported for free: the delete runs the rewriters
with each deleted file renamed to a stand-in name, and turns their edits into warnings. If the
reference sits in a list that should lose the entry, add a `removeFrom...` beside the rewriter,
using `ctx.isDeletedFile(p)`, and call it from `computeDeleteEdit`.

**A new kind of list that new files are added to.** Add a registrar under `src/registrars/`
that takes `(chain, newPath, readFile)` — `chain` being the folders from the new file's up,
each with the list files in it — and returns `{file, what, edit}`. Then call it from
`registration.js`.

**Another command in the Qt Project Explorer.** A CMake command that adds files to a target
is handled in `Evaluator.run` in `src/project-tree/cmake.js`, a qmake variable that lists
files in `FILE_VARIABLES` in `src/project-tree/qmake.js`. Add the command to the table in
`docs/features.md` and a tree to `test/cases/explorer.sh`.

**Another project template.** Add its files in a folder under `src/templates/`, spelling the
project's name `%{ProjectName}`, and an entry in `TEMPLATES` in `src/new-project.js`; the first
entry is the default. `vcpkg: true` adds the presets Set Up vcpkg writes, and its `vcpkg.json`
unless the template has one; `sharedLibraries: true` gives Linux and macOS kits their dynamic
triplet. A `qt_standard_project_setup(REQUIRES ...)` in its `CMakeLists.txt` refuses older kits. A file type
the `.vsix` has no content type for yet goes into `package.ps1`. Add it to the table in
`docs/features.md` and a test to `test/cases/newproject.sh`, which compares what the command
wrote with the template's files. The `qt-app` template started as the `qt-app` fixture and has
its own layout now; the fixture's (headers at the root, sources in folders) is what the move and
include tests need, so leave it. Every template has to build: check it with a real Qt kit, and
a vcpkg template with a real `vcpkg install`, before committing it.

**A new setting or command.** Declare it in `package.json` under `qtWorkbench.*`, read it with
`vscode.workspace.getConfiguration('qtWorkbench')`, and add it to the Commands or Settings
table in `docs/features.md`. The test harness takes setting defaults straight from
`package.json`.

**CMake presets with vcpkg.** Keep `src/presets/` free of `vscode` too, so its checks run under
plain Node with any platform passed in; `src/vcpkg-setup.js` is the only part that talks to VS
Code. Another kind of kit is a branch in `readKit` in `src/presets/kits.js`: tell it by the
kit's `qconfig.pri` and tools, never by its folder name alone, and give it a check in
`test/cases/vcpkg.sh`.

**vcpkg packages.** Keep `src/vcpkg/` free of `vscode` too; `src/vcpkg-packages.js` is the only
part that talks to VS Code, and `src/project-tree/vcpkg.js` gives the Qt Project Explorer its
packages. What vcpkg says after an install is free text: a new pattern in it belongs in
`recipes` in `src/vcpkg/usage.js`, checked against the real usage file or vcpkg output in
`test/cases/packages.sh`, never a guess at one. vcpkg's usage files are in its `ports/*/usage`.
Removing a package takes out what the same usage adds (`usageRemovals` in
`src/vcpkg/cmake-edits.js`), except what the usage of a package staying has too.

**Hot reload.** Keep protocol code in `src/hot-reload/` free of `vscode`, so it runs under
plain Node and against `test/fake-qml-app.js`. `src/qml-hot-reload.js` is the only part that
talks to VS Code.

**Stopping the program for gdb.** Keep `src/gdb/` free of `vscode` too; `src/gdb-interrupt.js` is
the only part that talks to VS Code. Whether a gdb stops the program itself was checked with
`test/real-gdb.js`, not assumed: run it again for another gdb or C/C++ extension version.

## Tests

```bash
test/run.sh                  # all suites, about a minute
test/run.sh renames ignore   # only some
```

Each test copies a fixture into a temporary folder, makes it a git repository, performs a
real move through the extension, and checks the files on disk and the extension's log. The
fixtures are a small Qt Quick app (`qt-app`), Qt Creator's widgets template with both a
`CMakeLists.txt` and a `.pro` (`qt-widgets`), and four focused projects: resources, sibling
types and qualified imports, every way a QML type can be referenced, and every way a C++
type can be (`cpp-types`).

A new file test runs the command the way the explorer's context menu does, with the
right-clicked folder or file. The input box answers with the test's name, unless the
command's own validation would keep the box open.

A New Qt Project test runs the command from the palette, with a workspace folder open (none with
`NO_FOLDER=1`): it answers the quick picks by label, browses to the location and types the name.
Folders opened or added to the workspace are printed, not opened.

A class rename test runs Rename Symbol the way VS Code's rename widget does: the harness
asks the rename providers in VS Code's order, with a fake C++ language server behind the
extension's provider that renames the word in C/C++ sources (not in strings or comments,
unless `LS_STRINGS=1`). What it returns is applied like VS Code would, refusing overlapping
edits.

A Qt Project Explorer test clicks through the view step by step: it prints the tree or a
node's `TreeItem`, runs context menu commands on nodes, drags nodes onto others and changes
the active editor. Renames and deletes made through `applyEdit` run the extension's file
operation participants, as VS Code does.

A Set Up vcpkg test lays out a Qt installation and a vcpkg clone as far as finding them goes
(`qconfig.pri`, `qtpaths`, empty compilers, `.vcpkg-root`), points the Qt extension's
`qt-core.qtInstallationRoot` at it, hides this machine's Visual Studio and `VCPKG_ROOT`
(`PROCESS_ENV`), and answers the quick picks by label. Kits for other systems, Visual Studio
and preset layouts are checked by calling `src/presets/` directly. That the presets really
configure and build was checked by hand with Qt 6.11.2 MinGW and a vcpkg clone.

An Add vcpkg Package test sets vcpkg up with Set Up vcpkg on that Qt installation, and runs the
command against `fake-vcpkg.js`: `add_vcpkg_tool` links the JavaScript runtime into the vcpkg
folder as `vcpkg.exe` and loads the fake into it with `NODE_OPTIONS`, so the extension starts it
as it starts vcpkg. A port is a folder in its `ports/`, with a usage file or the CMake targets
vcpkg would find. The fake logs how it was run, and the test checks the arguments and `PATH`.
With VS Code's runtime instead of Node.js these tests are skipped. CMake Tools' active configure
preset comes from `ACTIVE_PRESET`. The parsing is checked against usage files of vcpkg's ports and the output of
vcpkg 2026-07-27. The command was also run by hand against that vcpkg, on a copy of a real
project: it installed tinyxml2 for `x64-mingw-dynamic` and edited `CMakeLists.txt` as tested.

A Remove vcpkg Package test runs the same way, the fake answering `vcpkg print-usage` too and
uninstalling in `vcpkg install` what the manifest no longer needs. The modal confirmation's
detail is in the log, on `[detail]` lines. That vcpkg 2026-07-27 refuses `vcpkg remove` in
manifest mode, uninstalls that way instead, and prints with `print-usage` what `install` printed,
was checked against it; so was the command, through the harness on a copy of a real project: it
took fmt out of `vcpkg.json` and `CMakeLists.txt` and vcpkg uninstalled it.

A Set Up QML Hot Reload Debugging test runs on the same Qt installation, answers the list of
changes with the labels to keep checked, and names the other extensions installed
(`EXTENSIONS`). The configuration for other debuggers and systems is checked by calling
`src/hot-reload/setup.js` directly. On a copy of a real project set up by hand, the command
wrote the same `launch.json`, byte for byte.

A hot reload test runs a debug session against `fake-qml-app.js`, which plays the Qt
application: it listens like `-qmljsdebugger` does, asks for files the way the QML engine
does, and records what the extension sends. Its encoding is written out independently of the
extension's. What it does was checked against a real Qt 6.11 application, and `real-app.js`
repeats that check — with and without `block`, two changes, a syntax error and its fix —
against any application built with `QT_QML_DEBUG`, on copies of the project's QML files:

```bash
PATH="/c/Qt/6.11.2/mingw_64/bin:$PATH" node test/real-app.js D:/QT/Test/builds/qt-mingw-debug/appTest.exe D:/QT/Test views/TasksView.qml
```

`real-gdb.js` launches an application the way VS Code does, through the C/C++ extension's debug
adapter with every message passing the extension's tracker. It adds a breakpoint while the
application runs, adds it again, removes it and pauses, using hot reload to run the line:

```bash
PATH="/c/Qt/6.11.2/mingw_64/bin:$PATH" node test/real-gdb.js D:/QT/Test/builds/qt-mingw-debug/appTest.exe D:/QT/Test viewmodels/basics.cpp:13
GDB=C:/msys64/ucrt64/bin/gdb.exe PATH="/c/Qt/6.11.2/mingw_64/bin:$PATH" node test/real-gdb.js ...   # another gdb
```

Requirements: bash, git and GNU sed (Git Bash on Windows, or Linux), and a JavaScript
runtime. Node.js is used if it is installed; otherwise the runtime inside VS Code is used,
so nothing extra is needed on a machine that has VS Code.

| Variable | Effect |
| --- | --- |
| `NODE=/path/to/node` | use this runtime |
| `EXT_DIR=<folder>` | test another copy of the extension, e.g. the installed one under `~/.vscode/extensions` |
| `KEEP_WORK=1` | keep the temporary projects; they are always kept when a test fails |

Build trees and `.gitignore` files are generated by `test/lib.sh` at run time, never
committed: in `test/fixtures` they would be ignored by this repository's own git and
silently go missing.

To debug a single operation, run the harness directly and read its log and diff:

```bash
node test/harness.js /path/to/project '[["views/BasicsView.qml","vince/BasicsView.qml"]]'
node test/harness.js /path/to/project '{"file":"basics.h","symbol":"BasicsViewModel","newName":"TestViewModel"}'
node test/harness.js /path/to/project '{"delete":["views/BasicsView.qml"]}'
node test/harness.js /path/to/project '{"command":"qtWorkbench.newQmlFile","at":"views","name":"ProfileView"}'
node test/harness.js /path/to/workspace '{"command":"qtWorkbench.newProject","picks":["Qt Quick Application"],"browse":["${work}/workspace"],"name":"Notes","answer":"Open"}'
node test/harness.js /path/to/project '{"explorer":[{"tree":true}]}'
node test/harness.js /path/to/project '{"command":"qtWorkbench.setUpVcpkg","picks":["Qt 6.11.2 MinGW 64-bit","Browse..."],"browse":["D:/QT/vcpkg"]}'
node test/harness.js /path/to/project '{"command":"qtWorkbench.removeVcpkgPackage","picks":["qt-mingw-debug",["fmt"]],"answer":"Remove"}'
node test/harness.js /path/to/project '{"command":"qtWorkbench.setUpHotReload","picks":[[".vscode/launch.json: Debug Qt Application with QML hot reload"]]}'
```

## Packaging and installing

```powershell
.\package.ps1                                          # writes qt-workbench-<version>.vsix
code --install-extension .\qt-workbench-<version>.vsix --force
```

The `.vsix` contains `package.json`, `README.md`, `logo.png` (the extension icon) and `src/` only, `src/gdb/break-helper.ps1`
and `src/templates/` included. **Then reload every open VS Code window** (`Developer: Reload Window`): installing
only puts the new version on disk, and a window that isn't reloaded keeps running the old code
with no visible sign. The version in the
newest log entry is the code that actually ran.
