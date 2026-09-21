pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import "../components"
import %{ProjectName}

// A row for each category: what was spent on it this month against its
// limit, and a field to change the limit.
Page {
    id: root

    padding: 16

    header: Label {
        padding: 16
        bottomPadding: 0
        text: qsTr("Budget for %1").arg(BudgetViewModel.month)
        font.pixelSize: 20
    }

    ListView {
        anchors.fill: parent
        clip: true
        spacing: 20
        model: BudgetViewModel

        ScrollBar.vertical: ScrollBar {}

        delegate: ColumnLayout {
            id: row

            // One for each role in BudgetViewModel::roleNames(), and the row.
            required property int index
            required property string category
            required property string spent
            required property string limit
            required property real share
            required property int status

            function setLimit(): void {
                problem.text = BudgetViewModel.setLimit(row.index, limitField.text)
                if (problem.text.length === 0)
                    limitField.clear()
            }

            width: ListView.view.width
            spacing: 6

            RowLayout {
                Layout.fillWidth: true

                Label {
                    Layout.fillWidth: true
                    text: row.category
                    font.bold: true
                }

                Label {
                    text: row.limit.length > 0 ? qsTr("%1 of %2").arg(row.spent).arg(row.limit)
                                               : qsTr("%1, no limit").arg(row.spent)
                    opacity: 0.8
                }
            }

            BudgetBar {
                Layout.fillWidth: true
                share: row.share
                status: row.status
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 8

                TextField {
                    id: limitField

                    Layout.preferredWidth: 160
                    placeholderText: qsTr("Monthly limit")
                    horizontalAlignment: TextInput.AlignRight
                    inputMethodHints: Qt.ImhFormattedNumbersOnly
                    onAccepted: row.setLimit()
                }

                // With the field empty, the button takes the limit away.
                Button {
                    readonly property bool removes: limitField.text.trim().length === 0

                    text: removes ? qsTr("Remove limit") : qsTr("Set limit")
                    enabled: !removes || row.limit.length > 0
                    onClicked: row.setLimit()
                }

                Label {
                    id: problem

                    Layout.fillWidth: true
                    color: "#d32f2f"
                    wrapMode: Text.Wrap
                }
            }
        }
    }
}
