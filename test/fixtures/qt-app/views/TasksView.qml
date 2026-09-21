pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts
import QtQuick.Controls.Basic
import "../components"
import Test

// Tab 1. Shows the C++ list model driving a ListView, a C++ proxy doing the
// filtering, and StackView navigation into a detail page.
Item {
    id: root

    // StackView is the push/pop navigator -- a Frame + NavigationService in
    // WPF terms. initialItem is the page at the bottom of the stack.
    StackView {
        id: stack

        anchors.fill: parent
        initialItem: listPage
        background: null
    }

    Component {
        id: detailPage

        TaskDetailView {
            // The detail page does not know about the stack; it just reports
            // that it is finished and lets whoever pushed it decide.
            onClosed: stack.pop()
        }
    }

    Component {
        id: listPage

        ColumnLayout {
            spacing: 10

            // A non-visual object can live anywhere in the tree. This one
            // wraps the TaskStore singleton and hides rows that do not match.
            TaskFilterProxy {
                id: filtered

                sourceModel: TaskStore
                searchText: searchField.text
                showCompleted: showCompletedBox.checked
            }

            Card {
                Layout.fillWidth: true
                Layout.leftMargin: 12
                Layout.rightMargin: 12
                Layout.topMargin: 12
                Layout.preferredHeight: form.implicitHeight + 24

                ColumnLayout {
                    id: form

                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.margins: 12
                    spacing: 8

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 8

                        ThemedField {
                            id: titleField

                            Layout.fillWidth: true
                            placeholderText: qsTr("New task title")
                            onAccepted: addButton.clicked()
                        }

                        ThemedField {
                            id: ownerField

                            Layout.preferredWidth: 130
                            placeholderText: qsTr("Owner")
                        }

                        ThemedCombo {
                            id: priorityBox

                            Layout.preferredWidth: 110
                            model: [qsTr("Low"), qsTr("Normal"), qsTr("High")]
                            currentIndex: Priority.Normal
                        }

                        ThemedButton {
                            id: addButton

                            text: qsTr("Add")
                            enabled: titleField.text.trim().length > 0
                            onClicked: {
                                TaskStore.addTask(titleField.text,
                                                  ownerField.text,
                                                  priorityBox.currentIndex)
                                titleField.clear()
                                titleField.forceActiveFocus()
                            }
                        }
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 12

                        ThemedField {
                            id: searchField

                            Layout.fillWidth: true
                            placeholderText: qsTr("Search title or owner…")
                        }

                        ThemedCheckBox {
                            id: showCompletedBox

                            text: qsTr("Show completed")
                            checked: true
                        }

                        ThemedLabel {
                            text: qsTr("%1 of %2 shown").arg(filtered.count)
                                                        .arg(TaskStore.totalCount)
                            color: AppTheme.subtleText
                            font.pixelSize: 12
                        }

                        ThemedButton {
                            text: qsTr("Clear done")
                            outlined: true
                            enabled: TaskStore.doneCount > 0
                            onClicked: TaskStore.clearCompleted()
                        }
                    }
                }
            }

            ListView {
                id: list

                Layout.fillWidth: true
                Layout.fillHeight: true
                Layout.leftMargin: 12
                Layout.rightMargin: 12
                Layout.bottomMargin: 12
                clip: true
                spacing: 6
                model: filtered

                ScrollBar.vertical: ScrollBar {}

                // Shown only when the filter matches nothing.
                ThemedLabel {
                    anchors.centerIn: parent
                    visible: list.count === 0
                    text: qsTr("Nothing matches the current filter.")
                    color: AppTheme.subtleText
                }

                delegate: Card {
                    id: row

                    // One declaration per model role used below. The role names
                    // come from TaskStore::roleNames(). Note "taskId" rather
                    // than "id" -- "id" is reserved in QML.
                    required property int taskId
                    required property string title
                    required property string owner
                    required property int priority
                    required property bool done

                    width: ListView.view.width
                    height: 58

                    RowLayout {
                        anchors.fill: parent
                        anchors.leftMargin: 12
                        anchors.rightMargin: 12
                        spacing: 10

                        ThemedCheckBox {
                            checked: row.done
                            // onToggled fires only on user interaction, so the
                            // binding above cannot cause a feedback loop.
                            onToggled: TaskStore.toggleDone(row.taskId)
                        }

                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 0

                            ThemedLabel {
                                Layout.fillWidth: true
                                text: row.title
                                font.pixelSize: 14
                                font.strikeout: row.done
                                opacity: row.done ? 0.55 : 1.0
                                elide: Text.ElideRight
                                wrapMode: Text.NoWrap
                            }

                            ThemedLabel {
                                text: row.owner
                                color: AppTheme.subtleText
                                font.pixelSize: 11
                            }
                        }

                        Rectangle {
                            implicitWidth: priorityText.implicitWidth + 18
                            implicitHeight: 20
                            radius: 10
                            color: AppTheme.priorityColor(row.priority)

                            Text {
                                id: priorityText

                                anchors.centerIn: parent
                                text: [qsTr("Low"), qsTr("Normal"), qsTr("High")][row.priority]
                                color: "#ffffff"
                                font.pixelSize: 10
                                font.bold: true
                            }
                        }

                        ThemedButton {
                            text: qsTr("Open")
                            outlined: true
                            padding: 6
                            // Push the detail page and seed its taskId in one go.
                            onClicked: stack.push(detailPage, { taskId: row.taskId })
                        }

                        ThemedButton {
                            text: qsTr("Delete")
                            outlined: true
                            padding: 6
                            accentColor: AppTheme.priorityColor(Priority.High)
                            onClicked: TaskStore.removeTask(row.taskId)
                        }
                    }
                }
            }
        }
    }
}
