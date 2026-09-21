pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts
import QtQuick.Controls.Basic
import "../components"
import %{ProjectName}

// Nothing here is refreshed by hand: every number is a binding onto a
// C++ Q_PROPERTY, and TaskStore emits statsChanged() whenever the data moves.
// Add a task on the Tasks tab and these tiles are already correct when you
// come back.
Item {
    id: root

    // Async work, driven from C++ (see services/reportservice.cpp).
    ReportService {
        id: reportService

        source: TaskStore
        onReportReady: (report) => {
            reportText.text = report
        }
    }

    // A QML-side ListModel, for contrast with the C++ one on the Tasks tab.
    // Fine for small view-local lists; no C++ needed.
    ListModel {
        id: activityLog
    }

    // Subscribes to a signal on an object this file did not declare. The
    // handler name is "on" + the signal name, capitalised.
    Connections {
        target: TaskStore

        function onTaskAdded(title) {
            activityLog.insert(0, { entry: qsTr("Added: %1").arg(title) })
            if (activityLog.count > 12)
                activityLog.remove(12)
        }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 12
        spacing: 12

        RowLayout {
            Layout.fillWidth: true
            spacing: 12

            Repeater {
                model: [
                    { label: qsTr("Total"), value: TaskStore.totalCount, tint: AppTheme.accent },
                    { label: qsTr("Open"), value: TaskStore.openCount, tint: AppTheme.priorityColor(Priority.Normal) },
                    { label: qsTr("Done"), value: TaskStore.doneCount, tint: AppTheme.subtleText },
                    { label: qsTr("High priority"), value: TaskStore.highPriorityOpenCount, tint: AppTheme.priorityColor(Priority.High) }
                ]

                Card {
                    id: tile

                    required property var modelData

                    Layout.fillWidth: true
                    Layout.preferredHeight: 92

                    ColumnLayout {
                        anchors.centerIn: parent
                        spacing: 2

                        ThemedLabel {
                            Layout.alignment: Qt.AlignHCenter
                            text: tile.modelData.value
                            color: tile.modelData.tint
                            font.pixelSize: 34
                            font.bold: true
                        }

                        ThemedLabel {
                            Layout.alignment: Qt.AlignHCenter
                            text: tile.modelData.label
                            color: AppTheme.subtleText
                            font.pixelSize: 12
                        }
                    }
                }
            }
        }

        Card {
            Layout.fillWidth: true
            Layout.preferredHeight: 74

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 14
                spacing: 8

                ThemedLabel {
                    text: TaskStore.totalCount === 0
                          ? qsTr("No tasks yet")
                          : qsTr("%1% complete").arg(Math.round(100 * TaskStore.doneCount / TaskStore.totalCount))
                    font.pixelSize: 13
                }

                Rectangle {
                    Layout.fillWidth: true
                    height: 10
                    radius: 5
                    color: AppTheme.background

                    Rectangle {
                        width: TaskStore.totalCount === 0
                               ? 0
                               : parent.width * TaskStore.doneCount / TaskStore.totalCount
                        height: parent.height
                        radius: 5
                        color: AppTheme.accent

                        // Animates whenever the bound width changes.
                        Behavior on width {
                            NumberAnimation { duration: 220; easing.type: Easing.OutCubic }
                        }
                    }
                }
            }
        }

        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 12

            Card {
                Layout.fillWidth: true
                Layout.fillHeight: true

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 14
                    spacing: 10

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 10

                        ThemedLabel {
                            Layout.fillWidth: true
                            text: qsTr("Async report")
                            font.pixelSize: 14
                            font.bold: true
                        }

                        ThemedLabel {
                            visible: reportService.busy
                            text: qsTr("working…")
                            color: AppTheme.subtleText
                            font.pixelSize: 12
                        }

                        ThemedButton {
                            text: qsTr("Generate")
                            enabled: !reportService.busy
                            onClicked: reportService.generate()
                        }
                    }

                    ThemedLabel {
                        id: reportText

                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        text: qsTr("C++ takes ~1.2s and answers with a signal.\nThe UI stays responsive the whole time.")
                        color: AppTheme.subtleText
                        font.family: "monospace"
                        font.pixelSize: 12
                        verticalAlignment: Text.AlignTop
                    }
                }
            }

            Card {
                Layout.preferredWidth: 260
                Layout.fillHeight: true

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 14
                    spacing: 8

                    ThemedLabel {
                        text: qsTr("Activity (C++ signal)")
                        font.pixelSize: 14
                        font.bold: true
                    }

                    ListView {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        clip: true
                        spacing: 4
                        model: activityLog

                        ThemedLabel {
                            anchors.centerIn: parent
                            visible: activityLog.count === 0
                            text: qsTr("Add a task to see\nthe signal arrive.")
                            horizontalAlignment: Text.AlignHCenter
                            color: AppTheme.subtleText
                            font.pixelSize: 12
                        }

                        delegate: ThemedLabel {
                            required property string entry

                            width: ListView.view.width
                            text: entry
                            color: AppTheme.subtleText
                            font.pixelSize: 12
                            elide: Text.ElideRight
                        }
                    }
                }
            }
        }
    }
}
