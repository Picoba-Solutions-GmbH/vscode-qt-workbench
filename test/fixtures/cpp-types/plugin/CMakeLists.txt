qt_add_library(otherplugin STATIC)
qt_add_qml_module(otherplugin
    URI Other
    SOURCES
        gauge.h
)
