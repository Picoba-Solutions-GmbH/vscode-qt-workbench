# %{ProjectName}

An expense tracker in three parts: a core library that holds the data and the rules, a Qt
Quick application that shows it, and tests for the core.

| Folder | What it is | Links |
| --- | --- | --- |
| `core/` | the library `%{ProjectName}Core`: expenses, monthly limits, the ledger file. No user interface | Qt Core |
| `app/` | the application `app%{ProjectName}`: QML views, and the view models between them and the core | the core, Qt Quick |
| `tests/` | the core's tests, one program each | the core, Qt Test |

The dependencies go one way: the app and the tests use the core, and the core uses neither.
It links Qt Core only, so nothing in it can draw a window or depend on QML. What it does can be
tested without starting the application, and it would work under another user interface.

## Where things go

- A rule about the data, such as what makes an expense valid or when a budget counts as
  nearly spent, goes in `core/`, with a test in `tests/`.
- Reading and writing files goes in `core/storage/`. Which file, and when, is the
  application's choice, made in `app/main.cpp`.
- Turning core data into text, such as amounts in the user's currency or translated
  category names, goes in `app/viewmodels/`.
- What it looks like goes in the QML files in `app/views/` and `app/components/`.

`app/main.cpp` wires the parts together. It creates the ledger, reads and saves the file,
and creates the view models the QML uses as singletons. The core's enums reach QML through
`app/viewmodels/coretypes.h`, so the core does not have to know about QML.

## Build and test

```sh
cmake -S . -B build
cmake --build build
ctest --test-dir build --output-on-failure
```

In VS Code, CMake Tools builds the project, and its Testing view runs the tests.
