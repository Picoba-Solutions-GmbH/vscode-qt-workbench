pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic

CheckBox {
    id: control

    // A Control is assembled from swappable parts. Replacing "indicator" and
    // "contentItem" restyles it completely without subclassing anything --
    // this is QtQuick.Controls' version of a WPF ControlTemplate.
    indicator: Rectangle {
        implicitWidth: 18
        implicitHeight: 18
        x: control.leftPadding
        y: control.height / 2 - height / 2
        radius: 4
        color: control.checked ? AppTheme.accent : "transparent"
        border.width: 1
        border.color: control.checked ? AppTheme.accent : AppTheme.border

        Text {
            anchors.centerIn: parent
            text: "✓"
            font.pixelSize: 12
            color: AppTheme.textOnAccent
            visible: control.checked
        }
    }

    contentItem: Text {
        text: control.text
        font: control.font
        color: AppTheme.text
        verticalAlignment: Text.AlignVCenter
        leftPadding: control.indicator.width + control.spacing
    }
}
