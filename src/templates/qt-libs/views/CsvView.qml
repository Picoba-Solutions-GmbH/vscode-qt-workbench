pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts
import QtQuick.Controls.Fusion
import QtQuick.Dialogs
import %{ProjectName}

// CSV text or a CSV file, parsed in C++ (csv/csvtablemodel.cpp) and shown in a
// TableView bound to the model.
Item {
    id: root

    CsvTableModel {
        id: table
    }

    // Runs once, when the view has been created.
    Component.onCompleted: table.loadText(input.text)

    FileDialog {
        id: fileDialog

        nameFilters: [qsTr("CSV files (*.csv *.tsv *.txt)"), qsTr("All files (*)")]
        onAccepted: table.loadFile(selectedFile)
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 8

        RowLayout {
            Layout.fillWidth: true
            spacing: 6

            Button {
                text: qsTr("Open CSV File...")
                onClicked: fileDialog.open()
            }

            Button {
                text: qsTr("Parse the Text Below")
                onClicked: table.loadText(input.text)
            }

            Label {
                Layout.fillWidth: true
                horizontalAlignment: Text.AlignRight
                text: table.error !== "" ? table.error
                                         : qsTr("%1 rows, %2 columns").arg(table.rows).arg(table.columnNames.length)
                color: table.error !== "" ? "#d9534f" : palette.text
                elide: Text.ElideRight
            }
        }

        ScrollView {
            Layout.fillWidth: true
            Layout.preferredHeight: 130

            TextArea {
                id: input

                font.family: "monospace"
                wrapMode: TextArea.NoWrap
                // Semicolons, as spreadsheets in many locales write them: the parser guesses the delimiter.
                text: "date;sensor;temperature;humidity\n"
                      + "2026-01-05;hall;19.5;41\n"
                      + "2026-01-05;office;21.0;38\n"
                      + "2026-01-06;hall;18.25;45\n"
                      + "2026-01-06;office;21.75;36\n"
                      + "2026-01-07;hall;17.0;47\n"
            }
        }

        // The column names come from the model's headerData().
        HorizontalHeaderView {
            Layout.fillWidth: true
            syncView: tableView
            clip: true
        }

        TableView {
            id: tableView

            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            columnSpacing: 1
            rowSpacing: 1
            model: table
            // Every column as wide as the view allows, but no narrower than 100.
            columnWidthProvider: () => Math.max(100, tableView.width / Math.max(1, table.columnNames.length))

            ScrollBar.vertical: ScrollBar {}

            // One delegate per visible cell. "display" is the cell's
            // Qt::DisplayRole value from CsvTableModel::data().
            delegate: Rectangle {
                id: cell

                required property string display
                required property int row

                implicitHeight: 28
                color: cell.row % 2 === 0 ? palette.base : palette.alternateBase

                Label {
                    anchors.fill: parent
                    anchors.leftMargin: 6
                    anchors.rightMargin: 6
                    verticalAlignment: Text.AlignVCenter
                    text: cell.display
                    elide: Text.ElideRight
                }
            }
        }

        Label {
            Layout.fillWidth: true
            visible: text !== ""
            text: table.summary
            font.family: "monospace"
        }
    }
}
