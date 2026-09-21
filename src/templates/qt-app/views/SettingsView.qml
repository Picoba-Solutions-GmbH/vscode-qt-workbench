pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts
import QtQuick.Controls.Basic
import "../components"

// Writes to the AppTheme singleton; every view in the app repaints,
// because they all bind to the same object.
Item {
    id: root

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 12
        spacing: 12

        Card {
            Layout.fillWidth: true
            Layout.preferredHeight: themeColumn.implicitHeight + 32

            ColumnLayout {
                id: themeColumn

                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: 16
                spacing: 12

                ThemedLabel {
                    text: qsTr("Appearance")
                    font.pixelSize: 16
                    font.bold: true
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 12

                    ThemedLabel {
                        Layout.fillWidth: true
                        text: qsTr("Light mode")
                    }

                    // A binding goes one way only. Bind one direction and write
                    // the other back in the handler. onToggled only fires on
                    // user input, so this cannot loop.
                    Switch {
                        checked: AppTheme.lightMode
                        onToggled: AppTheme.lightMode = checked
                    }
                }

                ThemedLabel {
                    Layout.fillWidth: true
                    text: qsTr("AppTheme is a QML_SINGLETON in C++. Nothing passes colours "
                             + "around: each component reads AppTheme directly, and one "
                             + "themeChanged() signal repaints the whole window.")
                    color: AppTheme.subtleText
                    font.pixelSize: 12
                }
            }
        }

        Card {
            Layout.fillWidth: true
            Layout.preferredHeight: paletteColumn.implicitHeight + 32

            ColumnLayout {
                id: paletteColumn

                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: 16
                spacing: 12

                ThemedLabel {
                    text: qsTr("Live palette")
                    font.pixelSize: 16
                    font.bold: true
                }

                Flow {
                    Layout.fillWidth: true
                    spacing: 10

                    Repeater {
                        model: [
                            { name: "background", value: AppTheme.background },
                            { name: "surface", value: AppTheme.surface },
                            { name: "text", value: AppTheme.text },
                            { name: "subtleText", value: AppTheme.subtleText },
                            { name: "accent", value: AppTheme.accent },
                            { name: "border", value: AppTheme.border }
                        ]

                        Column {
                            id: swatch

                            required property var modelData

                            spacing: 4
                            width: 92

                            Rectangle {
                                width: 92
                                height: 44
                                radius: 8
                                color: swatch.modelData.value
                                border.width: 1
                                border.color: AppTheme.border
                            }

                            Text {
                                text: swatch.modelData.name
                                color: AppTheme.subtleText
                                font.pixelSize: 11
                            }
                        }
                    }
                }
            }
        }

        Card {
            Layout.fillWidth: true
            Layout.fillHeight: true

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 16
                spacing: 10

                ThemedLabel {
                    text: qsTr("Danger zone")
                    font.pixelSize: 16
                    font.bold: true
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 10

                    ThemedLabel {
                        Layout.fillWidth: true
                        text: qsTr("Remove every completed task (%1 right now).")
                                .arg(TaskStore.doneCount)
                        color: AppTheme.subtleText
                        font.pixelSize: 12
                    }

                    ThemedButton {
                        text: qsTr("Clear completed")
                        accentColor: AppTheme.priorityColor(Priority.High)
                        enabled: TaskStore.doneCount > 0
                        onClicked: TaskStore.clearCompleted()
                    }
                }

                Item {
                    Layout.fillHeight: true
                }
            }
        }
    }
}
