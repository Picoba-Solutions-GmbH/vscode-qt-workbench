qt_add_executable(demo src/main.cpp)
# gauge.h is listed nowhere: AUTOMOC picks it up next to gauge.cpp
target_sources(demo PRIVATE src/gauge.cpp)
qt_add_qml_module(demo
    URI Demo
    QML_FILES
        app/Main.qml
        views/Page.qml
        views/Clash.qml
    SOURCES
        src/dial.h
        ${CMAKE_CURRENT_SOURCE_DIR}/src/modes.h
)
add_subdirectory(plugin)
