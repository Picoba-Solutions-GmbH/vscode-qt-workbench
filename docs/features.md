# Qt Workbench — feature reference

The complete description of what the extension does, and why. The [README](../README.md) is the
short version for people installing it; this file is the source of truth for behaviour. When
you change what a feature does, change it here too.

- [Overview](#overview)
- [QML hot reload while debugging](#qml-hot-reload-while-debugging)
- [Breakpoints while the program runs](#breakpoints-while-the-program-runs)
- [Moving and renaming files](#moving-and-renaming-files)
- [Renaming a QML file renames its type](#renaming-a-qml-file-renames-its-type)
- [Renaming a C++ class renames its QML type](#renaming-a-c-class-renames-its-qml-type)
- [Deleting files](#deleting-files)
- [New Qt project](#new-qt-project)
- [New QML, C++ source and header files](#new-qml-c-source-and-header-files)
- [Qt Project Explorer](#qt-project-explorer)
- [vcpkg with CMake presets](#vcpkg-with-cmake-presets)
- [vcpkg packages](#vcpkg-packages)
- [How it decides](#how-it-decides)
- [Commands](#commands)
- [Settings](#settings)
- [Limits worth knowing](#limits-worth-knowing)

## Overview

Qt Workbench makes a Qt project (CMake or qmake, Qt Quick or widgets) workable in VS Code:

- Start a new project from the Qt Quick application template, with or without vcpkg set up,
  from one split into a core library, the application and the core's tests, or from one that
  uses JSON, CSV, REST and S7 PLC libraries installed by vcpkg.
- Move or rename a `.qml`, `.cpp`, `.h` or asset file in the VS Code explorer and the places
  that referred to it are rewritten, as part of the same undo step as the move itself.
- Rename a C++ class that QML uses with Rename Symbol (F2), and its QML references are renamed
  along with the C++ ones.
- Delete a file, and its entries in `CMakeLists.txt`, `.pro`, `.qrc` and `qmldir` files go
  with it.
- Create a `.qml`, `.cpp` or `.h` file from the explorer's context menu, and it is added to
  `CMakeLists.txt` (and `.pro`, `.qrc`, `qmldir`) next to the files already listed there.
- The Qt Project Explorer shows each project as Qt Creator's project tree does: its targets,
  and their files in Header Files, Source Files and the other source groups.
- While you debug the application, saving a `.qml` file reloads it in the running application.
- Breakpoints you add while the application runs bind and hit, also with the gdb that comes
  with Qt's MinGW.
- Set up vcpkg in one step: choose a Qt kit and a vcpkg, and the project gets CMake presets
  that build it with both, and a `vcpkg.json` for its dependencies.
- The Qt Project Explorer shows the vcpkg packages a project depends on, as vcpkg installed
  them. Add one there, and it is added to `vcpkg.json`, installed, and found and linked in
  `CMakeLists.txt` as vcpkg's usage for it says. Remove one, and it is taken out of all three.

Neither the official Qt extensions nor CMake Tools nor the C/C++ extension do this today:
`qmlls` advertises no `workspace/fileOperations` capabilities, and CMake Tools only
reconfigures when a `CMakeLists.txt` is *itself* renamed. The Qt QML extension's QML Preview
does hot reload, but it starts the application itself, without a debugger, and its attach
command asks for host and port every time.

## QML hot reload while debugging

Debug the application as usual, save a `.qml` file, and the running application shows the
change: no rebuild, no restart, and the C++ debugger stays attached.

### Setting it up

In a CMake project, **Qt Workbench: Set Up QML Hot Reload Debugging...** does the first two
steps for you: see [below](#set-up-qml-hot-reload-debugging). By hand:

1. Let the Debug build accept QML debug clients. In `CMakeLists.txt`:

   ```cmake
   target_compile_definitions(appTest PRIVATE $<$<CONFIG:Debug>:QT_QML_DEBUG>)
   ```

   Without it the application ignores `-qmljsdebugger`, and hot reload keeps waiting.

2. Start the program with the QmlPreview debug service, in the `args` of its debug
   configuration (`cppdbg`, `cppvsdbg`, `lldb`, or any other type with `args`):

   ```jsonc
   "args": [
     "-qmljsdebugger=host:127.0.0.1,port:${command:qtWorkbench.qmlHotReloadPort},block,services:QmlPreview"
   ]
   ```

   - `${command:qtWorkbench.qmlHotReloadPort}` picks a free port. A fixed port works too.
   - `block` makes the application wait for hot reload before it loads any QML. It works
     without, see below, but `block` is what makes the first reload reliable.
   - `host:127.0.0.1`: with no host, or a name such as `localhost`, Qt listens on every network
     interface.

3. Start debugging. The status bar shows **$(sync~spin) QML Hot Reload** while it waits for
   the application, **$(flame) QML Hot Reload** once connected.

### What a save does

While the application loads its QML, it asks hot reload for every file it reads — through
Qt's QmlPreview debug service, the one Qt Creator's QML Preview uses. A file compiled in with
`qt_add_qml_module` or a `.qrc` is answered from your sources: the `.qrc` files rcc was given
in the program's build tree (`.qt/rcc/*.qrc`), and those in the sources, say which source file
each `:/qt/qml/...` path came from. Qt's own modules, and anything else, the application
reads itself.

Save a file the application has compiled in — `.qml`, `.js`, images, `qmldir` — and its new
contents are sent, then the application creates its root component again. Several files saved
at once make one reload; saving a file without a change makes none; changes made outside VS
Code count too. **Qt Workbench: Reload QML in Debugged Application**, or a click on the status
bar item, reloads without a change.

When the new QML has an error, the application reports it: a warning shows it, and the status
bar item turns yellow until a reload succeeds. Fix the file and save again.

A reload starts the QML side over:

- The whole scene is created again, so what lives in QML — the current tab, typed text,
  pushed `StackView` pages — is back to its initial state.
- So are the singletons the QML engine creates, `QML_SINGLETON` C++ classes included.
- Qt hides the first window and shows the new one where the last reloaded window was.
- C++ objects your `main()` owns, and the C++ debugger with its breakpoints, carry on.

With `block`, the first QML file the application reads is its root component, and Qt's
preview service creates it a second time as soon as it has that file: at startup the root's
`Component.onCompleted` runs twice, with one window visible.

Without `block` the application may already be loading QML when hot reload connects, and the
preview service takes the first `.qml` file it is sent for the new root component — a
`StackView` page loaded later would replace the whole window. So until the first reload, QML
files are left to the application. The first reload then names the root component first: the
module's only `Main.qml`. If there is no single `Main.qml`, that reload fails and asks for
`block`.

### Set Up QML Hot Reload Debugging

**Qt Workbench: Set Up QML Hot Reload Debugging...** lists what debugging a CMake project with
hot reload still takes, and makes the changes you keep checked in one edit. It is offered:

- in the Run and Debug view while there is no `launch.json`, next to VS Code's *create a
  launch.json file*,
- in the command palette, and on a CMake project in the Qt Project Explorer.

In a `launch.json` that exists, **Add Configuration...** also offers two snippets, **Qt
Workbench: Debug with QML Hot Reload** for gdb or lldb and for the Visual Studio debugger. They
hold the same configuration, but take the debugger and Qt's folders from the Qt C++
extension's commands, and add nothing to `CMakeLists.txt`.

| Change | What it is | Offered when |
| --- | --- | --- |
| `.vscode/launch.json`: Debug Qt Application with QML hot reload | the debug configuration below | no configuration in `launch.json` starts the program with `services:QmlPreview` |
| `CMakeLists.txt`: QT_QML_DEBUG for *target* in Debug builds | `target_compile_definitions(appTest PRIVATE $<$<CONFIG:Debug>:QT_QML_DEBUG>)`, after the last command naming the target | an executable target uses QML, and no `CMakeLists.txt` of the project names `QT_QML_DEBUG` for it (in `target_compile_definitions`, `add_compile_definitions`, a flags variable...) |
| `CMakeLists.txt`: a console for *target* in Debug builds | `WIN32_EXECUTABLE $<NOT:$<CONFIG:Debug>>`: a console application in Debug builds, so `qDebug()` output shows, and a GUI application otherwise | the target's `WIN32_EXECUTABLE` is set to `TRUE`, `ON` or `1`, or `qt_add_executable(appTest WIN32 ...)` makes it a GUI application. The `WIN32` keyword is then taken out and the property set after the target's last command |

A target uses QML when it lists `.qml` files or links a `Qt::Qml` or `Qt::Quick` module. A
project with nothing left to change says so, and the log says what it found.

```cmake
set_target_properties(appTest PROPERTIES
    ...
    # Console app in Debug so stdout/qDebug reach the terminal; GUI app otherwise
    WIN32_EXECUTABLE $<NOT:$<CONFIG:Debug>>
)

target_link_libraries(appTest
    PRIVATE Qt6::Quick
)

# Honour -qmljsdebugger in Debug builds: QML debugging, profiling and live preview / hot reload
target_compile_definitions(appTest PRIVATE $<$<CONFIG:Debug>:QT_QML_DEBUG>)
```

The new commands go after the last `target_*`, `set_target_properties` or `qt_*` command that
names the target at the outermost level that has one: inside an `if()` only when all of them
are. They spell the target as `qt_add_executable` does (`${PROJECT_NAME}` too), with the file's
line endings.

The debug configuration starts CMake Tools' launch target:

```jsonc
{
    "name": "Debug Qt Application with QML hot reload",
    "type": "cppdbg",
    "request": "launch",
    "program": "${command:cmake.launchTargetPath}",
    "args": [
        "-qmljsdebugger=host:127.0.0.1,port:${command:qtWorkbench.qmlHotReloadPort},block,services:QmlPreview"
    ],
    "stopAtEntry": false,
    "cwd": "${workspaceFolder}",
    "visualizerFile": "${command:qt-cpp.natvis}",
    "showDisplayString": true,
    "windows": {
        "sourceFileMap": { "Q:/qt5_workdir/w/s": "${command:qt-cpp.sourceDirectory}", ... },
        "environment": [
            { "name": "PATH", "value": "${command:qt-cpp.qtDir};${env:PATH}" },
            { "name": "QT_QPA_PLATFORM_PLUGIN_PATH", "value": "${command:qt-cpp.QT_QPA_PLATFORM_PLUGIN_PATH}" },
            { "name": "QML_IMPORT_PATH", "value": "${command:qt-cpp.QML_IMPORT_PATH}" }
        ],
        "MIMode": "gdb",
        "miDebuggerPath": "C:/Qt/Tools/mingw1310_64/bin/gdb.exe"
    }
}
```

- On Windows the kit decides the debugger: the gdb of the MinGW the kit was built with, or the
  Visual Studio debugger (`cppvsdbg`) for an MSVC kit. The kit is the one `CMakePresets.json`
  names for the Qt extension (`VSCODE_QT_INSTALLATION`, as
  [Set Up vcpkg](#vcpkg-with-cmake-presets) writes it); with none, you choose one as for vcpkg.
- On Linux and macOS it is gdb or lldb, as the C/C++ extension finds them.
- `visualizerFile`, `sourceFileMap` and the Qt C++ extension's variables are only written when
  that extension is installed. Without it, `PATH` starts with the kit's `bin`.

A new `launch.json` is laid out as VS Code writes one. In one that exists, the configuration
goes after the last, laid out like the file, with its comments and trailing commas kept; a
configuration of the same name that doesn't start hot reload is replaced only when you check
it. `launch.json` belongs to VS Code, not the project: it is written even where git ignores
`.vscode`. A `launch.json` that is not valid JSON is not touched.

### Hot reload limits

- Not together with the QML debugger: the application accepts one debug client, so a
  configuration with `services:...,QmlDebugger,V8Debugger,...` is left alone, with a warning
  when it has `block`.
- New QML files, new types in `qmldir`, `CMakeLists.txt` and C++ changes need a rebuild: the
  application only has the resources it was built with.
- `-qmljsdebugger=file:...` (the application connecting out to a local socket) is not supported.

## Breakpoints while the program runs

Add or remove a breakpoint while the program runs, or press Pause, and the debugger acts on it
right away. With QML hot reload the program keeps running for a long time, so that is when
most breakpoints get set.

It needs no setup. It applies to C/C++ extension (`cppdbg`) debug sessions on Windows whose gdb
is older than 15, such as the gdb 11.2 in Qt's MinGW (`C:/Qt/Tools/mingw1310_64/bin/gdb.exe`).

### Why it is needed

To change the breakpoints of a running program, or to pause it, the C/C++ extension sends gdb
`-exec-interrupt` and waits for the program to stop. gdb before 15 on Windows reads no command
while the program runs, so the program never stops: without help, a new breakpoint stays a
grey circle ("Attempting to bind the breakpoint...") and never hits, and Pause does nothing.
Breakpoints set before starting, or while stopped, always work. gdb 15.1 and 17.1 stop the
program themselves and get no help.

### What it does

- When the session starts, Qt Workbench asks the gdb for its version (`gdb --version`, once
  per gdb) and adds `handle SIGINT nostop noprint nopass` to the session's `setupCommands`.
  Your `launch.json` is not changed.
- While the program runs, it watches what VS Code asks the debugger. When a breakpoint change
  or Pause gets no answer within 150 ms and the program kept running all that time, Qt
  Workbench stops the program, as Qt Creator does: `DebugBreakProcess` makes the program stop
  in a new thread. gdb reports the stop, the C/C++ extension changes the breakpoints and lets
  the program continue, or shows it paused.
- gdb then reads the `-exec-interrupt` it was sent and sends the program a Ctrl+C. The
  `handle SIGINT` command makes gdb ignore that Ctrl+C, so the program doesn't stop a second
  time and never receives it.

A Windows PowerShell process does the stopping (`src/gdb/break-helper.ps1`): Node can't call
`DebugBreakProcess`. It starts with the debug session and ends with it. Each time it stops the
program, the log says so:

```text
[10:23:36] v0.10.0: debug session "Debug Qt Application with QML hot reload": GNU gdb (GDB) 11.2
  this gdb cannot stop the running program for new breakpoints or Pause: Qt Workbench stops it
  added to setupCommands: handle SIGINT nostop noprint nopass
[10:23:41] stopped the running program (pid 35300) for setBreakpoints: gdb 11.2 does not stop it itself
```

### Limits

- Ctrl+C typed in the program's console doesn't reach it while gdb debugs it (with
  `externalConsole`). Turn `qtWorkbench.gdbInterrupt` off if you need that.
- Only local gdb sessions: not `miDebuggerServerAddress`, `pipeTransport` or core dumps.
- When PowerShell can't run the helper, for example because policy blocks `Add-Type`, the log
  says why, and breakpoints added while the program runs behave as without Qt Workbench.
- Adding a breakpoint takes up to about 200 ms longer, because Qt Workbench first waits for gdb.

## Moving and renaming files

| Target | Example |
| --- | --- |
| `CMakeLists.txt`, `*.cmake` | `QML_FILES`, `SOURCES`, `RESOURCES`, `HEADERS`, `${CMAKE_CURRENT_SOURCE_DIR}/...` |
| `*.pro`, `*.pri`, `*.prf` | `SOURCES +=`, `HEADERS +=`, `DISTFILES +=` |
| C/C++ `#include "..."` | both in the files that include the moved header **and** inside the moved file itself |
| C/C++ generated includes | `moc_foo.cpp`, `foo.moc`, `ui_foo.h` follow a rename of `foo.h`, `foo.cpp`, `foo.ui` |
| QML directory imports | added, repointed and removed so they follow the types each file uses — see [QML imports](#qml-imports) |
| QML type names | renaming `BasicsView.qml` renames `BasicsView {}` everywhere it resolves — see below |
| QML types from C++ | F2 on `class BasicsViewModel` (`QML_ELEMENT`) renames `BasicsViewModel {}` in QML too — see below |
| QML/C++ path strings | `Loader { source: ... }`, `Image { source: ... }`, `Qt.createComponent(...)` |
| Type-name strings | `loadFromModule("Test", "Main")`, `Qt.createComponent("Test", "BasicsView")` |
| `qrc:/` and `:/` URLs | translated through the `URI` of the owning `qt_add_qml_module` |
| `.qrc` files | `<file>` entries, with an `alias` added so the `:/` URL stays stable |
| `.ui` files | `location=` / `resource=` attributes |
| `qmldir` files | `Type 1.0 Path.qml` entries, including the type name on a rename |

A rename (F2 in the explorer) is just a move to a new name, so everything here applies to
both. Directory renames are expanded to every file underneath them.

## Renaming a QML file renames its type

A `.qml` file's name *is* its type name, so renaming `BasicsView.qml` to `TestView.qml`
renames every reference that resolves to that file — `BasicsView {}`,
`property BasicsView page`, `function f(): BasicsView`, `BasicsView.SomeEnum`, and the
file's references to itself. A file resolves the name to the renamed file when it sees it
through:

- its own directory (same folder, no import needed),
- a directory import — `import "views" as V` makes `V.BasicsView` count,
- the same `qt_add_qml_module` (the files of one module see each other with no import),
- an `import Test` of that module, under its qualifier.

Left alone: comments, string literals (except the `loadFromModule` / `createComponent`
type-name argument), member accesses such as `root.BasicsView`, and any file where a
*different* `BasicsView.qml` is visible the same way — that one is ambiguous, so you get a
warning and fix it by hand. A new name that isn't a valid type name (`basics_view.qml`)
renames nothing and warns.

Renaming `Main.qml` also updates `engine.loadFromModule("Test", "Main")` — otherwise the
application would no longer start.

Renaming a `.h`/`.cpp` file renames no class: in C++ a file name says nothing about the
classes inside it, so the references to it are its `#include`s, build entries and
generated `moc_`/`.moc` includes. To rename a class, use F2 on the symbol — see next.

## Renaming a C++ class renames its QML type

A class registered with `QML_ELEMENT` is known to QML by its C++ name. Put the cursor on
`BasicsViewModel` in `basics.h` (or on any use of it), press F2, type `TestViewModel`, and
your C++ language server (C/C++ extension or clangd) renames the C++ references as it
always does. This extension adds the QML ones to that same edit:

```text
views/BasicsView.qml      BasicsViewModel {      ->   TestViewModel {
```

It is one rename: a single `Ctrl+Z` undoes C++ and QML together, `Shift+Enter` in the
rename box previews both, and `files.refactoring.autoSave` saves both.

Everything the `.qml` rename above touches is renamed here too — `BasicsViewModel {}`,
`property BasicsViewModel vm`, `function f(): BasicsViewModel`, `BasicsViewModel.SomeEnum`,
`T.BasicsViewModel`, and the `loadFromModule` / `Qt.createComponent` type-name strings —
but a C++ type has no directory, so a QML file sees it only through its module:

- the `.qml` files of the same `qt_add_qml_module`, with no import,
- an `import Test` of that module, under its qualifier.

The module is the one whose target builds the class's file: listed under `SOURCES` of
`qt_add_qml_module`, in `qt_add_executable` / `add_library` / `target_sources` of the same
target, or — as AUTOMOC does — a header next to a listed `.cpp` of the same name.

Which symbol is being renamed is the language server's call, not a guess from the name:
QML is only touched when the server's edit renames the definition of a class, struct or
namespace (`Q_NAMESPACE` + `QML_ELEMENT`) that QML knows by that name. So renaming
`m_counter`, a local variable called `BasicsViewModel`, or another module's class of the
same name changes no QML.

Left alone, with a warning where it applies:

- `QML_NAMED_ELEMENT(Knob)`, `QML_ANONYMOUS`, `QML_VALUE_TYPE`, `QML_FOREIGN` and the
  like: the QML name does not come from the class name, so it does not change.
- A file where another type of the same name is visible — say an imported directory
  holds a `BasicsViewModel.qml` — is ambiguous: fix it by hand.
- A class whose file no `qt_add_qml_module` target builds: which QML files see it is
  unknown. The C++ rename still happens.
- A new name QML cannot use (`basics_view_model`): C++ only.
- `qmlRegisterType<Foo>("Test", 1, 0, "Foo")`: the QML name is the string, not the class.

## Deleting files

Delete a file or a folder in the explorer, and every list that names a deleted file loses
that entry as part of the delete:

| Where | What goes |
| --- | --- |
| `CMakeLists.txt`, `*.cmake` | the entry in `QML_FILES`, `SOURCES`, `RESOURCES`, `qt_add_executable`, `add_library`, `target_sources`, `set(...)`, `list(APPEND ...)`, `source_group`, `install(FILES ...)` and the other `qt_` commands |
| | the whole command when it exists only for deleted files: `set_source_files_properties(Theme.qml PROPERTIES ...)`, `set_property(SOURCE ...)`, a `target_sources` or `list(APPEND ...)` with nothing left, `include()` of a deleted `.cmake`, `add_subdirectory` of a deleted folder |
| `*.pro`, `*.pri` | the value in any assignment (`SOURCES`, `HEADERS`, `FORMS`, `RESOURCES`, `DISTFILES`, `SUBDIRS` ...), an assignment left empty, `include()` of a deleted `.pri` |
| `.qrc` | the `<file>` entry |
| `qmldir` | the `Type 1.0 File.qml` entry |

An entry on a line of its own takes the line with it. An entry sharing its line takes the
space before it. When the last line of a qmake list goes, the ` \` continuation before it
goes too, so the list doesn't swallow the next line. An emptied block between two blank
lines leaves one blank line.

```text
delete mainwindow.h    CMakeLists.txt   set(PROJECT_SOURCES
                                                main.cpp
                                                mainwindow.cpp
                                          -     mainwindow.h
                                                mainwindow.ui
                                        )
                       notes.pro          - HEADERS += \
                                          -     mainwindow.h
                                          -
```

A deleted file named anywhere else in CMake, such as `configure_file(version.h.in version.h)`,
isn't touched: taking an argument out could break the call, so you get a warning with the
line. `if(EXISTS ...)` only tests for the file and is left alone.

### What still refers to a deleted file

Code that uses a deleted file can't be fixed by deleting something, so it is reported, not
edited. The log gets one warning per file, with lines:

```text
! views/StatsView.qml still refers to deleted files: TaskStore (lines 20, 35, 55)
! singletons/taskstore.cpp still refers to deleted files: ../taskstore.h (line 1)
```

These are exactly the references a rename of the deleted file would have updated:

- `#include "..."`, including generated includes like `ui_mainwindow.h`
- QML types: `BasicsView {}`, and the `QML_ELEMENT` classes of a deleted header (`TaskStore`)
- paths and `qrc:/` URLs in strings
- `loadFromModule` type names
- `.ui` resource references

Build folders and ignored paths are skipped, and a delete inside one updates nothing, as
for moves.

## New Qt project

**Qt Workbench: New Qt Project...** creates a project from a template. It is in the command
palette, and in the Explorer view of a window with no folder open.

| Template | What you get |
| --- | --- |
| **Qt Quick Application** (the default) | a CMake project for Qt 6.10 or later: a window with tabs for four views (Tasks, Stats, Settings, Basics), themed QML components, and the C++ types they use — the `AppTheme` and `TaskStore` singletons, a filter proxy model, a report service and a view model — all in one `qt_add_qml_module`. Each header sits beside its source, in a folder for what it is: `models/`, `services/`, `theme/`, `viewmodels/` |
| **Qt Quick Application with vcpkg** | the same files, plus a `vcpkg.json` for its libraries and a `CMakePresets.json` that builds it with a Qt kit and vcpkg |
| **Qt Quick Application with Core Library** | an expense tracker in three parts, each a folder with its own `CMakeLists.txt`: `core/`, a static library with the data and the rules — expenses, monthly limits per category, the ledger file — linking Qt Core only; `app/`, the Qt Quick application, whose view models turn the core's objects into what two views (Expenses, Budget) show; and `tests/`, a Qt Test program for each part of the core, run by `ctest` |
| **Qt Quick Application with vcpkg Libraries** | a window with a tab for each of four libraries vcpkg installs: JSON with [nlohmann-json](https://github.com/nlohmann/json) (formatting, reading into a C++ struct, handing to QML), CSV with [csv-parser](https://github.com/vincentlaucsb/csv-parser) (a file or text in a `TableView`), REST calls with [restc-cpp](https://github.com/jgaa/restc-cpp) (a GET whose JSON reply drives a list) and a Siemens S7 PLC client with [snap7](https://snap7.sourceforge.net/) (connect, read and write a data block, on a worker thread), with a simulated PLC to try it on. Its `vcpkg.json` lists the four, and a `CMakePresets.json` builds it with a Qt kit and vcpkg |

Choose the template, then the folder to create the project in, then type its name. With vcpkg,
you also choose a Qt kit and a vcpkg, as for [Set Up vcpkg](#vcpkg-with-cmake-presets), and the
new project gets the same `CMakePresets.json` that command writes, and its `vcpkg.json` unless
the template has one of its own. A kit older than the Qt version the template's
`qt_standard_project_setup(REQUIRES ...)` names is refused.

In the core library template:

- Dependencies go one way. The app and the tests link `<name>Core`, which puts `core/` on their
  include path, so they include its headers by their path in `core/`:
  `#include "domain/ledger.h"`. The core links Qt Core alone, so it cannot use Qt Gui, Qt Qml or
  Qt Quick.
- `app/main.cpp` creates the core's `Ledger` and reads it from `ledger.json` in the
  application's data folder (`QStandardPaths::AppDataLocation`), or starts with sample data. It
  saves the ledger after each change, and it creates the view models. A file that cannot be read
  is left as it is, and nothing is saved over it.
- The view models are `QML_SINGLETON`s whose `create()` returns the objects `main()` created. A
  [hot reload](#what-a-save-does) creates the scene again, but these objects and the data they
  show stay.
- The core's enums are QML types as well (`Category.Food`, `Budget.OverBudget`), registered from
  the app's side with `QML_FOREIGN_NAMESPACE` in `app/viewmodels/coretypes.h`.
- The controls use the Basic style. FluentWinUI3 was tried: it prints hundreds of TypeErrors
  from its own files on every hot reload.
- On Windows, `ctest` puts Qt's `bin` folder on `PATH` for the tests. Otherwise they cannot find
  Qt's DLLs.
- [Set Up QML Hot Reload Debugging](#set-up-qml-hot-reload-debugging) sets up `appNotes` in
  `app/CMakeLists.txt` and leaves the tests alone, since they use no QML.

The vcpkg libraries template also brings:

- `vcpkg-configuration.json` and `vcpkg-ports/snap7`, an overlay port used in place of vcpkg's
  snap7: vcpkg's port links the Windows socket libraries for Visual C++ only, so MinGW cannot
  link it. The port's build script is `snap7.cmake`, not `CMakeLists.txt`, so the Qt Project
  Explorer does not take it for a project.
- A copy of vcpkg's DLLs next to the executable after each build with MinGW, which vcpkg does
  only for its Visual C++ triplets. Without them the program does not start.
- snap7 builds only as a shared library. The Linux and macOS triplets build static ones, so for
  those kits the presets name `x64-linux-dynamic`, `arm64-osx-dynamic` and so on. That is logged.

The first configure runs `vcpkg install` for the four and what they need, Boost and OpenSSL
among them: allow it a while. With MinGW, keep the project's path short: Boost's headers end up
deep inside `builds/<preset>/vcpkg_installed`, and MinGW's compiler cannot open a file whose
path is longer than 260 characters.

The name is used in several places. For `Notes`:

| Where | Spelled |
| --- | --- |
| the project's folder | `Notes`, inside the folder you chose |
| `CMakeLists.txt` | `project(Notes ...)`, the executable `appNotes`, `URI Notes` |
| `main.cpp` | `engine.loadFromModule("Notes", "Main")` |
| QML files | `import Notes` |

In the core library template the executable and the URI are in `app/CMakeLists.txt`, and
`main.cpp` is in `app/`. The library is `NotesCore`, in `core/CMakeLists.txt`, and the
application's data folder is named `Notes` too.

So a name starts with a letter and holds only letters, digits and `_`. The folder must not exist
yet, or hold nothing but hidden entries, such as the `.git` of a `git init`.

The files are written as the template has them, with LF line endings, and the project is
opened: in this window when no folder is open, otherwise you choose **Open**, **Open in New
Window** or **Add to Workspace**. When the project's folder is already a workspace folder, as
when you opened an empty folder first, there is nothing to open. The log lists every file
written. Inside the open workspace, no project is created in a build folder or a git-ignored
folder.

The templates are in the extension's `src/templates`. The name is `%{ProjectName}` in their
files.

## New QML, C++ source and header files

Right-click a folder in the explorer, below **New File...** and **New Folder...**:

- **New QML File...**
- **New C++ Source File...**
- **New C++ Header File...**

Right-click a file instead and the new file goes next to it. The commands are in the command
palette too (`Qt Workbench: New QML File...`), where they start from the active editor's
folder.

Type a name. The extension is added if you leave it out (`ProfileView` → `ProfileView.qml`,
`notedialog` → `notedialog.h`), and a path such as `dialogs/ConfirmDialog` creates the folder
too. The file is created, added to the project, saved and opened in one step:

| File | Starts as |
| --- | --- |
| `.qml` | `import QtQuick` and an empty `Item {}`. The import copies a version (`import QtQuick 2.15`) from the `.qml` files next to it, so a Qt 5 project gets one |
| `.h` | an include guard, `#ifndef NOTEDIALOG_H` (or `#pragma once`, see `headerGuard`) |
| `.cpp` | `#include "notedialog.h"` when that header sits next to it, else empty |

Right-click `notedialog.h` and choose **New C++ Source File...**, and `notedialog` is already
typed in. An existing name, `..`, or `widget.cpp` in the header command is refused. A `.qml`
name that is no type name (`helpers.qml`) gets a warning and is still created.

### Where it is added

From the new file's folder upwards, the nearest file that already lists files like it gets the
entry:

| Where | `.qml` | `.cpp` / `.h` |
| --- | --- | --- |
| `CMakeLists.txt` | `QML_FILES` of `qt_add_qml_module` or `qt_target_qml_sources`; `FILES` of `qt_add_resources`; `set(...)` / `list(APPEND ...)` of `.qml` files | `SOURCES` of `qt_add_qml_module`; `qt_add_executable`, `qt_add_library`, `add_executable`, `add_library`; `PRIVATE`/`PUBLIC` of `target_sources`; `set(PROJECT_SOURCES ...)` / `list(APPEND ...)` of C++ files |
| `.pro` / `.pri` | — | `HEADERS` or `SOURCES` |
| `.qrc` | a `<file>` in the `.qrc` that lists `.qml` files | — |
| `qmldir` | `ProfileView 1.0 ProfileView.qml`, in the `qmldir` of its folder (one further up only if it lists this folder's files) | — |

A `CMakeLists.txt` with nothing that fits, such as one that only calls `add_subdirectory`, is
passed over for the next one up. Within one file, the list that wins is the one holding:

1. the file's partner (`notedialog.cpp` for a new `notedialog.h`) in the same folder,
2. else the most files from the same folder,
3. else files from the nearest folder.

A `set(...)` holding no files like it is never picked. The Qt Creator widgets template lists
its sources in `set(PROJECT_SOURCES ...)` and hands `${PROJECT_SOURCES}` to
`qt_add_executable`, so a new header goes into `PROJECT_SOURCES`.

Inside the list the entry goes right after its partner, or after the last file of its folder
when that folder's files are listed together (`views/ProfileView.qml` after
`views/BasicsView.qml`), and otherwise at the end. It copies the layout around it: one entry
per line at the same indentation, or on the same line for a one-line list. It also copies a
neighbour's quotes or `${CMAKE_CURRENT_SOURCE_DIR}/` prefix, `$$PWD/` and ` \` continuations
in qmake, and the file's tabs and CRLF line endings. A `qt_add_qml_module` without
`QML_FILES` gets the section added.

```text
new views/ProfileView.qml   CMakeLists.txt   views/BasicsView.qml
                                           + views/ProfileView.qml
new notedialog.h            notes.pro        HEADERS += \
                                                 mainwindow.h \
                                           +     notedialog.h
```

Nothing is added when:

- a `file(GLOB ...)` or `file(GLOB_RECURSE ...)` in that `CMakeLists.txt` already matches the
  file. The log says so; re-run CMake to pick it up.
- the file is created inside a build folder or a git-ignored path (a warning says so).
- nothing above the file lists files like it (a warning says so).

`CMakeLists.txt` and the other edited files are saved right away, so CMake Tools and the Qt
extension reconfigure. As after a move, this follows `files.refactoring.autoSave`, and a file
that already had unsaved changes is edited but not saved. The new file itself is always
saved. `updateCMake`, `updateQrc` and `updateQmldir` switch each kind off, and `confirm` asks
first.

## Qt Project Explorer

**Qt Project Explorer**, in the explorer side bar, shows the projects of the workspace the way
Qt Creator's project tree does. It appears in a workspace that has a `CMakeLists.txt` or a
`.pro` file.

```text
Test  [main]
  CMakeLists.txt
  appTest
    Header Files
      apptheme.h
      basics.h
    Source Files
      components
        Card.qml
      views
        BasicsView.qml
      main.cpp
      Main.qml
  vcpkg Packages
    fmt  12.2.0#1
      vcpkg-cmake  2025-08-07 · host
  CMake Presets
    CMakePresets.json
  CMake Modules
    vcpkg.json
```

### CMake projects

A project is a `CMakeLists.txt` that calls `project()` or sits at the root of a workspace
folder, unless another one adds it with `add_subdirectory()`. Its node is named by
`project()` and shows the git branch. Below it:

- its `CMakeLists.txt`,
- its targets, each with its files in CMake's source groups,
- the directories `add_subdirectory()` adds, each with its own `CMakeLists.txt` and targets,
- **vcpkg Packages**, when it has a `vcpkg.json`: see [vcpkg packages](#vcpkg-packages),
- **CMake Presets**: `CMakePresets.json` and `CMakeUserPresets.json`,
- **CMake Modules**: the other files CMake reads — what `include()` reads, `Find<Name>.cmake`
  modules in `CMAKE_MODULE_PATH`, `configure_file()` inputs and `vcpkg.json`.

A target's files go into groups as CMake groups them for Qt Creator: **Header Files**,
**Source Files**, **Resources**, and any group `source_group()` defines (`FILES`,
`REGULAR_EXPRESSION` or `TREE`). As Qt's CMake functions do, `.qml` and `.js` files go into
Source Files, and the files a target compiles in with `qt_add_qml_module(... RESOURCES)`,
`qt_add_resources()` or `qt_add_shaders()` go into Resources. Files in no group, such as a
`.ui` or a `.qrc`, sit directly under the target. Within a group, files are nested in folders
relative to the target's `CMakeLists.txt`. A folder that holds only one folder is shown as a
single node (`src/app`), and a folder outside the project by its relative path (`../shared`).

The files come from these commands:

| Command | What is read |
| --- | --- |
| `qt_add_executable`, `add_executable`, `qt_add_library`, `add_library`, `qt_add_plugin` | the target and its sources |
| `target_sources` | `PRIVATE` and `PUBLIC` sources, and a file set's `FILES` |
| `qt_add_qml_module`, `qt_target_qml_sources` | `QML_FILES`, `SOURCES`, `RESOURCES` |
| `qt_add_resources`, `qt_add_shaders` | `FILES`, in the form that names a target |
| `qt_add_ui`, `add_custom_target` | `SOURCES` |
| `set`, `list`, `file(GLOB)`, `file(GLOB_RECURSE)` | variables, with globs matched against the files on disk |
| `include`, `add_subdirectory` | the file or directory, read in turn |

The tree is read from the `CMakeLists.txt` files, not from a configured build. So it works
before CMake has ever run, and it changes as soon as a `CMakeLists.txt` is saved. In return,
every branch of an `if()` counts, and your own functions and macros are not run. A path built
from a variable the file does not set (`${CMAKE_CURRENT_BINARY_DIR}`, a `-D` cache
variable), or from a generator expression, is left out rather than guessed.

### qmake projects

A project is a `.pro` file that no other `.pro` names in `SUBDIRS`. A `.pro` next to a
`CMakeLists.txt` that is shown already is the same project built with CMake, and is left out.
Below it are its `.pro` file, a node for each file it `include()`s with the files that file
assigns, the projects of its `SUBDIRS`, and these groups, in this order:

| Group | Variables |
| --- | --- |
| Headers | `HEADERS`, `OBJECTIVE_HEADERS`, `PRECOMPILED_HEADER` |
| Sources | `SOURCES`, `OBJECTIVE_SOURCES`, `LEXSOURCES`, `YACCSOURCES` |
| Forms | `FORMS` |
| State charts | `STATECHARTS` |
| Resources | `RESOURCES` |
| QML | `.qml` files in `DISTFILES` and `OTHER_FILES` |
| Other files | the rest of `DISTFILES` and `OTHER_FILES`, `TRANSLATIONS`, `ICON`, `QMAKE_INFO_PLIST` |

As in Qt Creator, assignments in every scope count, `win32 { }` and `unix:` alike. `-=`
removes a file, and `$$PWD`, `$$files()` and the project's own variables are expanded.

### In both

- A `.qrc` file expands to its prefixes and the files under each, with a file's alias next
  to its name.
- A listed file that is not on disk has a warning icon and **not found**.
- Nothing in a build folder or a git-ignored path is shown, and no build file there is read.
  The same rules decide this as for refactoring (see
  [Build trees and ignored files](#build-trees-and-ignored-files-are-never-touched)).

### What you can do in it

| Action | What happens |
| --- | --- |
| Click a file | it opens, as from the explorer |
| **Open to the Side** | opens it in the editor group beside the current one |
| **New QML File...**, **New C++ Source File...**, **New C++ Header File...** | on a project, target, group or folder, the file goes in the folder that node stands for: for a target or a group, the folder of its `CMakeLists.txt` or `.pro`. On a file, it goes next to that file. It is added to the build files as described [above](#new-qml-c-source-and-header-files) |
| **Rename...** (F2) | renames the file or folder |
| **Delete** (Delete) | asks first (`explorer.confirmDelete`), then moves it to the Recycle Bin or Trash (`files.enableTrash`) |
| Drag files and folders onto a node | moves them into that node's folder, after asking (`explorer.confirmDragAndDrop`). Dropped on a file, they go next to it |
| **Reveal in Explorer View**, **Copy Path**, **Copy Relative Path** | as in the explorer |
| **Set Up vcpkg with CMake Presets...** | on a CMake project: see [vcpkg with CMake presets](#vcpkg-with-cmake-presets) |
| **Set Up QML Hot Reload Debugging...** | on a CMake project: see [Set Up QML Hot Reload Debugging](#set-up-qml-hot-reload-debugging) |
| **Add vcpkg Package...** | on a CMake project, a target, **vcpkg Packages** (also its **+** button) or a package: see [vcpkg packages](#vcpkg-packages). On a target, the package is linked to that target |
| **Remove vcpkg Package...** | on **vcpkg Packages**, or on a package of `vcpkg.json` (also its **−** button), not on one it needs in turn: see [Remove vcpkg Package...](#remove-vcpkg-package). On packages, the ones selected go |

Rename, Delete and dragging make the same file operations as the explorer, so the references
are updated exactly as in [Moving and renaming files](#moving-and-renaming-files) and
[Deleting files](#deleting-files), and the tree then shows the new state.

The file in the active editor is selected in the tree (`projectExplorerAutoReveal`). The tree
is read again when a `CMakeLists.txt`, `*.cmake`, `.pro`, `.pri`, `.qrc`,
`CMakePresets.json`, `CMakeUserPresets.json` or `vcpkg.json` file changes, when a file is
created or deleted, when the git branch changes, and when vcpkg installs or removes packages. The
refresh button in the view's title bar reads it again right away.

### Explorer limits

- No `<Build Directory>` node and no generated files: the tree comes from the project files,
  not from a build.
- A function or macro of your own that adds sources is not run, so its files are not shown.
- No build or run actions on a target. CMake Tools and the Qt extensions provide those.

## vcpkg with CMake presets

**Qt Workbench: Set Up vcpkg with CMake Presets...**, in the command palette or on a CMake
project in the Qt Project Explorer, gives the project CMake presets that build it with a Qt
kit and vcpkg. vcpkg then installs the dependencies in `vcpkg.json` when CMake configures the
project. Choose a Qt kit, then a vcpkg: everything else is found.

From the command palette the project is the workspace's top-level CMake project: a
`CMakeLists.txt` at the root of a workspace folder, or one that calls `project()` with no
`CMakeLists.txt` above it. With several, you choose.

### What it writes

For Qt 6.11.2 with MinGW, `CMakePresets.json` gets three configure presets and two build
presets:

| Preset | |
| --- | --- |
| `qt-mingw` | hidden: the kit and vcpkg |
| `qt-mingw-debug` | inherits `qt-mingw`, `CMAKE_BUILD_TYPE` Debug; also a build preset |
| `qt-mingw-release` | inherits `qt-mingw`, `CMAKE_BUILD_TYPE` Release; also a build preset |

```jsonc
{
  "name": "qt-mingw",
  "hidden": true,
  "generator": "MinGW Makefiles",
  "binaryDir": "${sourceDir}/builds/${presetName}",
  "environment": {
    "PATH": "C:/Qt/6.11.2/mingw_64/bin;C:/Qt/Tools/mingw1310_64/bin;$penv{PATH}"
  },
  "vendor": {
    "qt-cpp": { "VSCODE_QT_INSTALLATION": "C:/Qt/6.11.2/mingw_64" }
  },
  "cacheVariables": {
    "CMAKE_C_COMPILER": "C:/Qt/Tools/mingw1310_64/bin/gcc.exe",
    "CMAKE_CXX_COMPILER": "C:/Qt/Tools/mingw1310_64/bin/g++.exe",
    "CMAKE_TOOLCHAIN_FILE": "D:/vcpkg/scripts/buildsystems/vcpkg.cmake",
    "VCPKG_CHAINLOAD_TOOLCHAIN_FILE": "C:/Qt/6.11.2/mingw_64/lib/cmake/Qt6/qt.toolchain.cmake",
    "VCPKG_TARGET_TRIPLET": "x64-mingw-dynamic",
    "QT_QML_GENERATE_QMLLS_INI": "ON"
  }
}
```

| Field | Value |
| --- | --- |
| `generator` | `MinGW Makefiles` for MinGW. For MSVC, the newest Visual Studio's (`Visual Studio 18 2026`), with `architecture`, and build presets that name their configuration. On Linux and macOS, `Ninja` when Qt's `Tools/Ninja` is installed, else `Unix Makefiles` |
| `binaryDir` | `builds/<preset>`, a build folder Qt Workbench never touches |
| `environment` | `PATH` starts with the kit's `bin`, MinGW's `bin` and Qt's Ninja, where they apply |
| `vendor` | the kit, for the Qt extension |
| `CMAKE_C_COMPILER`, `CMAKE_CXX_COMPILER` | MinGW's `gcc.exe` and `g++.exe`. For the other kits CMake finds the compiler |
| `CMAKE_TOOLCHAIN_FILE` | vcpkg's toolchain file, see [below](#vcpkg) |
| `VCPKG_CHAINLOAD_TOOLCHAIN_FILE` | the kit's `qt.toolchain.cmake`, which vcpkg's toolchain loads. A Qt 5 kit has none and gets `CMAKE_PREFIX_PATH` instead |
| `VCPKG_TARGET_TRIPLET` | `x64-mingw-dynamic`, `x64-windows`, `arm64-windows`, `x64-linux`, `arm64-linux`, `arm64-osx` or `x64-osx` |
| `VCPKG_HOST_TRIPLET` | MinGW only, when no Visual Studio with the C++ tools is installed: the MinGW triplet. vcpkg builds the tools it runs during the build for `x64-windows` otherwise, which needs Visual C++ |
| `QT_QML_GENERATE_QMLLS_INI` | `ON`, for Qt 6.7 and later |

`vcpkg.json` is created when the project has none, with no dependencies yet. Add them with
**Add vcpkg Package...** (see [vcpkg packages](#vcpkg-packages)), with `vcpkg add port <name>`
or by hand; the next configure installs them.

The files are created in one edit, saved, and `CMakePresets.json` is opened. The
notification offers **Select Configure Preset** when CMake Tools is installed. Nothing is
written in a build folder or a git-ignored path: a git-ignored `CMakePresets.json` is refused.

Before the kit and vcpkg are asked, `cmake --version` is tried: without it, CMake Tools cannot
configure with the presets this writes. Missing, a warning offers **Install CMake** (see
[below](#installing-vcpkg-and-cmake)); the command carries on either way, the presets are
written whether or not cmake is on PATH.

### Qt kits

The kits come from the Qt extension's `qt-core.qtInstallationRoot`, or where Qt's installer
puts Qt when it is not set (`C:\Qt` on the system drive, `~/Qt` elsewhere), from the Qt
extension's `qt-core.additionalQtPaths`, and from the folders browsed to before. **Browse...**
takes a kit folder (`C:/Qt/6.11.2/mingw_64`), a Qt version folder or an installation root; a
folder inside a kit (its `bin` or `mkspecs`, browsed to by mistake) is tried too, walking up to
two parent folders for one that holds `mkspecs/qconfig.pri`.

A kit is a folder with `mkspecs/qconfig.pri`. What kind of kit it is comes from that file and
the kit's own tools, not from the folder's name:

| Kit | Recognised by | Needs |
| --- | --- | --- |
| MinGW | `bin/qtpaths.exe` or `bin/qmake.exe`, and `QT_GCC_*_VERSION` | the MinGW Qt was built with, in the installation's `Tools`: GCC 13.1.0 is `Tools/mingw1310_64` |
| MSVC | `bin/qtpaths.exe` or `bin/qmake.exe`, and an `msvc` folder or `QT_MSVC_*_VERSION` | Visual Studio 2017 or later with the C++ tools, as `vswhere` lists them |
| Linux | `bin/qtpaths` or `bin/qmake`, and `QT_GCC_*_VERSION` | — |
| macOS | `bin/qtpaths` or `bin/qmake`, and `QT_APPLE_CLANG_*_VERSION` | — |

A Qt 6 kit also needs `qt.toolchain.cmake`: in `lib/cmake/Qt6` under the kit folder, as Qt's own
installer lays it out, or, one level up from the kit folder, in `cmake/Qt6` -- some Linux
distributions (Arch's `qt6-base`, and others with a similar split) keep a Qt6 package's mkspecs
and tools in their own data folder but its CMake package files in the system's shared
`lib/cmake` instead.

Kits that can't be used are listed below the others, with the reason: kits that cross-compile
(Android, WebAssembly, iOS), llvm-mingw kits (vcpkg builds its MinGW triplets with GCC), a
MinGW kit whose MinGW is not installed, and an MSVC kit without Visual Studio.

### vcpkg

vcpkg is looked for in this order: in the project (`vcpkg`, `external/vcpkg`, `extern/vcpkg`,
`3rdparty/vcpkg` or `third_party/vcpkg`, as a git submodule), at `VCPKG_ROOT`, where the
toolchain file of the project's existing presets points, on `PATH`, in the folders browsed to
before, and inside Visual Studio. A vcpkg folder holds `.vcpkg-root` and
`scripts/buildsystems/vcpkg.cmake`. **Browse...** takes the folder vcpkg was cloned into.
**Install vcpkg...** clones and bootstraps one (see [below](#installing-vcpkg-and-cmake)), and
is used right away, without asking again.

The toolchain file is written as portably as possible:

| vcpkg | `CMAKE_TOOLCHAIN_FILE` |
| --- | --- |
| inside the project | `${sourceDir}/vcpkg/scripts/buildsystems/vcpkg.cmake` |
| the one `VCPKG_ROOT` names | `$env{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake` |
| anywhere else | its absolute path |

### Installing vcpkg and CMake

**Qt Workbench: Install vcpkg...**, in the command palette or offered wherever Set Up vcpkg or
New Qt Project ask for a vcpkg, asks for a folder, then runs `git clone
https://github.com/microsoft/vcpkg.git` into a `vcpkg` folder inside it and its bootstrap script
(`bootstrap-vcpkg.bat` or `.sh`), with the output in the log. It needs git on `PATH`; without it,
a message links to git-scm.com and nothing is written. The folder is remembered like one browsed
to, so it is offered again without asking.

**Qt Workbench: Install CMake**, in the command palette or offered by Set Up vcpkg when cmake is
not on `PATH`, runs `winget install --id Kitware.CMake -e` after confirming, with the output in
the log. Windows only: elsewhere, and without winget, it points at cmake.org instead.

`cmake.cmakePath` is the CMake Tools extension's own setting, so writing it fails when the
extension is not installed: with it missing, **Install CMake Tools Extension** installs it and
waits for VS Code to register its settings, then continues. Once CMake Tools is there, when
winget's CMake landed where it usually does (`Program Files\CMake` or
`%LOCALAPPDATA%\Programs\CMake`) and `cmake.cmakePath` has no value of its own, it is set to the
installed `cmake.exe` in the user settings, so CMake Tools finds it without a window reload.
Otherwise -- the exe was not found where expected, or CMake Tools is still not installed -- a
**Reload Window** button is offered instead.

### A project that has presets already

The new presets are added to its `CMakePresets.json` after the last ones of each list, laid
out like the file: its indentation, tabs and CRLF line endings. The rest of the file stays as
written. A preset of the same name that is already the same is left alone. One that differs
is replaced where it stands, after asking. `version` 1 is raised to 2, which build presets
need. A file that is not valid JSON is not touched: fix it and run the command again. With
the same kit and vcpkg a second time, nothing changes.

An existing `CMakePresets.json` is saved as after a move (`files.refactoring.autoSave`), and
not when it had unsaved changes. An existing `vcpkg.json` is left as it is.

### Limits

- The presets hold paths on this machine: the kit, the compiler, and vcpkg unless it is in the
  project or at `VCPKG_ROOT`. If others build the project with Qt installed elsewhere, move the
  presets to `CMakeUserPresets.json`, which is not meant to be committed.
- One kit per run. Two kits of the same kind and Qt major version, such as Qt 6.8 and 6.11 with
  MinGW, get the same preset names: the second replaces the first, after asking.
- No `vcpkg-configuration.json` or `builtin-baseline` is written, so port versions are those of
  the vcpkg checkout. `vcpkg x-update-baseline --add-initial-baseline` pins them.
- Checked by configuring and building a Qt Quick project that uses a vcpkg port, with Qt 6.11.2
  MinGW on Windows. MSVC, Linux and macOS presets follow the same rules and are covered by the
  tests, but have not been built.

## vcpkg packages

### In the Qt Project Explorer

A CMake project with a `vcpkg.json` has a **vcpkg Packages** node: the dependencies in
`vcpkg.json`, each with the version vcpkg installed, and below each the packages it needs in
turn. A package vcpkg installed for the host rather than for the target, such as the
`vcpkg-cmake` tool, says **host**. A dependency not installed yet says **not installed**, with a
warning icon. A package's tooltip has the port's description, its triplet and the folder it is
installed in.

What is installed comes from vcpkg's install database, `vcpkg/status` and the files in
`vcpkg/updates/` of a `vcpkg_installed` folder. These folders are read, and the first one that
has a package decides:

| Folder | Because |
| --- | --- |
| `vcpkg_installed` in the build folder of each configure preset building with vcpkg's toolchain file, or the preset's `VCPKG_INSTALLED_DIR` | vcpkg installs there when CMake configures with the preset. A package counts when it is installed for the preset's `VCPKG_TARGET_TRIPLET`, or its `VCPKG_HOST_TRIPLET` for a host dependency |
| `vcpkg_installed` in the project folder | `vcpkg install` run in the project folder installs there |

These are build folders or git-ignored ones, and are read anyway: the database is vcpkg's, not
the project's, and nothing in them is written. The presets are read as CMake reads them, with
`inherits` followed and `${sourceDir}`, `${presetName}`, `$env{}` and the other macros expanded.
The tree is read again when vcpkg writes its database, also during a configure.

### Add vcpkg Package...

**Qt Workbench: Add vcpkg Package...**, in the command palette or in the Qt Project Explorer,
adds a port to the project in one step:

1. **The configure preset** to install for, among those building with vcpkg's toolchain file.
   With several, CMake Tools' active configure preset is taken; without CMake Tools, or with
   another preset active, you choose.
2. **The port**, among those of the vcpkg the preset builds with, with their version (from
   `versions/baseline.json`) and description; typing searches all three. **Another Port...**
   takes a name, for a port of another registry or an overlay port.
3. **The target** to link it to: the one the command was run on in the Qt Project Explorer, the
   project's only one, or one you choose.
4. `vcpkg add port <port>` runs in the project folder, and vcpkg adds the port to `vcpkg.json`.
5. `vcpkg install` runs as vcpkg's toolchain file runs it when CMake configures with the preset:
   with its `VCPKG_TARGET_TRIPLET` and `VCPKG_HOST_TRIPLET`, into its `vcpkg_installed`, and in its
   environment, whose `PATH` has the kit's compiler first. Its output goes to the log as it
   comes, and **Cancel** on the notification stops it. The next configure finds it all installed.
6. `CMakeLists.txt` gets what vcpkg says, at the end of the install, about using the port from
   CMake.

For tinyxml2, which has no usage file, vcpkg says:

```text
tinyxml2 provides CMake targets:

  # this is heuristically generated, and may not be correct
  find_package(tinyxml2 CONFIG REQUIRED)
  target_link_libraries(main PRIVATE tinyxml2::tinyxml2)
```

and the `CMakeLists.txt` of Qt's template gets:

```cmake
find_package(Qt6 REQUIRED COMPONENTS Quick)
find_package(tinyxml2 CONFIG REQUIRED)
...
target_link_libraries(appTest
    PRIVATE Qt6::Quick tinyxml2::tinyxml2
)
```

What vcpkg says for a port is its usage file, printed as it is, and for a port without one the
CMake targets vcpkg found in the port's files. It can show several ways to use the port, such as
fmt or its header-only version, or one of qcoro's Qt modules. Each way is a find command --
`find_package()`, `find_path()`, `pkg_check_modules()` and the like -- with the
`target_link_libraries(main ...)`, `target_include_directories(main ...)` and the like after it,
`main` standing for the target. With one way it is added without asking. With several, you
choose; the first that needs no pkg-config is checked.

| vcpkg says | In `CMakeLists.txt` |
| --- | --- |
| `find_package()` and the other find commands | after the file's last `find_package()`; without one, before the command creating the target |
| `target_link_libraries(main PRIVATE ...)` and the other target commands | the items go into the target's own command of that name, after the last item of its `PRIVATE` section: on that item's line, or each on a line of its own when that item has one. Without a `PRIVATE` section, one is added. A `target_link_libraries()` without keywords gets the items without `PRIVATE`: CMake needs all of a target's calls alike |
| the same, for a target without such a command | a new command, after the last command naming the target, or after the `if()` block holding it |
| a find command for a package the file, or a `CMakeLists.txt` above it, finds already, with whatever arguments; an item the target has already | nothing |
| `enable_testing()`, `add_test()`, `set()` and other commands | nothing: the log names them |
| a way inside `if()` | not offered: it needs a person |

The edit to `CMakeLists.txt` is saved as after a move (`files.refactoring.autoSave`), and not
when the file had unsaved changes.

When vcpkg fails -- the port does not exist, or does not build for the triplet -- `vcpkg.json` is
put back as it was, `CMakeLists.txt` is not changed, and the notification gives vcpkg's error:

```text
vcpkg install failed: building snap7:x64-mingw-dynamic failed with: BUILD_FAILED. snap7 is taken out of vcpkg.json again, and CMakeLists.txt is not changed.
```

Nothing is run when:

- the project has no `vcpkg.json`, or no configure preset builds with vcpkg's toolchain file:
  **Set Up vcpkg** is offered,
- `vcpkg.json` has unsaved changes, since vcpkg writes it,
- the preset has no `binaryDir`, so the folder CMake has vcpkg install into is not known,
- the vcpkg has no `vcpkg.exe` yet: run `bootstrap-vcpkg.bat` in it.

### Remove vcpkg Package...

**Qt Workbench: Remove vcpkg Package...**, in the command palette or in the Qt Project Explorer,
takes packages out of the project again:

1. **The configure preset** to uninstall for, chosen as for Add vcpkg Package....
2. **The packages**, among the dependencies in `vcpkg.json`, with the version the preset's build
   folder has installed. In the Qt Project Explorer, the packages selected.
3. `vcpkg print-usage` says, for each package installed, what vcpkg says about using it: the same
   text `vcpkg install` printed when it was added. It runs for the packages that stay too.
4. A confirmation lists everything that is about to change. Nothing is written before **Remove**.
5. `vcpkg.json` loses the packages, and the project's `CMakeLists.txt` files what their usage adds,
   in one edit, so `Ctrl+Z` undoes both. `vcpkg.json` is saved, as vcpkg reads it from disk; a
   `CMakeLists.txt` as after a move (`files.refactoring.autoSave`), and not when it had unsaved
   changes.
6. `vcpkg install` runs as for Add vcpkg Package..., and uninstalls what `vcpkg.json` no longer
   needs. vcpkg removes a package of a `vcpkg.json` only this way: `vcpkg remove` refuses.

| vcpkg says | In `CMakeLists.txt` |
| --- | --- |
| `find_package()` and the other find commands | the command goes, wherever a `CMakeLists.txt` of the project finds that package, whatever else it says |
| `target_link_libraries(main ...)` and the other target commands | each item goes from every command of that name, for whatever target, inside `if()` too. A `PRIVATE` or other keyword whose items all go goes with them, and so does a command left with no item. A line left empty goes, and so does a blank line when a whole command between two goes |
| what the usage of a package staying in `vcpkg.json` has too | nothing goes: zstr's usage finds and links `ZLIB`, and so does zlib's |
| `find_package(PkgConfig)`, while a `pkg_check_modules()` or `pkg_search_module()` stays | nothing goes |

With fmt taken out of Qt's template after [Add vcpkg Package...](#add-vcpkg-package) added it,
`CMakeLists.txt` and `vcpkg.json` are as they were before, byte for byte.

vcpkg keeps a package installed while another one still needs it. When that is all there is to
uninstall, `vcpkg install` does not run, and the confirmation says why:

```text
vcpkg keeps zlib installed: zstr needs it.
```

When vcpkg has not installed a package for the preset, what it says about using the package is
not known: `CMakeLists.txt` is left as it is, and the notification is a warning to check it by
hand. `vcpkg install` does not run when there is nothing to uninstall. A vcpkg from before
`print-usage` fails it: the usage file the package installed is read instead.

When `vcpkg install` fails, the packages stay out of `vcpkg.json` and `CMakeLists.txt`, and the
notification gives vcpkg's error: the next configure removes them.

Nothing is run when the project has no `vcpkg.json`, it has no dependencies, or it has unsaved
changes; nor for the reasons Add vcpkg Package... gives above.

### Package limits

- Only projects with configure presets: a project configured with CMake Tools' kits and
  `cmake.configureSettings` has no preset to take the triplet and the folder from.
- A preset file's `include` is not followed, and a git-ignored `CMakeUserPresets.json` is not read.
- vcpkg installs and uninstalls for one preset. The build folders of the others follow at their
  next configure, from vcpkg's binary cache.
- A port's usage is text its maintainer wrote, and vcpkg's own guess can be wrong, as it says.
  Only find commands and target commands are added: the log shows the whole usage.
- `vcpkg add port` writes `vcpkg.json` its own way, sorted and indented by two spaces.
- Removing a package takes out what its usage says where a `CMakeLists.txt` spells it the same
  way. `fmt::fmt` in a variable or a generator expression stays, and so does anything in an
  included `.cmake` file: the build then says so.
- An item of the usage the project also uses for itself goes too, such as `ws2_32`, which
  oscpack's usage links. The confirmation lists every item before anything is written.
- A host dependency installed for the same triplet as the package using it, as with MinGW
  without Visual Studio, is not marked **host**: vcpkg's database does not say.

## How it decides

The rule throughout is *resolve, then recompute*: a reference is only rewritten when
the path it currently spells actually resolves to a file on disk. An include or a
string it cannot resolve is left alone rather than guessed at.

Includes are resolved against the including file's own directory first, then against
the project include roots (each workspace folder and each directory holding a
`CMakeLists.txt`) — this is what Qt puts on the include path, and it is why
`#include "apptheme.h"` resolves from `singletons/apptheme.cpp` when the header sits
at the project root. The rewrite is expressed relative to whichever root resolved it,
so a root-relative include stays root-relative.

### QML imports

Directory imports follow the types each file actually uses. For every
`import "dir"` in a file, the question is: *after this move, does `dir` still hold a
type this file uses?*

| Situation | What happens |
| --- | --- |
| `dir` still holds some of them | the import stays (rebased if the file or `dir` moved) |
| `dir` lost all of them, and they went somewhere not yet imported | the line is **repointed in place**: `import "views"` → `import "pages"` |
| `dir` lost all of them, and their new home is already imported | the line is **removed** |
| a used type now lives in a directory the file does not import | an import is **added** after the last one |
| a rewrite would duplicate an existing import, or point at the file's own directory | the line is **removed** |

So with `Main.qml` importing `"components"` and `"views"`:

```text
move views/BasicsView.qml -> vince/    Main.qml gains   import "vince"
move vince/BasicsView.qml -> views/    Main.qml loses   import "vince"   (views is already there)
```

The round trip leaves `Main.qml` byte-for-byte as it started.

Types reached **without** an import count too: a file in `views/` that used `BasicsView`
as a same-directory sibling gets `import "../vince"` when `BasicsView` leaves. A file
moving *into* a directory it imported drops that import, and picks up one for the
siblings it left behind. A qualified import (`import "../widgets" as W`) passes its
qualifier to whatever replaces it.

What is never touched:

- **Imports unrelated to the move.** An import is only removed if its directory lost a
  type this file used, or was emptied by this move — an import you wrote but never
  used stays. The one extra: in a file whose imports a move is *already* editing, exact
  duplicates (same directory, same qualifier) are collapsed to one. Duplicates in a
  file the move doesn't touch are left as they are.
- **Types from C++ or real modules.** An import is only added for a type that was
  reachable *through a directory before the move*. `AppTheme`, `TaskStore` and anything
  from `import QtQuick` never were.
- **Directories with a `qmldir`.** A `qmldir` can declare types under names that are
  not file names, so such an import is neither removed nor used to add one; the
  `qmldir` rewriter updates the entry instead. If the file moves outside the `qmldir`'s
  directory — which a `qmldir` cannot reference — you get a warning in the log instead
  of a broken entry.

### Build trees and ignored files are never touched

Nothing inside a build tree or a git-ignored path is ever scanned or edited. Three layers
decide what that means, and all of them apply:

| Layer | What it catches | Can be turned off |
| --- | --- | --- |
| Build folder names | any folder named `build`, `builds`, `build-*` or `cmake-build-*`, at any depth | no |
| Build folder contents | any folder holding a `CMakeCache.txt` or `.qmake.stash`, whatever its name — unless the project file sits next to it (an in-source build) | no |
| `.gitignore` | everything git ignores | `useGitignore` |
| Your globs | `qtWorkbench.exclude` | — |

`.gitignore` is not parsed by the extension: **git itself is asked** (`git check-ignore`,
one call per workspace folder per move). So its answer is exactly git's — nested
`.gitignore` files such as CLion's `cmake-build-debug/.gitignore`, negations like
`!gen/keep.qml`, `.git/info/exclude`, your global excludes file and a byte-order mark all
count. As in git, a file you committed despite an ignore rule is part of the project and
is updated. Build folders are the exception: they are skipped even when committed. If the
folder is not a git repository or git is not installed, the log says so and the build
folder rules still apply.

A move that *starts* inside a build tree or an ignored path — renaming a copy of
`BasicsView.qml` under `builds/`, say — updates nothing anywhere. Moving a source folder
that contains a build folder carries the build files along without editing them. And as a
last guard, the extension refuses to emit an edit for an ignored path whichever rewriter
produced it. The log lists the skipped build folders and how many files git ignored.

### Saving

VS Code applies a move's or delete's reference updates but leaves the edited files
**unsaved**. That would leave the build reading the old `CMakeLists.txt` from disk, so once
the move or delete is done the extension saves the files it edited. It follows VS Code's
own `files.refactoring.autoSave` (on by default; turn it off to review before saving), and
it never saves a file that already had unsaved changes before — those stay dirty for you.
`Ctrl+Z` still undoes the move and every update together.

## Commands

| Command | ID | |
| --- | --- | --- |
| Qt Workbench: Show Log | `qtWorkbench.showLog` | what was changed, and every warning |
| Qt Workbench: New Qt Project... | `qtWorkbench.newProject` | also in the Explorer view of a window with no folder open |
| Qt Workbench: New QML File... | `qtWorkbench.newQmlFile` | also in the explorer context menu |
| Qt Workbench: New C++ Source File... | `qtWorkbench.newCppSource` | also in the explorer context menu |
| Qt Workbench: New C++ Header File... | `qtWorkbench.newCppHeader` | also in the explorer context menu |
| Qt Workbench: Refresh Qt Project Explorer | `qtWorkbench.projectExplorer.refresh` | also the view's title bar |
| — | `qtWorkbench.projectExplorer.*` | the Qt Project Explorer's context menu: `openToSide`, `revealInExplorer`, `copyPath`, `copyRelativePath`, `newQmlFile`, `newCppSource`, `newCppHeader`, `rename` (F2), `delete` (Delete), `setUpVcpkg`, `setUpHotReload`, `addVcpkgPackage`, `removeVcpkgPackage` |
| Qt Workbench: Set Up vcpkg with CMake Presets... | `qtWorkbench.setUpVcpkg` | also on a CMake project in the Qt Project Explorer |
| Qt Workbench: Install vcpkg... | `qtWorkbench.installVcpkg` | also offered where Set Up vcpkg and New Qt Project choose a vcpkg, when none is found |
| Qt Workbench: Install CMake | `qtWorkbench.installCMake` | also offered by Set Up vcpkg when cmake is not on PATH; Windows only, the rest point at cmake.org |
| Qt Workbench: Add vcpkg Package... | `qtWorkbench.addVcpkgPackage` | also on a CMake project, a target and vcpkg Packages in the Qt Project Explorer |
| Qt Workbench: Remove vcpkg Package... | `qtWorkbench.removeVcpkgPackage` | also on vcpkg Packages and a package of `vcpkg.json` in the Qt Project Explorer |
| Qt Workbench: Set Up QML Hot Reload Debugging... | `qtWorkbench.setUpHotReload` | also in the Run and Debug view without a `launch.json`, and on a CMake project in the Qt Project Explorer |
| Qt Workbench: Reload QML in Debugged Application | `qtWorkbench.reloadQml` | also a click on the status bar item |
| — | `qtWorkbench.qmlHotReloadPort` | returns a free port, for `${command:...}` in `launch.json` |
| — | `qtWorkbench.renameSymbol` | bound to F2 in C/C++ editors, see [limits](#limits-worth-knowing) |

Every log entry starts with the version that wrote it (`[10:15:31] v0.3.1: 1 file(s) moved`).

## Settings

All under `qtWorkbench.*`:

| Setting | Default | |
| --- | --- | --- |
| `enabled` | `true` | master switch for moves, renames and deletes |
| `updateCMake` | `true` | CMake and qmake file lists: on a move, a delete, and for a new file |
| `updateIncludes` | `true` | `#include "..."`; on a delete, report the includes left |
| `updateQml` | `true` | QML imports and path strings; on a delete, report the QML types and paths left |
| `renameQmlTypes` | `true` | on a `.qml` rename, rename the type's references, `qmldir` names and type-name strings |
| `renameCppTypes` | `true` | on F2 on a `QML_ELEMENT` class, rename its QML references and type-name strings too |
| `updateQrc` | `true` | `.qrc` and `.ui`: on a move, a delete, and for a new `.qml` file |
| `updateQmldir` | `true` | `qmldir` type entries: on a move, a delete, and for a new `.qml` file |
| `updateResourceUrls` | `true` | `qrc:/qt/qml/<URI>/...` URLs |
| `qrcPreserveAlias` | `true` | add an `alias` so `:/` URLs survive a move |
| `confirm` | `"never"` | `"always"` to get a modal before anything is written |
| `showSummary` | `true` | notification listing the updated files |
| `newFileMenu` | `true` | New QML/C++ Source/C++ Header File in the explorer context menu |
| `headerGuard` | `"ifndef"` | `"pragmaOnce"` for `#pragma once` in a new header |
| `projectExplorer` | `true` | show the Qt Project Explorer in a workspace with a `CMakeLists.txt` or `.pro` |
| `projectExplorerAutoReveal` | `true` | select the active editor's file in the Qt Project Explorer |
| `qmlHotReload` | `true` | connect to debug sessions started with `-qmljsdebugger=...,services:QmlPreview`, reload their QML on save |
| `gdbInterrupt` | `true` | stop the running program for breakpoint changes and Pause when a `cppdbg` session's gdb is older than 15 (Windows) |
| `useGitignore` | `true` | leave alone everything git ignores; build folders are skipped regardless |
| `exclude` | .git, node_modules, .qtcreator, .idea, out, dist | extra globs never scanned, on top of build folders and `.gitignore` |

The extension was called **Qt Move Refactor** up to 0.9.0, with settings and commands under
`qtMoveRefactor.*`. Nothing reads the old names.

## Limits worth knowing

- It only fires for moves and deletes made **through VS Code** — explorer drag-and-drop,
  cut/paste, F2, Delete. A `mv`, `rm` or `git rm` in the terminal, or a move in Windows
  Explorer, bypasses the API entirely and nothing will happen.
- A C++ class rename only follows **Rename Symbol**. Editing the name by hand, or
  find-and-replace, is not a rename and leaves QML alone.
- Only files created with **New QML/C++ Source/C++ Header File...** are added to the build
  files. VS Code's own **New File...** leaves them alone.
- VS Code applies the edit of only one rename provider: the most recently registered one
  that answers. So the extension registers again each time F2 starts a rename in a C/C++
  editor, and whenever a C/C++ editor becomes active. Rename Symbol from the context menu
  or from a key you bound yourself only gets the second: in the first C/C++ file you open,
  the language server may register after it and rename C++ alone. Undo, and use F2.
- Module membership comes from CMake only. In a qmake project (`QML_IMPORT_NAME`), a
  C++ class rename warns and renames no QML.
- `#include <...>` is never touched. Angle includes resolve through the compiler's
  include path, which this extension does not model.
- Type renames work on identifier tokens, not a full QML parser. A JavaScript object key
  spelled exactly like the type (`{ BasicsView: 1 }`) in a file that sees the type would
  be renamed too — unusual, since QML property names start lower-case.
- Whether a file "uses" a type is decided by the type name appearing in its text. A
  name that only appears in a comment keeps an import alive — the error is always
  towards keeping an import, never towards removing a needed one.
- CMake `file(GLOB ...)` source lists need no updating and are not inspected.
- If a `CMakeLists.txt` *itself* moves, its moved entries are rewritten and a warning
  is logged: its other relative paths are not re-based, since that is usually a
  structural change you want to review yourself.
