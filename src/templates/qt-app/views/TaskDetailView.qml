pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts
import QtQuick.Controls.Basic
import "../components"

// Pushed onto the StackView by TasksView. Receives one property (taskId) and
// reports back with one signal (closed) -- it has no reference to the stack,
// the list, or the window.
Item {
    id: root

    // Set by stack.push(detailPage, { taskId: ... }).
    property int taskId: -1

    // Declaring a signal here is all it takes; the parent handles it as
    // "onClosed:". This is how a child talks upwards in QML.
    signal closed()

    // QVariantMap comes back from C++ as an ordinary JS object.
    readonly property var task: TaskStore.taskById(root.taskId)

    // IMPORTANT: the editable fields are FILLED here rather than bound with
    // "text: task.title". A binding would be destroyed the moment the user
    // typed, and re-created every time the model changed, wiping the edit.
    // One-time assignment is the correct pattern for an editable form.
    Component.onCompleted: {
        titleField.text = root.task.title ?? ""
        ownerField.text = root.task.owner ?? ""
        notesArea.text = root.task.notes ?? ""
        priorityBox.currentIndex = root.task.priority ?? Priority.Normal
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 12
        spacing: 10

        RowLayout {
            Layout.fillWidth: true
            spacing: 10

            ThemedButton {
                text: qsTr("←  Back")
                outlined: true
                onClicked: root.closed()
            }

            ThemedLabel {
                Layout.fillWidth: true
                text: root.taskId > 0 ? qsTr("Task #%1").arg(root.taskId)
                                      : qsTr("No task selected")
                font.pixelSize: 18
                font.bold: true
            }

            ThemedLabel {
                text: root.task.done ? qsTr("Completed") : qsTr("Open")
                color: root.task.done ? AppTheme.subtleText : AppTheme.accent
                font.pixelSize: 12
                font.bold: true
            }
        }

        Card {
            Layout.fillWidth: true
            Layout.fillHeight: true

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 16
                spacing: 12

                GridLayout {
                    Layout.fillWidth: true
                    columns: 2
                    columnSpacing: 12
                    rowSpacing: 10

                    ThemedLabel {
                        text: qsTr("Title")
                        color: AppTheme.subtleText
                        Layout.preferredWidth: 70
                    }

                    ThemedField {
                        id: titleField

                        Layout.fillWidth: true
                    }

                    ThemedLabel {
                        text: qsTr("Owner")
                        color: AppTheme.subtleText
                    }

                    ThemedField {
                        id: ownerField

                        Layout.fillWidth: true
                    }

                    ThemedLabel {
                        text: qsTr("Priority")
                        color: AppTheme.subtleText
                    }

                    ThemedCombo {
                        id: priorityBox

                        Layout.preferredWidth: 140
                        model: [qsTr("Low"), qsTr("Normal"), qsTr("High")]
                    }
                }

                ThemedLabel {
                    text: qsTr("Notes")
                    color: AppTheme.subtleText
                }

                Rectangle {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    radius: 8
                    color: AppTheme.background
                    border.width: 1
                    border.color: notesArea.activeFocus ? AppTheme.accent : AppTheme.border

                    TextArea {
                        id: notesArea

                        anchors.fill: parent
                        anchors.margins: 8
                        color: AppTheme.text
                        placeholderTextColor: AppTheme.subtleText
                        placeholderText: qsTr("Free text, stored in the C++ Task struct…")
                        wrapMode: TextArea.Wrap
                        background: null
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 10

                    ThemedButton {
                        text: root.task.done ? qsTr("Reopen") : qsTr("Mark done")
                        outlined: true
                        enabled: root.taskId > 0
                        onClicked: {
                            TaskStore.toggleDone(root.taskId)
                            root.closed()
                        }
                    }

                    Item {
                        Layout.fillWidth: true
                    }

                    ThemedButton {
                        text: qsTr("Save")
                        enabled: root.taskId > 0
                        onClicked: {
                            TaskStore.updateTask(root.taskId,
                                                 titleField.text,
                                                 ownerField.text,
                                                 priorityBox.currentIndex,
                                                 notesArea.text)
                            root.closed()
                        }
                    }
                }
            }
        }
    }
}
