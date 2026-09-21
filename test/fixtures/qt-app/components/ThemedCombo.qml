pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic

ComboBox {
    id: control

    contentItem: Text {
        leftPadding: 10
        rightPadding: control.indicator.width + control.spacing
        text: control.displayText
        font: control.font
        color: AppTheme.text
        elide: Text.ElideRight
        verticalAlignment: Text.AlignVCenter
    }

    background: Rectangle {
        implicitWidth: 110
        implicitHeight: 34
        radius: 8
        color: AppTheme.surface
        border.width: 1
        border.color: control.activeFocus ? AppTheme.accent : AppTheme.border
    }

    delegate: ItemDelegate {
        id: entry

        // With "pragma ComponentBehavior: Bound" a delegate must declare the
        // model data it uses. modelData is what a plain JS-array model hands in.
        required property var modelData
        required property int index

        width: control.width
        height: 30
        highlighted: control.highlightedIndex === entry.index

        contentItem: Text {
            text: entry.modelData
            color: AppTheme.text
            leftPadding: 10
            verticalAlignment: Text.AlignVCenter
        }

        background: Rectangle {
            color: entry.highlighted ? AppTheme.accent : "transparent"
            opacity: entry.highlighted ? 0.25 : 1.0
        }
    }

    popup: Popup {
        y: control.height + 2
        width: control.width
        implicitHeight: Math.min(contentItem.implicitHeight + 8, 220)
        padding: 4

        contentItem: ListView {
            clip: true
            implicitHeight: contentHeight
            model: control.popup.visible ? control.delegateModel : null
            currentIndex: control.highlightedIndex
        }

        background: Rectangle {
            radius: 8
            color: AppTheme.surface
            border.width: 1
            border.color: AppTheme.border
        }
    }
}
