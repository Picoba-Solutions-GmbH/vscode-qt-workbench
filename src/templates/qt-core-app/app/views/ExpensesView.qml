pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import %{ProjectName}

// Adding and removing expenses. What it shows comes from ExpensesViewModel,
// and what the user does goes to it: the view knows nothing of the core.
Page {
    id: root

    function add(): void {
        problem.text = ExpensesViewModel.add(descriptionField.text, amountField.text, categoryBox.currentIndex)
        if (problem.text.length === 0) {
            descriptionField.clear()
            amountField.clear()
            descriptionField.forceActiveFocus()
        }
    }

    padding: 16

    header: Label {
        padding: 16
        bottomPadding: 0
        text: qsTr("Spent in %1: %2").arg(ExpensesViewModel.month).arg(ExpensesViewModel.monthTotal)
        font.pixelSize: 20
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 12

        RowLayout {
            Layout.fillWidth: true
            spacing: 8

            TextField {
                id: descriptionField

                Layout.fillWidth: true
                placeholderText: qsTr("What for?")
                onAccepted: root.add()
            }

            TextField {
                id: amountField

                Layout.preferredWidth: 110
                placeholderText: qsTr("Amount")
                horizontalAlignment: TextInput.AlignRight
                inputMethodHints: Qt.ImhFormattedNumbersOnly
                onAccepted: root.add()
            }

            ComboBox {
                id: categoryBox

                Layout.preferredWidth: 150
                model: ExpensesViewModel.categoryNames
                // The core's enum: app/viewmodels/coretypes.h makes it a QML type.
                currentIndex: Category.Food
            }

            Button {
                text: qsTr("Add")
                onClicked: root.add()
            }
        }

        // What is wrong with the expense: in the core's words, or the view
        // model's when the amount is no number.
        Label {
            id: problem

            Layout.fillWidth: true
            visible: text.length > 0
            color: "#d32f2f"
            wrapMode: Text.Wrap
        }

        Item {
            Layout.fillWidth: true
            Layout.fillHeight: true

            ListView {
                id: list

                anchors.fill: parent
                clip: true
                model: ExpensesViewModel

                ScrollBar.vertical: ScrollBar {}

                delegate: ItemDelegate {
                    id: row

                    // One for each role in ExpensesViewModel::roleNames().
                    required property int expenseId
                    required property string date
                    required property string description
                    required property string category
                    required property string amount

                    width: ListView.view.width

                    contentItem: RowLayout {
                        spacing: 16

                        Label {
                            Layout.preferredWidth: 80
                            text: row.date
                            opacity: 0.6
                        }

                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 2

                            Label {
                                Layout.fillWidth: true
                                text: row.description
                                elide: Text.ElideRight
                            }

                            Label {
                                text: row.category
                                opacity: 0.6
                                font.pixelSize: 12
                            }
                        }

                        Label {
                            text: row.amount
                            font.bold: true
                        }

                        Button {
                            text: qsTr("Remove")
                            flat: true
                            onClicked: ExpensesViewModel.remove(row.expenseId)
                        }
                    }
                }
            }

            Label {
                anchors.centerIn: parent
                visible: list.count === 0
                text: qsTr("No expenses yet.")
                opacity: 0.6
            }
        }
    }
}
