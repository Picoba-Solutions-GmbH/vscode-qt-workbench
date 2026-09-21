cmake_minimum_required(VERSION 3.22)

project(%{ProjectName} VERSION 0.1 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Every Qt module a part of the project uses is found here, once. Which part
# may use which is decided by what each one links: the core links Qt Core
# only.
find_package(Qt6 REQUIRED COMPONENTS Core Quick Test)

# Turns on AUTOMOC and the other settings a Qt project needs, and refuses Qt
# versions older than the one given.
qt_standard_project_setup(REQUIRES 6.10)

# ctest runs the tests that tests/ adds with add_test().
enable_testing()

# Three parts, each with its own CMakeLists.txt:
#   core/   the library: the data and the rules, and no user interface
#   app/    the Qt Quick application that shows the core and lets you use it
#   tests/  the core's tests, which need no user interface either
# The core comes first: the other two link it.
add_subdirectory(core)
add_subdirectory(app)
add_subdirectory(tests)
